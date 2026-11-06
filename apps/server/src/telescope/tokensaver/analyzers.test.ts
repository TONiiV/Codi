import { assert, describe, it } from "@effect/vitest";

import { brokenCachePrefix, oversizedToolOutputs, repeatedReads } from "./analyzers.ts";
import { makeSessionCollector } from "./claudeSessions.ts";
import { session, transcript } from "./fixtures.testkit.ts";

const read = (filePath: string, resultTokens: number, range?: string) => ({
  name: "Read",
  filePath,
  resultTokens,
  ...(range === undefined ? {} : { range }),
});

describe("token saver transcripts", () => {
  it("collects usage once per message, tool result sizes and typed prompts inside the window", () => {
    const collector = makeSessionCollector({
      sinceMs: Date.UTC(2026, 10, 2, 9, 1),
      untilMs: Date.UTC(2026, 10, 2, 9, 30),
    });
    const lines = [
      transcript.prompt("s1", 0, "before the window"),
      transcript.prompt("s1", 1, "fix the build"),
      transcript.toolUse("s1", 2, "m1", "t1", "Read", { file_path: "/repo/a.ts" }),
      transcript.toolUse("s1", 2, "m1", "t2", "Read", { file_path: "/repo/b.ts", offset: 10 }),
      transcript.toolResult("s1", 3, "t1", 400),
      transcript.toolResult("s1", 3, "t2", 8),
      transcript.prompt("s1", 4, "and the tests"),
      transcript.prompt("s1", 5, "Caveat: injected context", { isMeta: true }),
      transcript.prompt("s1", 5, "subagent brief", { isSidechain: true }),
      transcript.prompt("s1", 30, "at the window end"),
      transcript.prompt("s1", 6, "<task-notification><task-id>b1</task-id></task-notification>"),
      transcript.prompt("s1", 6, "<command-name>/clear</command-name>"),
      transcript.prompt("s1", 6, "<local-command-stdout></local-command-stdout>"),
      transcript.prompt("s1", 6, "[Request interrupted by user]"),
      transcript.prompt("s1", 6, "This session is being continued.", { isCompactSummary: true }),
      "not json",
    ];
    for (const line of lines) collector.add(line);
    const [activity] = collector.sessions();
    assert.strictEqual(activity?.cachedInputTokens, 1000);
    assert.strictEqual(activity?.cacheCreationTokens, 100);
    assert.strictEqual(activity?.turns, 1);
    assert.strictEqual(activity?.userPrompts, 2);
    assert.strictEqual(activity?.cwd, "/repo");
    assert.deepStrictEqual(activity?.toolCalls, [
      { name: "Read", filePath: "/repo/a.ts", resultTokens: 100 },
      { name: "Read", filePath: "/repo/b.ts", range: "10:", resultTokens: 2 },
    ]);
  });
});

