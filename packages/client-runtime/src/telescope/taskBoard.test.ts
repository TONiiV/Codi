import { Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DECISION_STATUSES,
  decideFailureText,
  decideInput,
  decisionOptionsLocked,
  isStaleTaskVersion,
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
