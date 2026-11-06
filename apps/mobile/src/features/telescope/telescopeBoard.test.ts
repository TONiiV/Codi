import { Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  decideInput,
  isStaleTaskVersion,
  reviewQueue,
  reviewUpdateInput,
  sortDecisions,
} from "./telescopeBoard";

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

describe("sortDecisions", () => {
  it("puts proposals first, then decided, then superseded, newest first in each", () => {
    const sorted = sortDecisions([
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
    ]);
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
});
