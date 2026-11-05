import { expect, it } from "vite-plus/test";

import { nextBudget } from "./refresh-agent-context-budget.ts";

const committed: Record<string, number> = { claudeBytes: 5133, codexBytes: 6863, toolBytes: 47498 };
const diff = (claude: number, codex: number) =>
  [
    "- Expected",
    "+ Received",
    "",
    "  {",
    `-   "claudeBytes": 5133,`,
    `-   "codexBytes": 6863,`,
    `+   "claudeBytes": ${claude},`,
    `+   "codexBytes": ${codex},`,
    `    "toolBytes": 47498,`,
    "  }",
  ].join("\n");

it.each([
  ["a rename shrinks the text", diff(5124, 6848), 2, []],
  ["upstream added text", diff(5140, 6848), 2, ["claudeBytes"]],
  ["the output has no diff", "TypeError: boom", 0, []],
])("takes measured values when %s", (_name, output, changedKeys, grew) => {
  const result = nextBudget(committed, output);
  expect(
    Object.keys(committed).filter((key) => result.measured[key] !== committed[key]),
  ).toHaveLength(changedKeys);
  expect(result.grew).toEqual(grew);
  expect(result.changed).toBe(changedKeys > 0);
});
