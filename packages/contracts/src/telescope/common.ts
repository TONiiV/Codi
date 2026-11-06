import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  makeEntityId,
  NonNegativeInt,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";

export const WorkspaceId = makeEntityId("TelescopeWorkspaceId");
export type WorkspaceId = typeof WorkspaceId.Type;
export const InvitationId = makeEntityId("TelescopeInvitationId");
export type InvitationId = typeof InvitationId.Type;
export const AgentId = makeEntityId("TelescopeAgentId");
export type AgentId = typeof AgentId.Type;
export const TaskId = makeEntityId("TelescopeTaskId");
export type TaskId = typeof TaskId.Type;
export const DecisionId = makeEntityId("TelescopeDecisionId");
export type DecisionId = typeof DecisionId.Type;
export const TaskCommitId = makeEntityId("TelescopeTaskCommitId");
export type TaskCommitId = typeof TaskCommitId.Type;
export const LeaseId = makeEntityId("TelescopeLeaseId");
export type LeaseId = typeof LeaseId.Type;
export const GrantId = makeEntityId("TelescopeGrantId");
export type GrantId = typeof GrantId.Type;
export const AuditEntryId = makeEntityId("TelescopeAuditEntryId");
export type AuditEntryId = typeof AuditEntryId.Type;
export const WakeId = makeEntityId("TelescopeWakeId");
export type WakeId = typeof WakeId.Type;
export const AgentRunId = makeEntityId("TelescopeAgentRunId");
export type AgentRunId = typeof AgentRunId.Type;
export const RunCallId = makeEntityId("TelescopeRunCallId");
export type RunCallId = typeof RunCallId.Type;
export const MemoryId = makeEntityId("TelescopeMemoryId");
export type MemoryId = typeof MemoryId.Type;
export const DelegationId = makeEntityId("TelescopeDelegationId");
export type DelegationId = typeof DelegationId.Type;
export const RoutingRuleId = makeEntityId("TelescopeRoutingRuleId");
export type RoutingRuleId = typeof RoutingRuleId.Type;
export const ChannelBindingId = makeEntityId("TelescopeChannelBindingId");
export type ChannelBindingId = typeof ChannelBindingId.Type;

/** A board commit targets either kind of board item. */
export const BoardItemId = Schema.Union([TaskId, DecisionId]);
export type BoardItemId = typeof BoardItemId.Type;

/** A Codi auth session subject (paired device or desktop owner). */
export const SubjectId = TrimmedNonEmptyString;
export type SubjectId = typeof SubjectId.Type;

export const Strings = Schema.Array(TrimmedNonEmptyString);

/** Who acted, outermost first: the member, then each agent that delegated. */
export const OnBehalfOf = Strings;

export const Timestamp = IsoDateTime;
export const Count = NonNegativeInt;
export const Text = TrimmedNonEmptyString;
