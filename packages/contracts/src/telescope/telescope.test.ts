import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  Agent,
  BoardItem,
  Delegation,
  MemberSetRoleInput,
  MemoryWrite,
  TaskCommit,
} from "./index.ts";

const at = "2026-11-06T12:00:00.000Z";
const decodeBoardItem = Schema.decodeSync(BoardItem);
const decodeAgent = Schema.decodeSync(Agent);
const decodeTaskCommit = Schema.decodeUnknownSync(TaskCommit);
const decodeSetRole = Schema.decodeUnknownSync(MemberSetRoleInput);
const decodeDelegation = Schema.decodeUnknownSync(Delegation);
const decodeMemoryWrite = Schema.decodeUnknownSync(MemoryWrite);

describe("telescope contracts", () => {
  it("decodes the shapes later tasks persist and rejects values outside the contract", () => {
    const task = decodeBoardItem({
      kind: "task",
      id: "task-1",
      workspaceId: "ws-1",
      title: " Ship invites ",
      status: "needs_decision",
      goalChain: ["Launch"],
      freeText: [{ authorId: "agent-1", text: "blocked on copy", at }],
      createdAt: at,
      updatedAt: at,
      version: 3,
    });
    expect(task).toMatchObject({ kind: "task", title: "Ship invites" });
    expect(
      decodeBoardItem({
        kind: "decision",
        id: "d-1",
        workspaceId: "ws-1",
        title: "SQLite",
        text: "",
        authorId: "u",
        status: "decided",
        createdAt: at,
        updatedAt: at,
        version: 0,
      }).kind,
    ).toBe("decision");

    const company = decodeAgent({
      id: "a-1",
      workspaceId: "ws-1",
      ownerSubjectId: null,
      kind: "company_main",
      name: "Front desk",
      standingPowers: {
        openTickets: true,
        dispatchWorkers: false,
        answerMembers: true,
        mergePRs: false,
      },
      exposure: "contactable",
      syncWithBoard: true,
      dispatchMode: "inbox",
      channels: [],
      createdAt: at,
      updatedAt: at,
    });
    expect(company.ownerSubjectId).toBeNull();

    const commit = {
      id: "c-1",
      workspaceId: "ws-1",
      taskId: "task-1",
      authorId: "u",
      baseVersion: 2,
      changedFields: { status: "done", labels: ["x"] },
      mergeLevel: 1,
      createdAt: at,
    };
    expect(decodeTaskCommit(commit).mergeLevel).toBe(1);
    expect(() => decodeTaskCommit({ ...commit, mergeLevel: 4 })).toThrow();
    expect(() =>
      decodeSetRole({
        workspaceId: "ws-1",
        subjectId: "u",
        role: "owner",
      }),
    ).toThrow();
    const delegation = {
      id: "t-1",
      contextId: "ctx",
      workspaceId: "ws-1",
      fromAgentId: "a-1",
      toAgentId: "a-2",
      brief: { goal: "g", constraints: [], acceptance: [], goalChain: [] },
      messages: [
        {
          messageId: "m-1",
          contextId: "ctx",
          taskId: "t-1",
          role: "agent",
          parts: [{ kind: "text", text: "which repo?" }],
          referenceTaskIds: ["t-0"],
        },
      ],
      artifacts: [{ artifactId: "art-1", parts: [{ kind: "file", uri: "file:///r.md" }] }],
      createdAt: at,
      updatedAt: at,
    };
    for (const state of [
      "SUBMITTED",
      "WORKING",
      "INPUT_REQUIRED",
      "AUTH_REQUIRED",
      "COMPLETED",
      "FAILED",
      "CANCELED",
      "REJECTED",
    ]) {
      expect(decodeDelegation({ ...delegation, state }).state).toBe(state);
    }
    expect(() => decodeDelegation({ ...delegation, state: "working" })).toThrow();
    expect(decodeMemoryWrite({ op: "add", text: "长".repeat(20_000) }).text).toHaveLength(20_000);
    expect(() => decodeMemoryWrite({ op: "add", text: "长".repeat(20_001) })).toThrow();
  });
});
