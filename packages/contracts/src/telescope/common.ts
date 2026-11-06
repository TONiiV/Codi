import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

const makeId = <Brand extends string>(brand: Parameters<typeof Schema.brand<Brand>>[0]) =>
  TrimmedNonEmptyString.pipe(Schema.brand<Brand>(brand));

export const WorkspaceId = makeId("TelescopeWorkspaceId");
export type WorkspaceId = typeof WorkspaceId.Type;
export const InvitationId = makeId("TelescopeInvitationId");
export const AgentId = makeId("TelescopeAgentId");
export const TaskId = makeId("TelescopeTaskId");
export const DecisionId = makeId("TelescopeDecisionId");
export const TaskCommitId = makeId("TelescopeTaskCommitId");
export const LeaseId = makeId("TelescopeLeaseId");
export const GrantId = makeId("TelescopeGrantId");
export const AuditEntryId = makeId("TelescopeAuditEntryId");
export const WakeId = makeId("TelescopeWakeId");
export const AgentRunId = makeId("TelescopeAgentRunId");
export const RunCallId = makeId("TelescopeRunCallId");
export const MemoryId = makeId("TelescopeMemoryId");
export const DelegationId = makeId("TelescopeDelegationId");
export const RoutingRuleId = makeId("TelescopeRoutingRuleId");
export const ChannelBindingId = makeId("TelescopeChannelBindingId");

/** A Codi auth session subject (paired device or desktop owner). */
export const SubjectId = TrimmedNonEmptyString;
export type SubjectId = typeof SubjectId.Type;

export const Strings = Schema.Array(TrimmedNonEmptyString);

/** Who acted, outermost first: the member, then each agent that delegated. */
export const OnBehalfOf = Strings;

export const Timestamp = IsoDateTime;
export const Count = NonNegativeInt;
export const Text = TrimmedNonEmptyString;
