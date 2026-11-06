import type { Telescope } from "@t3tools/contracts";

export {
  decideInput,
  isStaleTaskVersion,
  sortDecisions,
} from "@t3tools/client-runtime/telescope/taskBoard";

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

export function formatBoardDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1}月${date.getDate()}日`;
}
