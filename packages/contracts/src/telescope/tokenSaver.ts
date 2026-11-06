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
  confidence: Schema.Literals(["high", "medium", "low"]),
});
export type TokenSaverFinding = typeof TokenSaverFinding.Type;
