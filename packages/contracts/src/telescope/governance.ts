import * as Schema from "effect/Schema";

import {
  AgentId,
  Count,
  GrantId,
  OnBehalfOf,
  Strings,
  SubjectId,
  Text,
  Timestamp,
  WorkspaceId,
} from "./common.ts";

const Usd = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const Grant = Schema.Struct({
  id: GrantId,
  workspaceId: WorkspaceId,
  onBehalfOf: OnBehalfOf,
  files: Strings,
  homeDirs: Strings,
  tools: Schema.Array(Schema.Struct({ name: Text, allowedArgs: Schema.optionalKey(Strings) })),
  hosts: Schema.Array(Schema.Struct({ host: Text, methods: Strings, pathPrefix: Schema.String })),
  secretHandles: Strings,
  skills: Schema.Array(Schema.Struct({ name: Text, version: Text })),
  budget: Schema.Struct({ tokens: Schema.optionalKey(Count), usd: Schema.optionalKey(Usd) }),
  expiresAt: Timestamp,
  revokedAt: Schema.optionalKey(Timestamp),
});
export type Grant = typeof Grant.Type;

export const BudgetScope = Schema.Literals(["company", "project", "agent", "person"]);

export const Budget = Schema.Struct({
  workspaceId: WorkspaceId,
  scope: BudgetScope,
  scopeId: Text,
  limitTokens: Schema.optionalKey(Count),
  limitUsd: Schema.optionalKey(Usd),
  /** Tool calls the gateway lets through at this level; it counts each one it allows. */
  limitCalls: Schema.optionalKey(Count),
  usedTokens: Count,
  usedUsd: Usd,
  usedCalls: Count,
  paused: Schema.Boolean,
});
export type Budget = typeof Budget.Type;

/** `scopeId` is a project, agent or member id; a company budget always uses the workspace id. */
export const BudgetSetInput = Schema.Struct({
  workspaceId: WorkspaceId,
  scope: BudgetScope,
  scopeId: Text,
  /** Absent removes the limit; the count carries on. */
  limitCalls: Schema.optionalKey(Count),
});

export const KillSwitch = Schema.Struct({
  workspaceId: WorkspaceId,
  agentId: AgentId,
  state: Schema.Literals(["running", "paused", "terminated"]),
  by: SubjectId,
  at: Timestamp,
});
export type KillSwitch = typeof KillSwitch.Type;

/** `paused` and `terminated` refuse the agent's next tool call; `running` resumes it. */
export const KillSwitchSetInput = Schema.Struct({
  workspaceId: WorkspaceId,
  agentId: AgentId,
  state: KillSwitch.fields.state,
});

export const GovernanceState = Schema.Struct({
  budgets: Schema.Array(Budget),
  killSwitches: Schema.Array(KillSwitch),
});
