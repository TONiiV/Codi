import * as Schema from "effect/Schema";

import { ProjectId } from "../baseSchemas.ts";
import { StandingPowers } from "./agent.ts";
import {
  AgentId,
  AgentRunId,
  AuditEntryId,
  OnBehalfOf,
  Text,
  Timestamp,
  WorkspaceId,
} from "./common.ts";

export const GrantPower = Schema.Literals([
  "openTickets",
  "dispatchWorkers",
  "answerMembers",
  "mergePRs",
]);
export type GrantPower = typeof GrantPower.Type;

/** `role` is the member's workspace role, `agent` one agent in the chain, `project` its rule. */
export const GrantLayer = Schema.Literals(["role", "agent", "project"]);
export type GrantLayer = typeof GrantLayer.Type;

export const EffectiveGrant = Schema.Struct({
  workspaceId: WorkspaceId,
  agentId: AgentId,
  /** The member first, then each agent that delegated down to `agentId`. */
  onBehalfOf: OnBehalfOf,
  projectId: Schema.optionalKey(ProjectId),
  powers: StandingPowers,
});
export type EffectiveGrant = typeof EffectiveGrant.Type;

export const GrantPowerExplanation = Schema.Struct({
  power: GrantPower,
  allowed: Schema.Boolean,
  /** The first layer along the chain that lacks the power. */
  removedBy: Schema.optionalKey(
    Schema.Struct({ layer: GrantLayer, agentId: Schema.optionalKey(AgentId), reason: Text }),
  ),
});
export type GrantPowerExplanation = typeof GrantPowerExplanation.Type;

export const GrantExplainResult = Schema.Struct({
  ...EffectiveGrant.fields,
  explanations: Schema.Array(GrantPowerExplanation),
});
export type GrantExplainResult = typeof GrantExplainResult.Type;

/** Explains a grant for the calling member's own agents, delegating through `via` first. */
export const GrantExplainInput = Schema.Struct({
  workspaceId: WorkspaceId,
  agentId: AgentId,
  via: Schema.optionalKey(Schema.Array(AgentId)),
  projectId: Schema.optionalKey(ProjectId),
});

export const AuditOutcome = Schema.Literals(["allowed", "denied"]);

export const AuditEntry = Schema.Struct({
  id: AuditEntryId,
  workspaceId: WorkspaceId,
  runId: Schema.optionalKey(AgentRunId),
  agentId: AgentId,
  onBehalfOf: OnBehalfOf,
  projectId: Schema.optionalKey(ProjectId),
  power: GrantPower,
  tool: Schema.optionalKey(Text),
  argsRedacted: Schema.optionalKey(Schema.Json),
  outcome: AuditOutcome,
  reason: Schema.optionalKey(Schema.String),
  createdAt: Timestamp,
});
export type AuditEntry = typeof AuditEntry.Type;

export const GrantAuditListInput = Schema.Struct({
  workspaceId: WorkspaceId,
  /** The last entry of the previous page; entries are newest first, then by id. */
  before: Schema.optionalKey(Schema.Struct({ createdAt: Timestamp, auditId: AuditEntryId })),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
});
export const GrantAuditListResult = Schema.Struct({ entries: Schema.Array(AuditEntry) });
