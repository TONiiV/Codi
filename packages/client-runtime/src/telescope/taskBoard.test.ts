import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, Telescope } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
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
  leaseRecheckDelay,
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

  it("tells an applied write from one that replaced someone's change, one a rule kept a newer value for, and a conflict", () => {
    expect(taskUpdateOutcome({ status: "done" }, task("t1", "done", 2))).toEqual({
      kind: "applied",
    });
    expect(
      taskUpdateOutcome({ status: "done" }, { ...task("t1", "done", 2), overwrote: [] }),
    ).toEqual({ kind: "applied" });
    expect(taskUpdateOutcome({ ownerAgentId: null }, task("t1", "todo", 2))).toEqual({
      kind: "applied",
    });
    expect(
      taskUpdateOutcome({ status: "in_progress", title: "Task t1" }, task("t1", "done", 3)),
    ).toEqual({ kind: "kept", fields: ["status"] });
    const at = "2026-11-07T00:00:00.000Z";
    const overwrote = [
      { key: "title", by: "member-bob", name: "Bob", at },
      { key: "status", by: "member-bob", name: "Bob", at },
      { key: "goalChain", by: "agent-1", name: "Ops for Bob", at },
    ];
    const marked = {
      ...task("t1", "done", 5),
      conflictDecisionId: Telescope.DecisionId.make("d0"),
      overwrote,
    };
    expect(
      taskUpdateOutcome({ title: "Task t1", status: "done", conflictDecisionId: null }, marked),
    ).toEqual({ kind: "overwrote", authors: ["member-bob", "agent-1"] });
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

describe("leaseRecheckDelay", () => {
  const now = Date.parse("2026-11-01T00:00:00.000Z");
  const lease = (expiresAt: string, heartbeatAt = "2026-10-31T23:50:00.000Z"): Telescope.Lease => ({
    id: Telescope.LeaseId.make("l1"),
    workspaceId,
    taskId: Telescope.TaskId.make("t1"),
    holderAgentId: Telescope.AgentId.make("a1"),
    holderSubjectId: Telescope.SubjectId.make("s1"),
    acquiredAt: "2026-10-31T22:45:00.000Z",
    heartbeatAt,
    expiresAt,
  });
  it.each([
    { name: "no lease", lease: undefined, delay: null },
    { name: "at its expiry", lease: lease("2026-11-01T00:01:30.000Z"), delay: 90_000 },
    {
      name: "a lapse the server has not seen yet",
      lease: lease("2026-10-31T23:00:00.000Z", "2026-10-31T22:45:00.000Z"),
      readAt: Date.parse("2026-10-31T22:50:00.000Z"),
      delay: 5_000,
    },
    {
      name: "an expiry closer than the floor",
      lease: lease("2026-11-01T00:00:01.000Z"),
      delay: 5_000,
    },
    {
      name: "a client clock 30 days behind, no longer than the lease's span",
      lease: lease("2026-12-01T00:15:00.000Z", "2026-12-01T00:00:00.000Z"),
      delay: 15 * 60_000,
    },
    {
      name: "a client clock ahead, as long as the server kept it past this clock's expiry",
      lease: lease("2026-10-31T23:55:00.000Z", "2026-10-31T23:40:00.000Z"),
      delay: 5 * 60_000,
    },
  ])("$name", ({ lease, readAt = now, delay }) => {
    expect(leaseRecheckDelay(lease, now, readAt)).toBe(delay);
  });
});

const changes = (...list: ReadonlyArray<Telescope.BoardChange>): Telescope.BoardWatchItem => ({
  kind: "changes",
  changes: list,
});

const ENVIRONMENT = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("board-environment"),
  label: "Board environment",
  httpBaseUrl: "https://board.example.test",
  wsBaseUrl: "wss://board.example.test",
});

/**
 * Board atoms on a connected fake environment that records each read and hands out each watch.
 * The atoms run on the test's clock. A watch is subscribed once `nextWatch` sends its
 * `synchronized`; a write echoes on the newest subscribed watch, as the server notices a committed
 * write before it answers. A decide is refused as already decided.
 */
