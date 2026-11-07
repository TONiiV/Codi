import { EnvironmentId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import type * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { type EnvironmentRpcStreamFailure, subscribe } from "../rpc/client.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  followStreamInEnvironment,
} from "../state/runtime.ts";

const { WS_METHODS } = Telescope;

/** Kanban columns: the forward path first, then the states a person settles. */
export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "needs_decision",
  "dropped",
] as const satisfies ReadonlyArray<Telescope.TaskStatus>;

export function tasksByStatus(
  tasks: ReadonlyArray<Telescope.Task>,
): Record<Telescope.TaskStatus, ReadonlyArray<Telescope.Task>> {
  const columns: Record<Telescope.TaskStatus, Telescope.Task[]> = {
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    needs_decision: [],
    dropped: [],
  };
  for (const task of tasks) columns[task.status].push(task);
  return columns;
}

/** Decision groups: proposals waiting on someone first, then the record. */
export const DECISION_STATUSES = [
  "proposed",
  "decided",
  "superseded",
] as const satisfies ReadonlyArray<Telescope.DecisionStatus>;

/** By group, newest first within each; a decision and the one it retires can share a timestamp. */
export function sortDecisions(
  decisions: ReadonlyArray<Telescope.Decision>,
): ReadonlyArray<Telescope.Decision> {
  return [...decisions].sort(
    (a, b) =>
      DECISION_STATUSES.indexOf(a.status) - DECISION_STATUSES.indexOf(b.status) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.id.localeCompare(b.id),
  );
}

/** Choosing an option records a decided decision that retires the proposal (D26). */
export function decideInput(
  proposal: Telescope.Decision,
  optionId: string,
): typeof Telescope.DecisionCreateInput.Type {
  return {
    workspaceId: proposal.workspaceId,
    title: proposal.title,
    text: proposal.text,
    status: "decided",
    supersedes: proposal.id,
    ...(proposal.options === undefined ? {} : { options: proposal.options }),
    chosen: optionId,
  };
}

/**
 * From a decide being sent until a list fetched after it lands, the options stay off (D47).
 * A failed send clears `sentAt`; `dataUpdatedAt` is the client clock of the last success.
 */
export function decisionOptionsLocked(state: {
  readonly sentAt: number | null;
  readonly isPending: boolean;
  readonly dataUpdatedAt: number;
}): boolean {
  return state.sentAt !== null && (state.isPending || state.dataUpdatedAt <= state.sentAt);
}

/**
 * When to read a lease again. A lease lapses on the server only when a board read runs, and a
 * heartbeat moves `expiresAt` without a notice, so the watch tells neither. A lease read at
 * `readAt` already past its expiry means this clock runs ahead by at least that much, so the
 * wait backs off by it; no wait is shorter than the floor or longer than the lease's own span.
 */
export function leaseRecheckDelay(
  lease: Telescope.Lease | undefined,
  now: number,
  readAt: number,
): number | null {
  if (lease === undefined) return null;
  const expiresAt = Date.parse(lease.expiresAt);
  const span = Math.max(expiresAt - Date.parse(lease.heartbeatAt), 5_000);
  return Math.min(Math.max(expiresAt - now, readAt - expiresAt, 5_000), span);
}

/** Pins the write to the version the user saw, so a concurrent change is merged, not lost. */
export function taskUpdateInput(
  task: Telescope.Task,
  change: { readonly set?: Telescope.TaskFields; readonly note?: string },
): typeof Telescope.TaskUpdateInput.Type {
  return { workspaceId: task.workspaceId, taskId: task.id, baseVersion: task.version, ...change };
}

export type TaskUpdateOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "conflict"; readonly decisionId: Telescope.DecisionId }
  | { readonly kind: "kept"; readonly fields: ReadonlyArray<string> };

/** Whether the server kept what was asked, kept a newer value by rule, or opened a decision. */
export function taskUpdateOutcome(
  set: Telescope.TaskFields,
  result: typeof Telescope.TaskUpdateResult.Type,
): TaskUpdateOutcome {
  if (result.conflict !== undefined) return { kind: "conflict", ...result.conflict };
  const saved: Readonly<Record<string, unknown>> = result;
  const fields = Object.entries(set)
    .filter(([key, value]) => JSON.stringify(value ?? null) !== JSON.stringify(saved[key] ?? null))
    .map(([key]) => key);
  return fields.length === 0 ? { kind: "applied" } : { kind: "kept", fields };
}

