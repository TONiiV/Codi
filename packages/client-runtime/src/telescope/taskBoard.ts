import { EnvironmentId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe } from "../rpc/client.ts";
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

/** The notices one board watch has seen, counted by the reads each one makes stale. */
interface BoardNotices {
  readonly tasks: number;
  readonly decisions: number;
  readonly byTask: Readonly<Record<string, number>>;
}
const NO_NOTICES: BoardNotices = { tasks: 0, decisions: 0, byTask: {} };

function countNotice(seen: BoardNotices, item: Telescope.BoardWatchItem): BoardNotices {
  switch (item.kind) {
    case "synchronized":
      return seen;
    case "decision":
      return { ...seen, decisions: seen.decisions + 1 };
    case "task":
      return {
        ...seen,
        tasks: seen.tasks + 1,
        byTask: { ...seen.byTask, [item.id]: (seen.byTask[item.id] ?? 0) + 1 },
      };
  }
}

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
    const watched = subscribe(WS_METHODS.boardWatch, {
      workspaceId: Telescope.WorkspaceId.make(workspaceId),
    });
    return runtime
      .atom(
        followStreamInEnvironment(EnvironmentId.make(environmentId), watched).pipe(
          Stream.scan(() => NO_NOTICES, countNotice),
        ),
      )
      .pipe(Atom.withLabel(`telescope:board:watch:${key}`));
  });
  /** A board read re-reads when its own count moves, and once more if the watch fails. */
  const noticesFor = (target: BoardTarget, count: (seen: BoardNotices) => number) => {
    const seen = watch(JSON.stringify([target.environmentId, target.input.workspaceId]));
    return Atom.make((get) => {
      const result = get(seen);
      return result._tag === "Failure"
        ? -1
        : count(AsyncResult.getOrElse(result, () => NO_NOTICES));
    });
  };
  const tasks = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:task:list",
    tag: WS_METHODS.taskList,
    refreshTrigger: (target) => noticesFor(target, (seen) => seen.tasks),
  });
  const task = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:task:get",
    tag: WS_METHODS.taskGet,
    refreshTrigger: (target) => noticesFor(target, (seen) => seen.byTask[target.input.taskId] ?? 0),
  });
  const decisions = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:decision:list",
    tag: WS_METHODS.decisionList,
    refreshTrigger: (target) => noticesFor(target, (seen) => seen.decisions),
  });

  // A merged or conflicting write changes the board as well, so every write refreshes on settle.
  const refreshBoard = (
    { environmentId, input: { workspaceId, taskId } }: BoardTarget,
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() => {
      registry.refresh(tasks({ environmentId, input: { workspaceId } }));
      registry.refresh(decisions({ environmentId, input: { workspaceId } }));
      if (taskId !== undefined)
        registry.refresh(task({ environmentId, input: { workspaceId, taskId } }));
    });

  return {
    tasks,
    task,
    decisions,
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
