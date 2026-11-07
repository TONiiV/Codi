import * as Schema from "effect/Schema";

import { ProjectId } from "../baseSchemas.ts";
import { ModelSelection } from "../modelSelection.ts";
import { ProviderInstanceId } from "../providerInstance.ts";
import { RoutingRule } from "./agent.ts";
import { AgentId, RoutingRuleId, Text, WorkspaceId } from "./common.ts";

/** A rule with this task type matches every task type, after the rules naming it exactly. */
export const ANY_TASK_TYPE = "*";

/** As on memory inputs, the caps only stop huge values being stored. */
export const ROUTING_TASK_TYPE_MAX = 64;
export const ROUTING_MODEL_MAX = 128;
export const ROUTING_ALLOWLIST_MAX = 64;
const TaskType = Text.check(Schema.isMaxLength(ROUTING_TASK_TYPE_MAX));
const Model = Text.check(Schema.isMaxLength(ROUTING_MODEL_MAX));
const allowlistLength = Schema.isMaxLength(ROUTING_ALLOWLIST_MAX);

/** A project rule's narrowing of routing. An empty or absent list allows any. */
export const RoutingAllowlist = Schema.Struct({
  harnesses: Schema.optionalKey(Schema.Array(ProviderInstanceId).check(allowlistLength)),
  models: Schema.optionalKey(Schema.Array(Model).check(allowlistLength)),
});
export type RoutingAllowlist = typeof RoutingAllowlist.Type;

/** Without `id` this creates a rule; with one it replaces that rule. */
export const RoutingRuleSetInput = Schema.Struct({
  ...RoutingRule.fields,
  taskType: TaskType,
  model: Model,
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
  /** Defaults to the agent's own project; for a project-bound agent any other is a `conflict`. */
  projectId: Schema.optionalKey(ProjectId),
  taskType: TaskType,
});

/** `harness_unavailable`: not configured on this server, or disabled on it or for the project. */
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
