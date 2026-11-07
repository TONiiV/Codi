import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  type PreparedConnection,
  PrimaryConnectionTarget,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type * as RpcSession from "../rpc/session.ts";
import {
  createTelescopeBoardAtoms,
  DECISION_STATUSES,
  decideFailureText,
  decideInput,
  decisionOptionsLocked,
  isStaleTaskVersion,
  sortDecisions,
  TASK_STATUSES,
  tasksByStatus,
  taskUpdateInput,
  taskUpdateOutcome,
} from "./taskBoard.ts";

const workspaceId = Telescope.WorkspaceId.make("w1");

function decision(
  id: string,
  status: Telescope.Decision["status"],
  updatedAt: string,
): Telescope.Decision {
  return {
    kind: "decision",
    id: Telescope.DecisionId.make(id),
    workspaceId,
    title: `Decision ${id}`,
    text: "Why",
    authorId: "pm",
    status,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt,
    version: 1,
  };
}

function task(id: string, status: Telescope.TaskStatus, version = 1): Telescope.Task {
  return {
    kind: "task",
    id: Telescope.TaskId.make(id),
    workspaceId,
    title: `Task ${id}`,
    status,
    goalChain: [],
    freeText: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    version,
  };
}

describe("tasksByStatus", () => {
  it("has a column for every status and puts every task in its column", () => {
    const columns = tasksByStatus([
      task("a", "todo"),
      task("b", "done"),
      task("c", "todo"),
      task("d", "needs_decision"),
    ]);
    expect(new Set(TASK_STATUSES)).toEqual(new Set(Telescope.TaskStatus.literals));
    expect(columns.todo.map((item) => item.id)).toEqual(["a", "c"]);
    expect(columns.needs_decision.map((item) => item.id)).toEqual(["d"]);
    expect(columns.in_progress).toEqual([]);
  });
});

