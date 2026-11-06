import { Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  decideInput,
  isStaleTaskVersion,
  sortDecisions,
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
  it("puts every task in its status column and keeps empty columns", () => {
    const columns = tasksByStatus([
      task("a", "todo"),
      task("b", "done"),
      task("c", "todo"),
      task("d", "needs_decision"),
    ]);
    expect(Object.keys(columns)).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "done",
      "needs_decision",
      "dropped",
    ]);
    expect(columns.todo.map((item) => item.id)).toEqual(["a", "c"]);
    expect(columns.needs_decision.map((item) => item.id)).toEqual(["d"]);
    expect(columns.in_progress).toEqual([]);
  });
});

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
});
