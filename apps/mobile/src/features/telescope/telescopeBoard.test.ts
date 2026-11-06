import { Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeFailure, reviewQueue, reviewUpdateInput } from "./telescopeBoard";

const workspaceId = Telescope.WorkspaceId.make("w1");

function task(
  id: string,
  status: Telescope.TaskStatus,
  updatedAt: string,
  version = 1,
): Telescope.Task {
  return {
    kind: "task",
    id: Telescope.TaskId.make(id),
    workspaceId,
    title: `Task ${id}`,
    status,
    goalChain: [],
    freeText: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt,
    version,
  };
}

describe("review actions", () => {
  it("lists only tasks awaiting sign-off, decisions first, oldest first", () => {
    const queue = reviewQueue([
      task("doing", "in_progress", "2026-11-01T00:00:00.000Z"),
      task("review-new", "in_review", "2026-11-04T00:00:00.000Z"),
      task("decide", "needs_decision", "2026-11-05T00:00:00.000Z"),
      task("review-old", "in_review", "2026-11-02T00:00:00.000Z"),
      task("done", "done", "2026-11-03T00:00:00.000Z"),
    ]);
    expect(queue.map((item) => item.id)).toEqual(["decide", "review-old", "review-new"]);
  });

  it("pins the update to the version the user saw", () => {
    expect(
      reviewUpdateInput(task("t1", "in_review", "2026-11-04T00:00:00.000Z", 7), "done"),
    ).toEqual({ workspaceId, taskId: "t1", baseVersion: 7, set: { status: "done" } });
  });
});

describe("describeFailure", () => {
  it("refreshes on a stale task version or a conflict, not on other errors", () => {
    const stale = new Telescope.StaleTaskVersionError({
      taskId: Telescope.TaskId.make("t1"),
      baseVersion: 7,
      currentVersion: 8,
    });
    expect(describeFailure(stale)).toMatchObject({ refresh: true, title: "任务已更新" });
    const conflict = new Telescope.WorkspaceError({ reason: "conflict", message: "superseded" });
    expect(describeFailure(conflict)).toMatchObject({ refresh: true, title: "内容已更新" });
    expect(
      describeFailure(new Telescope.WorkspaceError({ reason: "forbidden", message: "nope" })),
    ).toEqual({ refresh: false, title: "操作没有完成", message: "nope" });
    expect(describeFailure(new Error("boom"))).toEqual({
      refresh: false,
      title: "操作没有完成",
      message: "boom",
    });
  });
});
