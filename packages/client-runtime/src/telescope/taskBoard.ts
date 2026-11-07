import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
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

/** Reports oldest first; an offline commit can append an entry older than the last one. */
export function reportsInOrder(
  entries: Telescope.Task["freeText"],
): ReadonlyArray<Telescope.Task["freeText"][number]> {
  return [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
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

/** Chinese copy when someone else decided the proposal first; the server's own text is English. */
export function decideFailureText(error: unknown): string | null {
  return isWorkspaceError(error) && error.reason === "conflict"
    ? "这条提议已经有人决定了，列表已刷新。"
    : null;
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
  const tasks = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:task:list",
    tag: WS_METHODS.taskList,
  });
  const task = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:task:get",
    tag: WS_METHODS.taskGet,
  });
  const decisions = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:decision:list",
    tag: WS_METHODS.decisionList,
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
    lease: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "telescope:lease:get",
      tag: WS_METHODS.leaseGet,
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
