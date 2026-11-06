import type { Telescope } from "@t3tools/contracts";

import type { SessionActivity } from "./claudeSessions.ts";

type Finding = Telescope.TokenSaverFinding;

/** Last write of a prompt-prefix file (CLAUDE.md, AGENTS.md, .mcp.json) in a session's cwd. */
export interface ConfigChange {
  readonly cwd: string;
  readonly file: string;
  readonly mtimeMs: number;
}

// Claude Code caps Bash output near 30K chars (about 7.5K tokens) and Read/MCP results at 25K.
const OVERSIZED_BASH_TOKENS = 4_000;
const OVERSIZED_RESULT_TOKENS = 8_000;
// Below this a session's cache traffic is mostly the first prompt write, which is not waste.
const MIN_CACHE_TOKENS = 50_000;
// A short session's cold prefix write (about 25K for Claude Code) dominates its ratio.
const MIN_CACHE_TURNS = 10;
// A finding that saves less than this is noise, and an empty week writes no proposal.
const MIN_SAVING_TOKENS = 1_000;
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

const median = (values: ReadonlyArray<number>) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const reportable = (finding: Finding) =>
  finding.estimatedSavingTokens >= MIN_SAVING_TOKENS ? finding : undefined;
const relative = (cwd: string, filePath: string) =>
  cwd !== "" && filePath.startsWith(`${cwd}/`) ? filePath.slice(cwd.length + 1) : filePath;
const claudeMdDiff = (lines: ReadonlyArray<string>) =>
  [
    "```diff",
    "--- a/CLAUDE.md",
    "+++ b/CLAUDE.md",
    "@@",
    ...lines.map((line) => `+${line}`),
    "```",
  ].join("\n");

/**
 * Sessions whose cache writes / (writes + reads) ratio is far above the week's median rewrote
 * their prompt prefix. A prefix file written during such a session explains it.
 */
export const brokenCachePrefix = (
  sessions: ReadonlyArray<SessionActivity>,
  changes: ReadonlyArray<ConfigChange>,
): Finding | undefined => {
  const measured = sessions.flatMap((session) => {
    const total = session.cacheCreationTokens + session.cachedInputTokens;
    return total < MIN_CACHE_TOKENS || session.turns < MIN_CACHE_TURNS
      ? []
      : [{ session, total, ratio: session.cacheCreationTokens / total }];
  });
  if (measured.length < 3) return undefined;
  const typical = median(measured.map(({ ratio }) => ratio));
  const outliers = measured
    .filter(({ ratio }) => ratio > Math.max(2 * typical, 0.2))
    .map((entry) => ({
      ...entry,
      excess: Math.round(entry.session.cacheCreationTokens - typical * entry.total),
      changed: changes.filter(
        (change) =>
          change.cwd === entry.session.cwd &&
          change.mtimeMs >= entry.session.startMs &&
          change.mtimeMs <= entry.session.endMs,
      ),
    }));
  if (outliers.length === 0) return undefined;
  const correlated = outliers.filter(({ changed }) => changed.length > 0);
  const counted = correlated.length > 0 ? correlated : outliers;
  const files = [...new Set(correlated.flatMap(({ changed }) => changed.map(({ file }) => file)))];
  const fileList = files.join("、");
  const excess = counted.reduce((sum, entry) => sum + entry.excess, 0);
  const advice =
    files.length > 0
      ? `${fileList} 在智能体工作期间被改过，之后每一轮都重写了缓存的提示前缀。一周内保持 ${fileList} 不动`
      : `${outliers.length} 个会话的缓存写入比例远高于本周中位数，常见原因是 CLAUDE.md、AGENTS.md 或 .mcp.json 在会话中途被改。一周内保持这些文件不动`;
  return reportable({
    pattern: "broken_cache_prefix",
    evidence: {
      sessions: measured.length,
      outlierSessions: outliers.length,
      sessionsWithConfigChange: correlated.length,
      medianCacheWriteRatio: Number(typical.toFixed(3)),
      excessCacheWriteTokens: excess,
      ...(files.length > 0 ? { changedFiles: files.join(", ") } : {}),
    },
    suggestion: `${advice}：常改的笔记移到按需读取的文件里，MCP 工具列表只在周与周之间调整。`,
    estimatedSavingTokens: excess,
    confidence: correlated.length >= 2 ? "high" : correlated.length === 1 ? "medium" : "low",
  });
};