export function isStaleTaskVersion(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "TelescopeStaleTaskVersionError"
  );
}

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);

/** A write the server refused as `conflict`, such as deciding a proposal someone already decided. */
export function isWorkspaceConflict(error: unknown): boolean {
  return isWorkspaceError(error) && error.reason === "conflict";
}

/** Chinese copy when someone else decided the proposal first; the server's own text is English. */
export function decideFailureText(error: unknown): string | null {
  return isWorkspaceConflict(error) ? "这条提议已经有人决定了，列表已刷新。" : null;
}

/**
 * What one board watch has seen, counted by the reads each item makes stale. `live` while it is
 * subscribed; `epoch` moves when it comes back after a failure, so every read re-reads once.
 */
interface BoardNotices {
  readonly live: boolean;
  readonly lost: boolean;
  readonly epoch: number;
  readonly tasks: number;
  readonly decisions: number;
  readonly delegations: number;
  readonly byTask: Readonly<Record<string, number>>;
}
const NO_NOTICES: BoardNotices = {
  live: false,
  lost: false,
  epoch: 0,
  tasks: 0,
  decisions: 0,
  delegations: 0,
  byTask: {},
};
/** The watch failed and waits to be opened again. */
const LOST = { kind: "lost" } as const;

function countNotice(
  seen: BoardNotices,
  item: Telescope.BoardWatchItem | typeof LOST,
): BoardNotices {
  switch (item.kind) {
    case "lost":
      return { ...seen, live: false, lost: true };
    case "synchronized":
      if (seen.lost) return { ...seen, live: true, lost: false, epoch: seen.epoch + 1 };
      return seen.live ? seen : { ...seen, live: true };
    case "changes": {
      const byTask = { ...seen.byTask };
      for (const { kind, id } of item.changes)
        if (kind === "task") byTask[id] = (byTask[id] ?? 0) + 1;
      const has = (kind: Telescope.BoardChange["kind"]) =>
        item.changes.some((change) => change.kind === kind) ? 1 : 0;
      return {
        ...seen,
        tasks: seen.tasks + has("task"),
        decisions: seen.decisions + has("decision"),
        delegations: seen.delegations + has("delegation"),
        byTask,
      };
    }
  }
}

const isRefused = (error: unknown) =>
  isWorkspaceError(error) && (error.reason === "forbidden" || error.reason === "not_found");

interface BoardTarget {
  readonly environmentId: EnvironmentId;
  readonly input: {
    readonly workspaceId: Telescope.WorkspaceId;
    readonly taskId?: Telescope.TaskId;
  };
}

