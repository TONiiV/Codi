import * as Schema from "effect/Schema";

import { Count, DecisionId, Timestamp, WorkspaceId } from "./common.ts";

export const TokenSaverPattern = Schema.Literals([
  "broken_cache_prefix",
  "repeated_reads",
  "oversized_tool_outputs",
]);
export type TokenSaverPattern = typeof TokenSaverPattern.Type;

/** One waste pattern: the numbers behind it and the change that would remove it. */
export const TokenSaverFinding = Schema.Struct({
  pattern: TokenSaverPattern,
  evidence: Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.String])),
  suggestion: Schema.String,
  estimatedSavingTokens: Count,
  /**
   * "tokens": these tokens are no longer sent. "cost": they are still sent, but read from the
   * cache instead of rewritten to it, so only the price drops (cache write 1.25x, read 0.1x input).
   */
  savingKind: Schema.Literals(["tokens", "cost"]),
  confidence: Schema.Literals(["high", "medium", "low"]),
});
export type TokenSaverFinding = typeof TokenSaverFinding.Type;

/** `null` means the metric is not measured yet. */
export const TokenSaverQuality = Schema.Struct({
  testPassRate: Schema.NullOr(Schema.Number),
  followUpPrompts: Schema.NullOr(Count),
  rollbacks: Schema.NullOr(Count),
});

export const TokenSaverReport = Schema.Struct({
  workspaceId: WorkspaceId,
  since: Timestamp,
  until: Timestamp,
  sessionsAnalyzed: Count,
  findings: Schema.Array(TokenSaverFinding),
  quality: TokenSaverQuality,
  markdown: Schema.String,
  decisionId: Schema.optionalKey(DecisionId),
});
export type TokenSaverReport = typeof TokenSaverReport.Type;

/** The window defaults to the seven days before the run. */
export const TokenSaverRunInput = Schema.Struct({
  workspaceId: WorkspaceId,
  since: Schema.optionalKey(Timestamp),
  until: Schema.optionalKey(Timestamp),
});
