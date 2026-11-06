import * as Schema from "effect/Schema";

import { PositiveInt, ProjectId, ThreadId } from "../baseSchemas.ts";
import {
  AgentId,
  AgentRunId,
  BoardItemId,
  Count,
  DecisionId,
  LeaseId,
  OnBehalfOf,
  Strings,
  SubjectId,
  TaskCommitId,
  TaskId,
  Text,
  Timestamp,
  WorkspaceId,
} from "./common.ts";

export const TaskStatus = Schema.Literals([
  "todo",
  "in_progress",
  "in_review",
  "done",
  "dropped",
  "needs_decision",
]);
export type TaskStatus = typeof TaskStatus.Type;

export const ForgeIssueRef = Schema.Struct({
  provider: Text,
  repo: Text,
  number: PositiveInt,
  url: Text,
});

/** Comments and reports live beside the structured fields, never inside them. */
export const FreeTextEntry = Schema.Struct({ authorId: Text, text: Schema.String, at: Timestamp });

export const Task = Schema.Struct({
  kind: Schema.Literal("task"),
  id: TaskId,
  workspaceId: WorkspaceId,
  projectId: Schema.optionalKey(ProjectId),
  title: Text,
  status: TaskStatus,
  ownerSubjectId: Schema.optionalKey(SubjectId),
  ownerAgentId: Schema.optionalKey(AgentId),
  leaseId: Schema.optionalKey(LeaseId),
  forgeIssue: Schema.optionalKey(ForgeIssueRef),
  threadId: Schema.optionalKey(ThreadId),
  goalChain: Strings,
  freeText: Schema.Array(FreeTextEntry),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  version: Count,
});
export type Task = typeof Task.Type;

export const DecisionStatus = Schema.Literals(["proposed", "decided", "superseded"]);

export const Decision = Schema.Struct({
  kind: Schema.Literal("decision"),
  id: DecisionId,
  workspaceId: WorkspaceId,
  title: Text,
  text: Schema.String,
  supersedes: Schema.optionalKey(DecisionId),
  authorId: Text,
  status: DecisionStatus,
  options: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Text, label: Text }))),
  chosen: Schema.optionalKey(Text),
  decidedBy: Schema.optionalKey(Text),
  decidedAt: Schema.optionalKey(Timestamp),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  version: Count,
});
export type Decision = typeof Decision.Type;

export const BoardItem = Schema.Union([Task, Decision]);
export type BoardItem = typeof BoardItem.Type;

/** Conflict ladder: 0 auto-merge, 1 by rule, 2 the company main agent rules, 3 escalated to the owner. */
export const MergeLevel = Schema.Literals([0, 1, 2, 3]);

export const TaskCommit = Schema.Struct({
  id: TaskCommitId,
  parentId: Schema.optionalKey(TaskCommitId),
  workspaceId: WorkspaceId,
  taskId: BoardItemId,
  runId: Schema.optionalKey(AgentRunId),
  authorId: Text,
  onBehalfOf: Schema.optionalKey(OnBehalfOf),
  deviceSig: Schema.optionalKey(Text),
  baseVersion: Count,
  changedFields: Schema.Record(Schema.String, Schema.Json),
  mergeLevel: MergeLevel,
  mergeReason: Schema.optionalKey(Schema.String),
  createdAt: Timestamp,
});
export type TaskCommit = typeof TaskCommit.Type;

export const Lease = Schema.Struct({
  id: LeaseId,
  workspaceId: WorkspaceId,
  taskId: TaskId,
  holderAgentId: AgentId,
  holderSubjectId: SubjectId,
  acquiredAt: Timestamp,
  heartbeatAt: Timestamp,
  expiresAt: Timestamp,
});
export type Lease = typeof Lease.Type;
