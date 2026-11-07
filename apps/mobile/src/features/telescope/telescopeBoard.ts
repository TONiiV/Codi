import type { Telescope } from "@t3tools/contracts";

import { isStaleTaskVersion } from "@t3tools/client-runtime/telescope/taskBoard";

export { decideInput, sortDecisions } from "@t3tools/client-runtime/telescope/taskBoard";

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

function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "TelescopeWorkspaceError" &&
    "reason" in error &&
    error.reason === "conflict"
  );
}

/** What a failed decision or task command should do: refresh the list it acted on, and say what happened. */
export function describeFailure(error: unknown): {
  refresh: boolean;
  title: string;
  message: string;
} {
  if (isStaleTaskVersion(error)) {
    return {
      refresh: true,
      title: "任务已更新",
      message: "有人刚改过这条任务，列表已刷新，请再看一眼。",
    };
  }
  if (isConflict(error)) {
    return {
      refresh: true,
      title: "内容已更新",
      message: "这条内容刚被改过，列表已刷新，请再看一眼。",
    };
  }
  return {
    refresh: false,
    title: "操作没有完成",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function formatBoardDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1}月${date.getDate()}日`;
}
