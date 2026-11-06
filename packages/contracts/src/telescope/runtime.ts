import * as Schema from "effect/Schema";

import { EventId, ProjectId, ThreadId } from "../baseSchemas.ts";
import { Channel } from "./agent.ts";
import {
  AgentId,
  AgentRunId,
  Count,
  GrantId,
  MemoryId,
  OnBehalfOf,
  RunCallId,
  SubjectId,
  TaskId,
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
  /** 1 a conversation someone is waiting on, 2 dispatched work, 3 scheduled or background. */
  priority: Schema.Literals([1, 2, 3]),
  subjectId: SubjectId,
  threadId: Schema.optionalKey(ThreadId),
  taskId: Schema.optionalKey(TaskId),
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

export const ContextManifestKind = Schema.Literals([
  "memory",
  "diary",
  "board",
  "thread",
  "skill",
  "prompt",
]);
export type ContextManifestKind = typeof ContextManifestKind.Type;

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
  contextManifest: Schema.Array(Schema.Struct({ kind: ContextManifestKind, id: Text, hash: Text })),
});

export const AgentRun = Schema.Struct({
  id: AgentRunId,
  workspaceId: WorkspaceId,
  agentId: AgentId,
  wakeId: Schema.optionalKey(WakeId),
  grantId: Schema.optionalKey(GrantId),
  onBehalfOf: OnBehalfOf,
  inputSnapshot: RunInputSnapshot,
  startedAt: Timestamp,
  finishedAt: Schema.optionalKey(Timestamp),
  orchestrationEventId: Schema.optionalKey(EventId),
  threadId: Schema.optionalKey(ThreadId),
  resultLabels: Schema.Array(RunResultLabel),
  tokens: RunTokens,
  outputSummary: Schema.optionalKey(Text),
});
export type AgentRun = typeof AgentRun.Type;

export const RunCall = Schema.Struct({
  id: RunCallId,
  workspaceId: WorkspaceId,
  runId: AgentRunId,
  seq: Count,
  tool: Text,
  args: Schema.Json,
  grantId: Schema.optionalKey(GrantId),
  grantCheck: Schema.Literals(["allowed", "denied"]),
  tokens: Schema.optionalKey(Count),
  durationMs: Count,
  at: Timestamp,
});
export type RunCall = typeof RunCall.Type;

export const RunListInput = Schema.Struct({
  workspaceId: WorkspaceId,
  agentId: Schema.optionalKey(AgentId),
  threadId: Schema.optionalKey(ThreadId),
  /** The last run of the previous page; runs are ordered by start time, then id. */
  before: Schema.optionalKey(Schema.Struct({ startedAt: Timestamp, runId: AgentRunId })),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
});
export const RunListResult = Schema.Struct({ runs: Schema.Array(AgentRun) });
export const RunScopedInput = Schema.Struct({ workspaceId: WorkspaceId, runId: AgentRunId });
export const RunCallsResult = Schema.Struct({ calls: Schema.Array(RunCall) });

export const MemoryScope = Schema.Literals(["personal", "project", "person"]);
/** `person` records belong to company agents only; the memory service enforces that. */
export const MemoryLayer = Schema.Literals(["working", "thread", "diary", "long_term", "person"]);
export type MemoryLayer = typeof MemoryLayer.Type;
export const MemoryLevel = Schema.Literals(["private", "confidential", "internal"]);

export const Memory = Schema.Struct({
  id: MemoryId,
  workspaceId: WorkspaceId,
  agentId: AgentId,
  scope: MemoryScope,
  layer: MemoryLayer,
  level: MemoryLevel,
  projectId: Schema.optionalKey(ProjectId),
  aboutSubjectId: Schema.optionalKey(SubjectId),
  kind: Text,
  text: Text,
  source: Schema.Struct({
    runId: Schema.optionalKey(AgentRunId),
    threadId: Schema.optionalKey(ThreadId),
    channel: Schema.optionalKey(Channel),
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