describe("token saver analyzers", () => {
  it("flags cache-write outliers and credits the prefix file changed during them", () => {
    const normal = ["a", "b", "c"].map((id) => session(id));
    const busted = session("d", {
      startMs: 10_000,
      endMs: 20_000,
      cachedInputTokens: 600_000,
      cacheCreationTokens: 400_000,
    });
    const quiet = session("e", { cacheCreationTokens: 30_000, cachedInputTokens: 10_000 });
    // Ratio 0.15: above 2 x median (0.1) but under the 0.2 floor; 100K total is measured.
    const mild = session("f", { cacheCreationTokens: 15_000, cachedInputTokens: 85_000 });
    const finding = brokenCachePrefix(
      [...normal, busted, quiet, mild],
      [
        { cwd: "/repo", file: "CLAUDE.md", mtimeMs: 15_000 },
        { cwd: "/elsewhere", file: "AGENTS.md", mtimeMs: 15_000 },
        { cwd: "/repo", file: ".mcp.json", mtimeMs: 9_999 },
        { cwd: "/repo", file: "AGENTS.md", mtimeMs: 20_001 },
      ],
    );
    assert.strictEqual(finding?.pattern, "broken_cache_prefix");
    assert.strictEqual(finding?.confidence, "medium");
    assert.strictEqual(finding?.evidence.sessions, 5);
    assert.strictEqual(finding?.evidence.outlierSessions, 1);
    assert.strictEqual(finding?.evidence.changedFiles, "CLAUDE.md");
    // 400K written against a typical 5% of 1M.
    assert.strictEqual(finding?.estimatedSavingTokens, 350_000);
    assert.strictEqual(brokenCachePrefix(normal, []), undefined);
    const short = session("g", {
      turns: 9,
      cacheCreationTokens: 27_000,
      cachedInputTokens: 50_000,
    });
    assert.strictEqual(brokenCachePrefix([...normal, short], []), undefined);
  });

  it("uses twice the median as the outlier bar and ignores prefix files of other projects", () => {
    const ratio = (id: string, writesPerMille: number) =>
      session(id, {
        cacheCreationTokens: writesPerMille * 1000,
        cachedInputTokens: (1000 - writesPerMille) * 1000,
      });
    const week = [ratio("a", 150), ratio("b", 150), ratio("c", 150), ratio("d", 250)];
    const finding = brokenCachePrefix(
      [...week, ratio("e", 350)],
      [{ cwd: "/elsewhere", file: "CLAUDE.md", mtimeMs: 1_500 }],
    );
    assert.strictEqual(finding?.evidence.outlierSessions, 1);
    assert.strictEqual(finding?.evidence.sessionsWithConfigChange, 0);
    assert.strictEqual(finding?.confidence, "low");
    assert.strictEqual(finding?.estimatedSavingTokens, 200_000);
  });

  it("counts rereads of an unchanged file range and resets after an edit", () => {
    const shot = read("/repo/shot.png", 0);
    const finding = repeatedReads([
      session("s1", {
        toolCalls: [
          shot,
          shot,
          read("/repo/src/a.ts", 1000),
          read("/repo/src/a.ts", 1000),
          read("/repo/src/a.ts", 900, "100:50"),
          { name: "Edit", filePath: "/repo/src/a.ts", resultTokens: 10 },
          read("/repo/src/a.ts", 1100),
          read("/repo/src/a.ts", 1200),
          read("/repo/src/b.ts", 500),
        ],
      }),
    ]);
    assert.strictEqual(finding?.estimatedSavingTokens, 2200);
    assert.strictEqual(finding?.evidence.repeatedReads, 2);
    assert.strictEqual(finding?.evidence.topFile, "src/a.ts");
    assert.strictEqual(finding?.confidence, "medium");
    assert.include(finding?.suggestion, "+- `src/a.ts`");
    assert.strictEqual(repeatedReads([session("s2", { toolCalls: [read("/x", 1)] })]), undefined);
    assert.strictEqual(
      repeatedReads([session("s3", { toolCalls: [shot, shot, shot] })]),
      undefined,
    );
    // Below the saving floor.
    const small = read("/repo/small.ts", 900);
    assert.strictEqual(repeatedReads([session("s4", { toolCalls: [small, small] })]), undefined);
  });

  it("counts only the part of each tool result above the threshold", () => {
    const finding = oversizedToolOutputs([
      session("s1", {
        toolCalls: [
          { name: "Bash", resultTokens: 50_000 },
          { name: "Bash", resultTokens: 25_000 },
          { name: "mcp__db__query", resultTokens: 21_000 },
          { name: "Read", resultTokens: 20_000 },
        ],
      }),
    ]);
    assert.strictEqual(finding?.estimatedSavingTokens, 36_000);
    assert.strictEqual(finding?.evidence.oversizedResults, 3);
    assert.strictEqual(finding?.evidence.topTool, "Bash");
    assert.include(finding?.suggestion, "tail -n 200");
    assert.include(finding?.suggestion, "Ask mcp__db__query for a page");
  });
});