/** A Read of a file range already read in the same session, with no edit to the file between. */
export const repeatedReads = (sessions: ReadonlyArray<SessionActivity>): Finding | undefined => {
  const repeats = new Map<string, { path: string; count: number; tokens: number }>();
  for (const session of sessions) {
    const seen = new Set<string>();
    for (const call of session.toolCalls) {
      if (call.filePath === undefined) continue;
      if (EDIT_TOOLS.has(call.name)) {
        for (const key of seen) if (key.startsWith(`${call.filePath}#`)) seen.delete(key);
        continue;
      }
      if (call.name !== "Read") continue;
      const key = `${call.filePath}#${call.range ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        continue;
      }
      // Image results carry no text tokens; rereading a regenerated screenshot is not waste.
      if (call.resultTokens === 0) continue;
      const group = `${session.sessionId}\0${call.filePath}`;
      const path = relative(session.cwd, call.filePath);
      const entry = repeats.get(group) ?? { path, count: 0, tokens: 0 };
      repeats.set(group, {
        path,
        count: entry.count + 1,
        tokens: entry.tokens + call.resultTokens,
      });
    }
  }
  if (repeats.size === 0) return undefined;
  const ranked = [...repeats.values()].toSorted((a, b) => b.tokens - a.tokens || b.count - a.count);
  const top = ranked[0]!;
  const saving = ranked.reduce((sum, { tokens }) => sum + tokens, 0);
  const topPaths = [...new Set(ranked.map(({ path }) => path))].slice(0, 3);
  return reportable({
    pattern: "repeated_reads",
    evidence: {
      repeatedReads: ranked.reduce((sum, { count }) => sum + count, 0),
      repeatedReadTokens: saving,
      sessionFilePairs: ranked.length,
      topFile: top.path,
      topFileRepeatsInOneSession: top.count,
    },
    suggestion:
      "同一个会话里反复读没有改过的文件。把它们列进 CLAUDE.md，并给每个文件补一行要点：\n" +
      claudeMdDiff([
        "## Files agents re-read",
        ...topPaths.map((path) => `- \`${path}\``),
        "Read a file once per task; reread only after it changes.",
      ]),
    estimatedSavingTokens: saving,
    confidence: top.count >= 5 ? "high" : "medium",
  });
};

const OUTPUT_ADVICE: Readonly<Record<string, string>> = {
  Bash: "Pipe long command output through `| head -n 100` or `grep`; run tests with a reporter that prints only failures.",
  Read: "Read large files with `offset` and `limit` instead of whole.",
};

const oversizedThreshold = (tool: string) =>
  tool === "Bash" ? OVERSIZED_BASH_TOKENS : OVERSIZED_RESULT_TOKENS;

/** Single tool results above the threshold; the saving counts only the part above it. */
export const oversizedToolOutputs = (
  sessions: ReadonlyArray<SessionActivity>,
): Finding | undefined => {
  const byTool = new Map<string, { count: number; tokens: number; excess: number }>();
  for (const call of sessions.flatMap(({ toolCalls }) => toolCalls)) {
    const thresholdTokens = oversizedThreshold(call.name);
    if (call.resultTokens <= thresholdTokens) continue;
    const entry = byTool.get(call.name) ?? { count: 0, tokens: 0, excess: 0 };
    byTool.set(call.name, {
      count: entry.count + 1,
      tokens: entry.tokens + call.resultTokens,
      excess: entry.excess + call.resultTokens - thresholdTokens,
    });
  }
  if (byTool.size === 0) return undefined;
  const ranked = [...byTool.entries()].toSorted(([, a], [, b]) => b.excess - a.excess);
  const [topTool, top] = ranked[0]!;
  const sum = (key: "count" | "tokens" | "excess") =>
    ranked.reduce((total, [, entry]) => total + entry[key], 0);
  return reportable({
    pattern: "oversized_tool_outputs",
    evidence: {
      oversizedResults: sum("count"),
      oversizedResultTokens: sum("tokens"),
      topToolThresholdTokens: oversizedThreshold(topTool),
      topTool,
      topToolResults: top.count,
    },
    suggestion:
      `单次工具结果过大（Bash 超过 ${OVERSIZED_BASH_TOKENS} token，其他工具超过 ${OVERSIZED_RESULT_TOKENS} token），主要来自 ${topTool}。让工具少输出：\n` +
      claudeMdDiff([
        "## Tool output",
        ...ranked
          .slice(0, 3)
          .map(
            ([tool]) =>
              `- ${OUTPUT_ADVICE[tool] ?? `Ask ${tool} for a page of results, not all of them.`}`,
          ),
      ]),
    estimatedSavingTokens: sum("excess"),
    confidence: "high",
  });
};
