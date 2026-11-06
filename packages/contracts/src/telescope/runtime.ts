import * as Schema from "effect/Schema";

import { EventId, ProjectId, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";
import {
  AgentId,
  AgentRunId,
  Count,
  MemoryId,
  OnBehalfOf,
  RunCallId,
  SubjectId,
  Text,
  Timestamp,
  WakeId,
  WorkspaceId,
} from "./common.ts";

export const WakeReason = Schema.Literals([
  "message",
  "scheduled",
  "dispatch",
  "channel",
  "board_event",
  "maintenance",
]);
export const WakeStatus = Schema.Literals(["queued", "running", "done", "merged", "interrupted"]);

export const Wake = Schema.Struct({
  id: WakeId,
  workspaceId: WorkspaceId,
  reason: WakeReason,
  agentId: AgentId,
  coalesceKey: Text,
  priority: Schema.Literals([1, 2, 3]),
  subjectId: SubjectId,
  threadId: Schema.optionalKey(ThreadId),
  payload: Schema.Json,
  status: WakeStatus,
  createdAt: Timestamp,
  startedAt: Schema.optionalKey(Timestamp),
  finishedAt: Schema.optionalKey(Timestamp),
});
export type Wake = typeof Wake.Type;

export const RunResultLabel = Schema.Literals([
  "approved",
  "rewritten",
  "rejected",
  "reverted",
  "completed",
  "merged",
  "escalated",
  "ignored",
]);

export const RunTokens = Schema.Struct({
  input: Count,
  cachedInput: Count,
  cacheCreation: Count,
  output: Count,
});

/** Everything that shaped a run, so a result can be attributed to what changed. */
export const RunInputSnapshot = Schema.Struct({
  promptVersion: Text,
  skillsVersions: Schema.Record(Schema.String, Schema.String),
  powersVersion: Text,
  model: Text,
  contextManifest: Schema.Array(Schema.Struct({ kind: Text, id: Text, hash: Text })),
});

export const AgentRun = Schema.Struct({
  id: AgentRunId,
  workspaceId: WorkspaceId,
  agentId: AgentId,
  onBehalfOf: OnBehalfOf,
  inputSnapshot: RunInputSnapshot,
  startedAt: Timestamp,
  finishedAt: Schema.optionalKey(Timestamp),
  orchestrationEventId: Schema.optionalKey(EventId),
  threadId: Schema.optionalKey(ThreadId),
  resultLabels: Schema.Array(RunResultLabel),
  tokens: RunTokens,
});
export type AgentRun = typeof AgentRun.Type;

export const RunCall = Schema.Struct({
  id: RunCallId,
  workspaceId: WorkspaceId,
  runId: AgentRunId,
  seq: Count,
  tool: Text,
  args: Schema.Json,
  grantCheck: Schema.Literals(["allowed", "denied"]),
  tokens: Schema.optionalKey(Count),
  durationMs: Count,
  at: Timestamp,
});
export type RunCall = typeof RunCall.Type;

export const MemoryScope = Schema.Literals(["personal", "project", "person"]);
export const MemoryLevel = Schema.Literals(["private", "confidential", "internal"]);

export const Memory = Schema.Struct({
  id: MemoryId,
  workspaceId: WorkspaceId,
  agentId: AgentId,
  scope: MemoryScope,
  level: MemoryLevel,
  projectId: Schema.optionalKey(ProjectId),
  aboutSubjectId: Schema.optionalKey(SubjectId),
  kind: Text,
  text: Text,
  source: Schema.Struct({
    runId: Schema.optionalKey(AgentRunId),
    threadId: Schema.optionalKey(ThreadId),
    channel: Schema.optionalKey(TrimmedNonEmptyString),
  }),
  pinned: Schema.Boolean,
  validFrom: Timestamp,
  invalidAt: Schema.optionalKey(Timestamp),
  lastRetrievedAt: Schema.optionalKey(Timestamp),
  uses: Count,
  rev: Count,
  deleted: Schema.Boolean,
});
export type Memory = typeof Memory.Type;
