import type { Telescope } from "@t3tools/contracts";

const DECISION_ORDER = { proposed: 0, decided: 1, superseded: 2 } as const;

/** Proposals waiting on someone first, then the record, newest first within each group. */
export function sortDecisions(
  decisions: ReadonlyArray<Telescope.Decision>,
): ReadonlyArray<Telescope.Decision> {
  return [...decisions].sort(
    (a, b) =>
      DECISION_ORDER[a.status] - DECISION_ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** Choosing an option records a new decided decision that retires the proposal. */
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

const REVIEW_STATUSES: ReadonlySet<Telescope.TaskStatus> = new Set(["needs_decision", "in_review"]);

/** Tasks a person has to sign off: waiting on a decision first, oldest first within each. */
export function reviewQueue(tasks: ReadonlyArray<Telescope.Task>): ReadonlyArray<Telescope.Task> {
  return tasks
    .filter((task) => REVIEW_STATUSES.has(task.status))
    .sort(
      (a, b) =>
        Number(b.status === "needs_decision") - Number(a.status === "needs_decision") ||
        a.updatedAt.localeCompare(b.updatedAt),
    );
}

/** Pins the update to the version the user saw, so a concurrent change is rejected, not lost. */
export function reviewUpdateInput(
  task: Telescope.Task,
  status: "done" | "in_progress",
): typeof Telescope.TaskUpdateInput.Type {
  return {
    workspaceId: task.workspaceId,
    taskId: task.id,
    baseVersion: task.version,
    set: { status },
  };
}

export function isStaleTaskVersion(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "TelescopeStaleTaskVersionError"
  );
}

export function formatBoardDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1}月${date.getDate()}日`;
}
