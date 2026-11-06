import * as Schema from "effect/Schema";

import {
  AgentId,
  AuditEntryId,
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

export const AuditEntry = Schema.Struct({
  id: AuditEntryId,
  workspaceId: WorkspaceId,
  grantId: GrantId,
  onBehalfOf: OnBehalfOf,
  tool: Text,
  argsRedacted: Schema.Json,
  outcome: Schema.Literals(["allowed", "denied"]),
  reason: Schema.optionalKey(Schema.String),
  at: Timestamp,
});
export type AuditEntry = typeof AuditEntry.Type;

export const BudgetScope = Schema.Literals(["company", "project", "agent", "person"]);

export const Budget = Schema.Struct({
  workspaceId: WorkspaceId,
  scope: BudgetScope,
  scopeId: Text,
  limitTokens: Schema.optionalKey(Count),
  limitUsd: Schema.optionalKey(Usd),
  usedTokens: Count,
  usedUsd: Usd,
  paused: Schema.Boolean,
});
export type Budget = typeof Budget.Type;

export const KillSwitch = Schema.Struct({
  workspaceId: WorkspaceId,
  agentId: AgentId,
  state: Schema.Literals(["running", "paused", "terminated"]),
  by: SubjectId,
  at: Timestamp,
});
export type KillSwitch = typeof KillSwitch.Type;
