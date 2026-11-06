import * as Schema from "effect/Schema";

import { Count } from "./common.ts";

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