export function createTelescopeBoardAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // One watch per environment and workspace, open while any of its board reads is cached. Every
  // query already re-reads on a new session, which covers notices missed while disconnected.
  const watch = Atom.family((key: string) => {
    const [environmentId, workspaceId]: [string, string] = JSON.parse(key);
    // A refused member's watch stays failed. Anything else opens it again after 1 s, doubling to
    // 30 s, and back to 1 s once a watch has delivered.
    const watchFrom = (
      failures: number,
    ): Stream.Stream<
      Telescope.BoardWatchItem | typeof LOST,
      EnvironmentRpcStreamFailure<typeof WS_METHODS.boardWatch>,
      EnvironmentSupervisor.EnvironmentSupervisor
    > =>
      Stream.suspend(() => {
        let delivered = false;
        return subscribe(WS_METHODS.boardWatch, {
          workspaceId: Telescope.WorkspaceId.make(workspaceId),
        }).pipe(
          Stream.tap(() => Effect.sync(() => (delivered = true))),
          Stream.catch((error) => {
            if (isRefused(error)) return Stream.fail(error);
            const next = delivered ? 0 : failures;
            const backoff = Effect.sleep(Duration.seconds(Math.min(2 ** next, 30)));
            return Stream.make(LOST).pipe(
              Stream.concat(Stream.drain(Stream.fromEffect(backoff))),
              Stream.concat(watchFrom(next + 1)),
            );
          }),
        );
      });
    const watched = watchFrom(0);
    return runtime
      .atom(
        followStreamInEnvironment(EnvironmentId.make(environmentId), watched).pipe(
          Stream.scan(() => NO_NOTICES, countNotice),
        ),
      )
      .pipe(Atom.withLabel(`telescope:board:watch:${key}`));
  });
  const watchOf = (environmentId: EnvironmentId, workspaceId: Telescope.WorkspaceId) =>
    watch(JSON.stringify([environmentId, workspaceId]));
  /** A board read re-reads when its own count moves, and once more if the watch fails. */
  const noticesFor = (target: BoardTarget, count: (seen: BoardNotices) => number) => {
    const seen = watchOf(target.environmentId, target.input.workspaceId);
    return Atom.make((get) => {
      const result = get(seen);
      if (result._tag === "Failure") return -1;
      const notices = AsyncResult.getOrElse(result, () => NO_NOTICES);
      return notices.epoch + count(notices);
    });
  };
  const byTask = (
    target: BoardTarget & { readonly input: { readonly taskId: Telescope.TaskId } },
  ) => noticesFor(target, (seen) => seen.byTask[target.input.taskId] ?? 0);
  // A refused watch stays failed, so a read answered again (the member is back) reopens it.
  const reopenRefusedWatch = (
    { environmentId, input: { workspaceId } }: BoardTarget,
    _value: unknown,
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() => {
      const seen = watchOf(environmentId, workspaceId);
      if (!registry.getNodes().has(seen)) return;
      const watched = registry.get(seen);
      if (AsyncResult.isFailure(watched) && !watched.waiting) registry.refresh(seen);
    });
  const tasks = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:task:list",
    tag: WS_METHODS.taskList,
    refreshTrigger: (target) => noticesFor(target, (seen) => seen.tasks),
    onAnswer: reopenRefusedWatch,
  });
  const task = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:task:get",
    tag: WS_METHODS.taskGet,
    refreshTrigger: byTask,
    onAnswer: reopenRefusedWatch,
  });
  const decisions = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:decision:list",
    tag: WS_METHODS.decisionList,
    refreshTrigger: (target) => noticesFor(target, (seen) => seen.decisions),
    onAnswer: reopenRefusedWatch,
  });

  // A committed write comes back as a notice on a live watch, so only a refused write, or one
  // without a live watch to echo it, re-reads here. Peeking the node never opens a watch.
  const refreshBoard = (
    { environmentId, input: { workspaceId, taskId } }: BoardTarget,
    registry: AtomRegistry.AtomRegistry,
    exit: Exit.Exit<unknown, unknown>,
  ) =>
    Effect.sync(() => {
      const seen = watchOf(environmentId, workspaceId);
      const watched = registry.getNodes().has(seen) ? registry.get(seen) : undefined;
      const live = watched !== undefined && AsyncResult.isSuccess(watched) && watched.value.live;
      if (Exit.isSuccess(exit) && live) return;
      registry.refresh(tasks({ environmentId, input: { workspaceId } }));
      registry.refresh(decisions({ environmentId, input: { workspaceId } }));
      if (taskId !== undefined)
        registry.refresh(task({ environmentId, input: { workspaceId, taskId } }));
    });

  return {
    tasks,
    task,
    decisions,
    /** Moves once per write that changed a delegation of the workspace. */
    delegationNotices: (target: BoardTarget) => noticesFor(target, (seen) => seen.delegations),
    // A lease is taken, released, or lapsed by a commit to its task's `leaseId`.
    lease: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "telescope:lease:get",
      tag: WS_METHODS.leaseGet,
      refreshTrigger: byTask,
      onAnswer: reopenRefusedWatch,
    }),
    agents: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "telescope:agent:list-mine",
      tag: WS_METHODS.agentListMine,
    }),
    companyAgents: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "telescope:agent:list-company",
      tag: WS_METHODS.agentListCompany,
    }),
    createTask: createEnvironmentRpcCommand(runtime, {
      label: "telescope:task:create",
      tag: WS_METHODS.taskCreate,
      onSettled: refreshBoard,
    }),
    updateTask: createEnvironmentRpcCommand(runtime, {
      label: "telescope:task:update",
      tag: WS_METHODS.taskUpdate,
      onSettled: refreshBoard,
    }),
    createDecision: createEnvironmentRpcCommand(runtime, {
      label: "telescope:decision:create",
      tag: WS_METHODS.decisionCreate,
      onSettled: refreshBoard,
    }),
  };
}