describe("sortDecisions", () => {
  it("puts proposals first, then decided, then superseded, newest first, then by id", () => {
    const sorted = sortDecisions([
      decision("superseded-b", "superseded", "2026-11-05T00:00:00.000Z"),
      decision("old-decided", "decided", "2026-11-02T00:00:00.000Z"),
      decision("superseded", "superseded", "2026-11-05T00:00:00.000Z"),
      decision("old-proposal", "proposed", "2026-11-01T00:00:00.000Z"),
      decision("new-decided", "decided", "2026-11-04T00:00:00.000Z"),
      decision("new-proposal", "proposed", "2026-11-03T00:00:00.000Z"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([
      "new-proposal",
      "old-proposal",
      "new-decided",
      "old-decided",
      "superseded",
      "superseded-b",
    ]);
    expect(new Set(DECISION_STATUSES)).toEqual(new Set(Telescope.DecisionStatus.literals));
  });
});

describe("decideInput", () => {
  it("records a decided decision that supersedes the proposal with the chosen option", () => {
    const options = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    const proposal = { ...decision("p1", "proposed", "2026-11-01T00:00:00.000Z"), options };
    expect(decideInput(proposal, "b")).toEqual({
      workspaceId,
      title: "Decision p1",
      text: "Why",
      status: "decided",
      supersedes: "p1",
      options,
      chosen: "b",
    });
  });
});

describe("decisionOptionsLocked", () => {
  it.each([
    ["nothing sent", { sentAt: null, isPending: false, dataUpdatedAt: 100 }, false],
    ["sent, refetch in flight", { sentAt: 200, isPending: true, dataUpdatedAt: 100 }, true],
    [
      "sent, list not newer than the send",
      { sentAt: 200, isPending: false, dataUpdatedAt: 200 },
      true,
    ],
    ["sent, refetch landed", { sentAt: 200, isPending: false, dataUpdatedAt: 201 }, false],
    ["send failed, sentAt cleared", { sentAt: null, isPending: true, dataUpdatedAt: 100 }, false],
  ])("%s", (_name, state, locked) => {
    expect(decisionOptionsLocked(state)).toBe(locked);
  });
});

describe("task writes", () => {
  it("pins the update to the version the user saw", () => {
    expect(taskUpdateInput(task("t1", "in_review", 7), { set: { status: "done" } })).toEqual({
      workspaceId,
      taskId: "t1",
      baseVersion: 7,
      set: { status: "done" },
    });
  });

  it("tells an applied write from one a rule kept a newer value for, and from a conflict", () => {
    expect(taskUpdateOutcome({ status: "done" }, task("t1", "done", 2))).toEqual({
      kind: "applied",
    });
    expect(taskUpdateOutcome({ ownerAgentId: null }, task("t1", "todo", 2))).toEqual({
      kind: "applied",
    });
    expect(
      taskUpdateOutcome({ status: "in_progress", title: "Task t1" }, task("t1", "done", 3)),
    ).toEqual({ kind: "kept", fields: ["status"] });
    const decisionId = Telescope.DecisionId.make("d1");
    expect(
      taskUpdateOutcome(
        { title: "Mine" },
        { ...task("t1", "needs_decision", 3), conflict: { decisionId } },
      ),
    ).toEqual({ kind: "conflict", decisionId });
  });

  it("recognises a stale-version rejection and nothing else", () => {
    const stale = new Telescope.StaleTaskVersionError({
      taskId: Telescope.TaskId.make("t1"),
      baseVersion: 7,
      currentVersion: 8,
    });
    expect(isStaleTaskVersion(stale)).toBe(true);
    expect(isStaleTaskVersion(new Error("boom"))).toBe(false);
    expect(isStaleTaskVersion(null)).toBe(false);
  });

  it.each([
    ["conflict", "这条提议已经有人决定了，列表已刷新。"],
    ["not_found", null],
    ["forbidden", null],
  ] as const)("gives a decide refused with %s its Chinese copy or none", (reason, text) => {
    const error = new Telescope.WorkspaceError({
      reason,
      message: "That decision has already been superseded.",
    });
    expect(decideFailureText(error)).toBe(text);
  });
});

const ENVIRONMENT = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("board-environment"),
  label: "Board environment",
  httpBaseUrl: "https://board.example.test",
  wsBaseUrl: "wss://board.example.test",
});

/** Board atoms on a connected fake environment that records each read and hands out each watch. */
const connectedBoard = Effect.fn("TaskBoardTest.connectedBoard")(function* () {
  const reads = yield* Queue.unbounded<string>();
  const watches = yield* Queue.unbounded<Queue.Queue<Telescope.BoardWatchItem>>();
  const read = <A>(name: string, value: A) => Queue.offer(reads, name).pipe(Effect.as(value));
  const client = {
    [Telescope.WS_METHODS.taskList]: () => read("tasks", { tasks: [] }),
    [Telescope.WS_METHODS.taskGet]: (input: typeof Telescope.TaskGetInput.Type) =>
      read(`task:${input.taskId}`, task(input.taskId, "todo")),
    [Telescope.WS_METHODS.decisionList]: () => read("decisions", { decisions: [] }),
    [Telescope.WS_METHODS.boardWatch]: () =>
      Stream.unwrap(
        Effect.gen(function* () {
          const notices = yield* Queue.unbounded<Telescope.BoardWatchItem>();
          yield* Queue.offer(watches, notices);
          return Stream.fromQueue(notices).pipe(
            Stream.prepend([{ kind: "synchronized" as const }]),
          );
        }),
      ),
  };
  const newSession = () => Option.some({ client } as unknown as RpcSession.RpcSession);
  const session = yield* SubscriptionRef.make(newSession());
  const connected: SupervisorConnectionState = {
    ...AVAILABLE_CONNECTION_STATE,
    desired: true,
    network: "online",
    phase: "connected",
    attempt: 1,
    generation: 1,
  };
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: ENVIRONMENT,
    state: yield* SubscriptionRef.make(connected),
    session,
    prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (_environmentId, effect) =>
    Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const followStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["followStream"] = (
    _environmentId,
    stream,
  ) => Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const environments = {
    run,
    followStream,
  } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"];
  const runtime = Atom.runtime(
    Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments),
  );
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  return {
    board: createTelescopeBoardAtoms(runtime),
    registry,
    /** Each watch subscription's notices, in the order the client subscribes. */
    watches,
    /** The next `count` reads, sorted, since reads started together finish in any order. */
    nextReads: (count: number) =>
      Effect.replicateEffect(Queue.take(reads), count).pipe(
        Effect.map((names) => names.toSorted()),
      ),
    reconnect: SubscriptionRef.set(session, Option.none()).pipe(
      Effect.andThen(SubscriptionRef.set(session, newSession())),
    ),
  };
});

describe("board watch", () => {
  it.effect("refreshes only the reads a notice names, and each read once after a reconnect", () =>
    Effect.gen(function* () {
      const { board, registry, watches, nextReads, reconnect } = yield* connectedBoard();
      const at = <I>(input: I) => ({ environmentId: ENVIRONMENT.environmentId, input });
      const [t1, t2] = [Telescope.TaskId.make("t1"), Telescope.TaskId.make("t2")];
      registry.mount(board.tasks(at({ workspaceId })));
      registry.mount(board.task(at({ workspaceId, taskId: t1 })));
      registry.mount(board.task(at({ workspaceId, taskId: t2 })));
      registry.mount(board.decisions(at({ workspaceId })));
      expect(yield* nextReads(4)).toEqual(["decisions", "task:t1", "task:t2", "tasks"]);

      const watch = yield* Queue.take(watches);
      yield* Queue.offer(watch, { kind: "task", workspaceId, id: t1, version: 2 });
      expect(yield* nextReads(2)).toEqual(["task:t1", "tasks"]);
      const decisionId = Telescope.DecisionId.make("d1");
      yield* Queue.offer(watch, { kind: "decision", workspaceId, id: decisionId, version: 1 });
      expect(yield* nextReads(1)).toEqual(["decisions"]);

      yield* reconnect;
      expect(yield* nextReads(4)).toEqual(["decisions", "task:t1", "task:t2", "tasks"]);
      const rewatch = yield* Queue.take(watches);
      yield* Queue.offer(rewatch, { kind: "task", workspaceId, id: t2, version: 2 });
      expect(yield* nextReads(2)).toEqual(["task:t2", "tasks"]);
    }),
  );
});
