import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EnvironmentId, PositiveInt, ThreadId } from "../baseSchemas.ts";
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
  TelescopeProjectId,
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

export const TaskPriority = Schema.Literals(["high", "medium", "low"]);
export type TaskPriority = typeof TaskPriority.Type;

/** A calendar day, `YYYY-MM-DD`, with no time zone. */
export const TaskDueDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
);

export const ForgeIssueRef = Schema.Struct({
  provider: Text,
  repo: Text,
  number: PositiveInt,
  url: Text,
});

/** Comments and reports live beside the structured fields, never inside them. */
export const FreeTextEntry = Schema.Struct({ authorId: Text, text: Schema.String, at: Timestamp });

/** A Code thread on any environment; it belongs to at most one task, and unlinking keeps it. */
export const TaskThread = Schema.Struct({ environmentId: EnvironmentId, threadId: ThreadId });
export type TaskThread = typeof TaskThread.Type;

export const Task = Schema.Struct({
  kind: Schema.Literal("task"),
  id: TaskId,
  workspaceId: WorkspaceId,
  projectId: Schema.optionalKey(TelescopeProjectId),
  title: Text,
  status: TaskStatus,
  ownerSubjectId: Schema.optionalKey(SubjectId),
  ownerAgentId: Schema.optionalKey(AgentId),
  leaseId: Schema.optionalKey(LeaseId),
  /** The open decision (需要你定) an older server's stale write opened; settling it clears this. */
  conflictDecisionId: Schema.optionalKey(DecisionId),
  forgeIssue: Schema.optionalKey(ForgeIssueRef),
  dueDate: Schema.optionalKey(TaskDueDate),
  priority: Schema.optionalKey(TaskPriority),
  /** Markdown. `task.list` leaves it out; `task.get` has it. */
  body: Schema.optionalKey(Schema.String),
  /** Oldest link first. An older server sends none. */
  threads: Schema.Array(TaskThread).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  goalChain: Strings,
  freeText: Schema.Array(FreeTextEntry),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  version: Count,
});
export type Task = typeof Task.Type;

export const DecisionStatus = Schema.Literals(["proposed", "decided", "superseded"]);
export type DecisionStatus = typeof DecisionStatus.Type;

/** What a conflict proposal settles: deciding it with `chosen: "incoming"` applies `incoming`. */
export const TaskConflict = Schema.Struct({
  taskId: TaskId,
  incoming: Schema.Record(Schema.String, Schema.Json),
});
export type TaskConflict = typeof TaskConflict.Type;

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
  conflict: Schema.optionalKey(TaskConflict),
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
