import * as Schema from "effect/Schema";

import { ProjectId } from "../baseSchemas.ts";
import { ModelSelection } from "../modelSelection.ts";
import { ProviderInstanceId } from "../providerInstance.ts";
import { RoutingRule } from "./agent.ts";
import { AgentId, RoutingRuleId, Strings, Text, WorkspaceId } from "./common.ts";

/** A rule with this task type matches every task type, after the rules naming it exactly. */
export const ANY_TASK_TYPE = "*";

/** A project rule's narrowing of routing. An empty or absent list allows any. */
export const RoutingAllowlist = Schema.Struct({
  harnesses: Schema.optionalKey(Schema.Array(ProviderInstanceId)),
  models: Schema.optionalKey(Strings),
});
export type RoutingAllowlist = typeof RoutingAllowlist.Type;

/** Without `id` this creates a rule; with one it replaces that rule. */
export const RoutingRuleSetInput = Schema.Struct({
  ...RoutingRule.fields,
  id: Schema.optionalKey(RoutingRuleId),
});
export const RoutingRuleDeleteInput = Schema.Struct({
  workspaceId: WorkspaceId,
  id: RoutingRuleId,
});
/** Earlier rules first, which is the order ties resolve in. */
export const RoutingRuleListResult = Schema.Struct({ rules: Schema.Array(RoutingRule) });

export const RoutingResolveInput = Schema.Struct({
  workspaceId: WorkspaceId,
  agentId: AgentId,
  /** Defaults to the agent's own project. */
  projectId: Schema.optionalKey(ProjectId),
  taskType: Text,
});

/** `harness_unavailable`: not configured, or disabled, on this server. */
export const RoutingSkipReason = Schema.Literals([
  "harness_not_allowed",
  "model_not_allowed",
  "harness_unavailable",
]);
export type RoutingSkipReason = typeof RoutingSkipReason.Type;

export const RoutingResolution = Schema.Struct({
  /**
   * `none`: no rule matched and the agent has no model of its own. `none_allowed`: every candidate
   * was skipped, so nothing may run.
   */
  source: Schema.Literals(["rule", "agent_default", "none", "none_allowed"]),
  ruleId: Schema.optionalKey(RoutingRuleId),
  modelSelection: Schema.optionalKey(ModelSelection),
  /** Candidates passed over, in order. One without `ruleId` is the agent's own model. */
  skipped: Schema.Array(
    Schema.Struct({ ruleId: Schema.optionalKey(RoutingRuleId), reason: RoutingSkipReason }),
  ),
});
export type RoutingResolution = typeof RoutingResolution.Type;
