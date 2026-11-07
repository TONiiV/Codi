import { assert, describe, it } from "@effect/vitest";

import * as ContextBudget from "./ContextBudget.ts";

const item = (id: string, tokens: number): ContextBudget.ContextItem => ({
  kind: "memory",
  id,
  text: "x".repeat(tokens * 4),
});
const many = (prefix: string, count: number, tokens: number) =>
  Array.from({ length: count }, (_, index) => item(`${prefix}${index}`, tokens));
const none = { pinned: [], board: [], recall: [], thread: [] };

describe("ContextBudget.budgets", () => {
  it.each([
    ["shares of a 200K window", 200_000, false, [2_000, 4_000, 6_000, 10_000]],
    ["rounds each share down", 199_999, false, [1_999, 3_999, 5_999, 9_999]],
    ["ceilings on a 1M window", 1_000_000, false, [4_000, 8_000, 12_000, 20_000]],
    ["floors on a 16K window", 16_000, false, [256, 512, 512, 1_024]],
    ["floors scaled under a fifth of an 8K window", 8_000, false, [177, 355, 355, 711]],
    ["floors once compacting", 200_000, true, [256, 512, 512, 1_024]],
  ] as const)("%s", (_, windowTokens, compact, expected) => {
    const budget = ContextBudget.budgets(windowTokens, compact);
    assert.deepStrictEqual(
      ContextBudget.BLOCK_NAMES.map((name) => budget[name]),
      [...expected],
    );
  });
});

describe("ContextBudget.allocate", () => {
  it("keeps items in priority order, cuts the first that overflows and drops the rest", () => {
    const { blocks, tokens } = ContextBudget.allocate({
      windowTokens: 100_000,
      usedTokens: 0,
      blocks: { ...none, pinned: [item("a", 600), item("b", 600), item("c", 10)] },
    });
    assert.deepStrictEqual(
      blocks.pinned.map((kept) => kept.id),
      ["a", "b"],
    );
    assert.strictEqual(ContextBudget.estimateTokens(blocks.pinned[1]?.text ?? ""), 400);
    assert.isTrue(blocks.pinned[1]?.text.endsWith("…"));
    assert.strictEqual(tokens, 1_000);
  });

  it("drops an overflowing item instead of cutting it to a scrap", () => {
    const { blocks } = ContextBudget.allocate({
      windowTokens: 100_000,
      usedTokens: 0,
      blocks: { ...none, pinned: [item("a", 980), item("b", 600)] },
    });
    assert.deepStrictEqual(
      blocks.pinned.map((kept) => kept.id),
      ["a"],
    );
  });

  it.each([
    ["below 70% keeps the shares", 58_999, false, 11_000],
    ["at 70% shrinks every block to its floor", 59_000, true, 2_256],
  ] as const)("%s", (_, usedTokens, compacted, tokens) => {
    const result = ContextBudget.allocate({
      windowTokens: 100_000,
      usedTokens,
      blocks: {
        pinned: many("p", 40, 100),
        board: many("b", 40, 100),
        recall: many("r", 40, 100),
        thread: many("t", 80, 100),
      },
    });
    assert.strictEqual(result.compacted, compacted);
    assert.strictEqual(result.tokens, tokens);
  });
});
