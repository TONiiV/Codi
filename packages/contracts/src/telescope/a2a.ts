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
  "REJECTED",
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
  referenceTaskIds: Schema.optionalKey(Schema.Array(DelegationId)),
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

/** Outcome only; the state is `Delegation.state` and outputs are `Delegation.artifacts`. */
export const DelegationReport = Schema.Struct({
  result: Schema.String,
  decisions: Strings,
  blockedOn: Schema.optionalKey(Text),
  needsFrom: Schema.optionalKey(Text),
});

/**
 * An A2A task between two agents; `id` is the A2A task id. `brief` and `report` are the typed
 * payloads of the first message down and the final message up in `messages`.
 */
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
  messages: Schema.Array(A2AMessage),
  artifacts: Schema.Array(A2AArtifact),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Delegation = typeof Delegation.Type;