const connectedBoard = Effect.fn("TaskBoardTest.connectedBoard")(function* () {
  const reads = yield* Queue.unbounded<string>();
  type Watch = Queue.Queue<Telescope.BoardWatchItem, Telescope.WorkspaceError>;
  const watches = yield* Queue.unbounded<{ readonly notices: Watch; readonly openedAt: number }>();
  const ended = yield* Queue.unbounded<void>();
  let newest: Watch | undefined;
  let revoked = false;
  const read = <A>(name: string, value: A) =>
    Queue.offer(reads, name).pipe(
      Effect.andThen(
        revoked
          ? Effect.fail(new Telescope.WorkspaceError({ reason: "forbidden", message: "Revoked." }))
          : Effect.succeed(value),
      ),
    );
  const client = {
    [Telescope.WS_METHODS.taskList]: () => read("tasks", { tasks: [] }),
    [Telescope.WS_METHODS.taskGet]: (input: typeof Telescope.TaskGetInput.Type) =>
      read(`task:${input.taskId}`, task(input.taskId, "todo")),
    [Telescope.WS_METHODS.decisionList]: () => read("decisions", { decisions: [] }),
    [Telescope.WS_METHODS.leaseGet]: (input: typeof Telescope.TaskGetInput.Type) =>
      read(`lease:${input.taskId}`, {}),
    [Telescope.WS_METHODS.agentListMine]: () => read("agents", { agents: [] }),
    [Telescope.WS_METHODS.taskUpdate]: (input: typeof Telescope.TaskUpdateInput.Type) => {
      const echo = { kind: "task" as const, workspaceId, id: input.taskId, version: 2 };
      return Effect.as(
        newest === undefined ? Effect.void : Queue.offer(newest, changes(echo)),
        task(input.taskId, "done", 2),
      );
    },
    [Telescope.WS_METHODS.decisionCreate]: () =>
      Effect.fail(new Telescope.WorkspaceError({ reason: "conflict", message: "Decided." })),
    [Telescope.WS_METHODS.boardWatch]: () =>
      Stream.unwrap(
        Effect.gen(function* () {
          const notices: Watch = yield* Queue.unbounded<
            Telescope.BoardWatchItem,
            Telescope.WorkspaceError
          >();
          yield* Queue.offer(watches, { notices, openedAt: yield* Clock.currentTimeMillis });
          return Stream.fromQueue(notices).pipe(Stream.ensuring(Queue.offer(ended, undefined)));
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
    Layer.merge(
      Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    ),
  );
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  return {
    board: createTelescopeBoardAtoms(runtime),
    registry,
    /** Each watch subscription's notices and when it opened, in the order the client subscribes. */
    watches,
    /** Signals each time a watch stream ends. */
    ended,
    /** While revoked, every read is refused as `forbidden`. */
    setRevoked: (next: boolean) => Effect.sync(() => (revoked = next)),
    /** The next watch, once it has sent `synchronized`. */
    nextWatch: Effect.gen(function* () {
      const opened = yield* Queue.take(watches);
      yield* Queue.offer(opened.notices, { kind: "synchronized" });
      newest = opened.notices;
      return opened.notices;
    }),
    /** The next `count` reads, sorted, since reads started together finish in any order. */
    nextReads: (count: number) =>
      Effect.replicateEffect(Queue.take(reads), count).pipe(
        Effect.map((names) => names.toSorted()),
      ),
    /** Reads made and not yet taken. */
    unread: Queue.size(reads),
    /** Reads started before `marker` is read, sorted; `marker` is a read nothing else starts. */
    readsBefore: (marker: string) =>
      Effect.gen(function* () {
        const before: Array<string> = [];
        for (let name = yield* Queue.take(reads); name !== marker; name = yield* Queue.take(reads))
          before.push(name);
        return before.toSorted();
      }),
    reconnect: SubscriptionRef.set(session, Option.none()).pipe(
      Effect.andThen(SubscriptionRef.set(session, newSession())),
    ),
  };
});

describe("board watch", () => {
  const at = <I>(input: I) => ({ environmentId: ENVIRONMENT.environmentId, input });
  const [t1, t2] = [Telescope.TaskId.make("t1"), Telescope.TaskId.make("t2")];
  const decisionId = Telescope.DecisionId.make("d1");
  const decisionNotice = { kind: "decision", workspaceId, id: decisionId, version: 1 } as const;
  const decided = changes(decisionNotice);
  const taskAt = (id: Telescope.TaskId, version: number) =>
    ({ kind: "task", workspaceId, id, version }) as const;

  it.effect("refreshes only the reads a notice names, and each read once after a reconnect", () =>
    Effect.gen(function* () {
      const { board, registry, nextWatch, nextReads, readsBefore, reconnect } =
        yield* connectedBoard();
      registry.mount(board.tasks(at({ workspaceId })));
      registry.mount(board.task(at({ workspaceId, taskId: t1 })));
      registry.mount(board.task(at({ workspaceId, taskId: t2 })));
      registry.mount(board.decisions(at({ workspaceId })));
      // A lease change commits to its task, so the task's notice re-reads its lease too.
      registry.mount(board.lease(at({ workspaceId, taskId: t1 })));
      const all = ["decisions", "lease:t1", "task:t1", "task:t2", "tasks"];
      expect(yield* nextReads(5)).toEqual(all);

      const watch = yield* nextWatch;
      yield* Queue.offer(watch, changes(taskAt(t1, 2)));
      expect(yield* nextReads(3)).toEqual(["lease:t1", "task:t1", "tasks"]);
      yield* Queue.offer(watch, decided);
      expect(yield* nextReads(1)).toEqual(["decisions"]);
      // One write's notices re-read each list once.
      yield* Queue.offer(watch, changes(taskAt(t1, 3), taskAt(t2, 2), decisionNotice));
      expect(yield* nextReads(5)).toEqual(all);

      yield* reconnect;
      expect(yield* nextReads(5)).toEqual(all);
      const rewatch = yield* nextWatch;
      yield* Queue.offer(rewatch, changes(taskAt(t2, 3)));
      expect(yield* nextReads(2)).toEqual(["task:t2", "tasks"]);
      // A delegation's notice is not the board's; it moves only the delegation count.
      const delegationNotices = board.delegationNotices(at({ workspaceId }));
      registry.mount(delegationNotices);
      const before = registry.get(delegationNotices);
      const delegationId = Telescope.DelegationId.make("g1");
      yield* Queue.offer(
        rewatch,
        changes({ kind: "delegation", workspaceId, id: delegationId, version: 1 }),
      );
      yield* Queue.offer(rewatch, changes(taskAt(t2, 4)));
      expect(yield* nextReads(2)).toEqual(["task:t2", "tasks"]);
      expect(registry.get(delegationNotices) - before).toBe(1);
      const marker = board.agents(at({ workspaceId }));
      registry.mount(marker);
      expect(yield* readsBefore("agents")).toEqual([]);
    }),
  );

  it.effect("reads a write once from its echo, and on settle when refused or unwatched", () =>
    Effect.gen(function* () {
      const fake = yield* connectedBoard();
      const { board, registry, watches, ended, nextWatch, nextReads, unread, readsBefore } = fake;
      const tasks = board.tasks(at({ workspaceId }));
      registry.mount(tasks);
      registry.mount(board.decisions(at({ workspaceId })));
      // No notice names t2, so only the watch failing re-reads it.
      registry.mount(board.task(at({ workspaceId, taskId: t2 })));
      // The agents read has no trigger: refreshing it marks where a write's own reads end.
      const marker = board.agents(at({ workspaceId }));
      registry.mount(marker);
      expect(yield* nextReads(4)).toEqual(["agents", "decisions", "task:t2", "tasks"]);
      const settled = Effect.sync(() => registry.refresh(marker)).pipe(
        Effect.andThen(readsBefore("agents")),
      );
      const watch = yield* nextWatch;
      // A read after a notice shows the watch has synchronized.
      yield* Queue.offer(watch, decided);
      expect(yield* nextReads(1)).toEqual(["decisions"]);

      const write = { workspaceId, taskId: t1, baseVersion: 1, set: { status: "done" as const } };
      const updated = yield* Effect.promise(() => board.updateTask.run(registry, at(write)));
      expect(updated._tag).toBe("Success");
      expect(yield* nextReads(1)).toEqual(["tasks"]);
      // Nothing else was read for it: the next read is the next notice's.
      yield* Queue.offer(watch, decided);
      expect(yield* nextReads(1)).toEqual(["decisions"]);

      const proposal = decision("p1", "proposed", "2026-11-01T00:00:00.000Z");
      const refused = yield* Effect.promise(() =>
        board.createDecision.run(registry, at(decideInput(proposal, "a"))),
      );
      expect(refused._tag).toBe("Failure");
      expect(yield* settled).toEqual(["decisions", "tasks"]);

      // A refused member's watch stays failed: each read re-reads once and no watch reopens.
      yield* fake.setRevoked(true);
      yield* Queue.failCause(
        watch,
        Cause.fail(new Telescope.WorkspaceError({ reason: "forbidden", message: "Revoked." })),
      );
      yield* Queue.take(ended);
      expect(yield* settled).toEqual(["decisions", "task:t2", "tasks"]);
      yield* TestClock.adjust("1 minute");
      expect(yield* Queue.size(watches)).toBe(0);
      // With no live watch to echo it, a write re-reads on settle.
      yield* Effect.promise(() => board.updateTask.run(registry, at(write)));
      expect(yield* settled).toEqual(["decisions", "tasks"]);
      expect(yield* unread).toBe(0);

      // Once a read is answered again the member is back: the watch reopens and each read re-reads.
      yield* fake.setRevoked(false);
      registry.refresh(tasks);
      expect(yield* nextReads(1)).toEqual(["tasks"]);
      const restored = yield* nextWatch;
      expect(yield* nextReads(3)).toEqual(["decisions", "task:t2", "tasks"]);
      yield* Queue.offer(restored, decided);
      expect(yield* nextReads(1)).toEqual(["decisions"]);
      expect(yield* unread).toBe(0);
    }),
  );

  it.effect("opens a failed watch again after a backoff and re-reads once when it is back", () =>
    Effect.gen(function* () {
      const { board, registry, watches, nextReads, readsBefore } = yield* connectedBoard();
      registry.mount(board.tasks(at({ workspaceId })));
      registry.mount(board.decisions(at({ workspaceId })));
      const marker = board.agents(at({ workspaceId }));
      registry.mount(marker);
      expect(yield* nextReads(3)).toEqual(["agents", "decisions", "tasks"]);
      const first = yield* Queue.take(watches);
      yield* Queue.offer(first.notices, { kind: "synchronized" });
      yield* Queue.failCause(
        first.notices,
        Cause.fail(new Telescope.WorkspaceError({ reason: "expired", message: "Fell behind." })),
      );

      // No read until the watch is back: the backoff, then one read each on `synchronized`.
      const reopened = TestClock.adjust("1 second").pipe(Effect.andThen(Queue.take(watches)));
      const second = yield* Effect.raceFirst(reopened, nextReads(1));
      if (Array.isArray(second)) return expect.fail(`read ${second} while the watch was down`);
      expect(second.openedAt - first.openedAt).toBe(1000);
      // Not yet subscribed again, so nothing echoes a write: it re-reads on settle.
      const write = { workspaceId, taskId: t1, baseVersion: 1, set: { status: "done" as const } };
      yield* Effect.promise(() => board.updateTask.run(registry, at(write)));
      registry.refresh(marker);
      expect(yield* readsBefore("agents")).toEqual(["decisions", "tasks"]);

      yield* Queue.offer(second.notices, { kind: "synchronized" });
      expect(yield* nextReads(2)).toEqual(["decisions", "tasks"]);
      yield* Queue.offer(second.notices, decided);
      expect(yield* nextReads(1)).toEqual(["decisions"]);

      // A watch that delivered starts the backoff over; one that failed before it did doubles it.
      const fail = (notices: typeof first.notices) =>
        Queue.failCause(
          notices,
          Cause.fail(new Telescope.WorkspaceError({ reason: "storage", message: "Busy." })),
        );
      yield* fail(second.notices);
      yield* TestClock.adjust("1 second");
      const third = Option.getOrThrow(yield* Queue.poll(watches));
      expect(third.openedAt - second.openedAt).toBe(1000);
      yield* fail(third.notices);
      yield* TestClock.adjust("2 seconds");
      let previous = yield* Queue.take(watches);
      expect(previous.openedAt - third.openedAt).toBe(2000);
      for (const delay of [4, 8, 16]) {
        yield* fail(previous.notices);
        yield* TestClock.adjust(`${delay} seconds`);
        const reopened = yield* Queue.take(watches);
        expect(reopened.openedAt - previous.openedAt).toBe(delay * 1000);
        previous = reopened;
      }
      yield* fail(previous.notices);
      yield* TestClock.adjust("1 minute");
      expect((yield* Queue.take(watches)).openedAt - previous.openedAt).toBe(30_000);
    }),
  );
});
