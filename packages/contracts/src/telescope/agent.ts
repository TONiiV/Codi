import * as Schema from "effect/Schema";

import { ProjectId } from "../baseSchemas.ts";
import { ModelSelection } from "../modelSelection.ts";
import { ProviderInstanceId } from "../providerInstance.ts";
import {
  AgentId,
  ChannelBindingId,
  Count,
  RoutingRuleId,
  Strings,
  SubjectId,
  Text,
  Timestamp,
  WorkspaceId,
} from "./common.ts";

export const AgentKind = Schema.Literals([
  "chief_of_staff",
  "chief_agent",
  "custom",
  "company_main",
  "department",
]);
export type AgentKind = typeof AgentKind.Type;
export const Channel = Schema.Literals(["telegram", "wechat", "email"]);
export type Channel = typeof Channel.Type;

export const AgentExposure = Schema.Literals(["hidden", "visible", "contactable", "dispatchable"]);

export const StandingPowers = Schema.Struct({
  openTickets: Schema.Boolean,
  dispatchWorkers: Schema.Boolean,
  answerMembers: Schema.Boolean,
  mergePRs: Schema.Boolean,
});

export const Agent = Schema.Struct({
  id: AgentId,
  workspaceId: WorkspaceId,
  /** Null for company agents, which no single member owns. */
  ownerSubjectId: Schema.NullOr(SubjectId),
  kind: AgentKind,
  projectId: Schema.optionalKey(ProjectId),
  name: Text,
  modelSelection: Schema.optionalKey(ModelSelection),
  standingPowers: StandingPowers,
  exposure: AgentExposure,
  syncWithBoard: Schema.Boolean,
  dispatchMode: Schema.Literals(["start", "inbox"]),
  channels: Schema.Array(Channel),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Agent = typeof Agent.Type;

/** The A2A 1.0 Agent Card subset Telescope publishes in-process. */
export const AgentCard = Schema.Struct({
  name: Text,
  description: Schema.String,
  capabilities: Schema.Struct({
    streaming: Schema.Boolean,
    pushNotifications: Schema.Boolean,
  }),
  skills: Schema.Array(
    Schema.Struct({
      id: Text,
      name: Text,
      description: Schema.String,
      tags: Strings,
    }),
  ),
  requiredPermissions: Strings,
  channels: Schema.Array(Channel),
});
export type AgentCard = typeof AgentCard.Type;

export const RoutingRule = Schema.Struct({
  id: RoutingRuleId,
  workspaceId: WorkspaceId,
  projectId: Schema.optionalKey(ProjectId),
  taskType: Text,
  harness: ProviderInstanceId,
  model: Text,
  priority: Count,
});
export type RoutingRule = typeof RoutingRule.Type;

export const ChannelBinding = Schema.Struct({
  id: ChannelBindingId,
  workspaceId: WorkspaceId,
  channel: Channel,
  account: Text,
  counterpart: Text,
  agentId: AgentId,
  subjectId: SubjectId,
  createdAt: Timestamp,
});
export type ChannelBinding = typeof ChannelBinding.Type;
