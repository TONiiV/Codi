import * as Schema from "effect/Schema";

import { AgentId, DelegationId, Strings, Text, Timestamp, WorkspaceId } from "./common.ts";

/** A2A task states, in-process only; no A2A HTTP transport. */
export const A2ATaskState = Schema.Literals([
  "SUBMITTED",
  "WORKING",
  "INPUT_REQUIRED",
  "AUTH_REQUIRED",
  "COMPLETED",
  "FAILED",
  "CANCELED",
]);
export type A2ATaskState = typeof A2ATaskState.Type;

export const A2APart = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("data"), data: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("file"), uri: Text, mimeType: Schema.optionalKey(Text) }),
]);

export const A2AMessage = Schema.Struct({
  messageId: Text,
  contextId: Text,
  taskId: Schema.optionalKey(DelegationId),
  role: Schema.Literals(["user", "agent"]),
  parts: Schema.Array(A2APart),
});
export type A2AMessage = typeof A2AMessage.Type;

export const A2AArtifact = Schema.Struct({
  artifactId: Text,
  name: Schema.optionalKey(Text),
  parts: Schema.Array(A2APart),
});
export type A2AArtifact = typeof A2AArtifact.Type;

export const DelegationBrief = Schema.Struct({
  goal: Text,
  constraints: Strings,
  deadline: Schema.optionalKey(Timestamp),
  acceptance: Strings,
  preferences: Schema.optionalKey(Strings),
  goalChain: Strings,
});

export const DelegationReport = Schema.Struct({
  status: A2ATaskState,
  result: Schema.String,
  artifacts: Schema.Array(Schema.Struct({ kind: Text, url: Text })),
  decisions: Strings,
  blockedOn: Schema.optionalKey(Text),
  needsFrom: Schema.optionalKey(Text),
});

/** An A2A task between two agents; `id` is the A2A task id. */
export const Delegation = Schema.Struct({
  id: DelegationId,
  contextId: Text,
  parentId: Schema.optionalKey(DelegationId),
  workspaceId: WorkspaceId,
  fromAgentId: AgentId,
  toAgentId: AgentId,
  state: A2ATaskState,
  brief: DelegationBrief,
  report: Schema.optionalKey(DelegationReport),
  referenceTaskIds: Schema.Array(DelegationId),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Delegation = typeof Delegation.Type;
