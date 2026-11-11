import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as HostProcess from "@t3tools/shared/HostProcess";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import {
  tokenCount,
  totalTokens,
  type ProviderUsageReader,
  type TranscriptUsageFormat,
  type UsageRecord,
} from "@t3tools/provider-core/server/usage";
import type { DeepSeekSettings } from "../settings.ts";

const DeepSeekScanState = Schema.Struct({
  sessionId: Schema.mutableKey(Schema.String),
  model: Schema.mutableKey(Schema.String),
});
type DeepSeekScanState = typeof DeepSeekScanState.Type;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseRecord(value: unknown, state: DeepSeekScanState): readonly UsageRecord[] {
  const row = asRecord(value);
  if (!row) return [];
  if (row.type === "session") {
    if (typeof row.id === "string") state.sessionId = row.id;
    return [];
  }
  const data = asRecord(row.data);
  if (!data) return [];
  if (row.type === "request/header") {
    const config = asRecord(asRecord(data.header)?.config);
    if (typeof config?.model === "string") state.model = config.model;
    return [];
  }
  if (row.type !== "assistant/message") return [];
  const usage = asRecord(data.usage);
  const message = asRecord(data.message);
  if (!usage || !message || typeof row.time !== "number" || !Number.isFinite(row.time)) {
    return [];
  }
  const outputTokens = tokenCount(usage.outputTokens);
  const totals = {
    uncachedInputTokens: tokenCount(usage.inputTokens),
    cachedInputTokens: tokenCount(usage.cacheReadTokens),
    cacheCreationTokens: tokenCount(usage.cacheWriteTokens),
    outputTokens,
    reasoningTokens: Math.min(outputTokens, tokenCount(usage.reasoningTokens)),
  };
  if (totalTokens(totals) === 0) return [];
  const model = state.model || "DeepSeek unknown";
  const messageId = typeof message.id === "string" ? message.id : null;
  return [
    {
      provider: "deepseek",
      timestampMs: row.time,
      model,
      sessionId: state.sessionId,
      totals,
      reportedCostUsd: null,
      speed: "standard",
      dedupeKey: messageId === null ? null : `${state.sessionId}:${messageId}`,
    },
  ];
}

export const deepSeekUsageFormat: TranscriptUsageFormat<DeepSeekScanState> = {
  selectFields: {
    type: true,
    id: true,
    time: true,
    data: {
      header: { config: { model: true } },
      message: { id: true },
      usage: true,
    },
  },
  usageMarkers: ['"type":"assistant/message"', '"type":"request/header"', '"type":"session"'],
  parseLine: (line, state) => {
    try {
      return parseRecord(JSON.parse(line), state);
    } catch {
      return [];
    }
  },
  parseProjected: parseRecord,
  state: { initial: () => ({ sessionId: "", model: "" }), schema: DeepSeekScanState },
  sharedSessionsAcrossFiles: true,
};

export const deepSeekUsageReader: ProviderUsageReader<DeepSeekSettings, Path.Path> = {
  kind: "transcripts",
  provider: "deepseek",
  format: deepSeekUsageFormat,
  directories: Effect.fn("deepSeekUsageReader.directories")(function* ({ environment }) {
    const path = yield* Path.Path;
    const homeDirectory = yield* HostProcess.HomeDirectory;
    const platform = yield* HostProcess.Platform;
    const launchHome =
      (platform === "win32" ? environment.USERPROFILE : environment.HOME)?.trim() || homeDirectory;
    const home = expandHomePath(
      environment.DSH_HOME?.trim() || path.join(launchHome, ".dsh"),
      launchHome,
    );
    return [{ dir: path.resolve(home, "sessions") }];
  }),
};
