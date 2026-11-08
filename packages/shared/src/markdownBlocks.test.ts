import { describe, expect, it } from "vite-plus/test";

import { diffBlocks, joinBlocks, type Op, splitBlocks } from "./markdownBlocks.ts";

const md = (text: string) => ({ type: "md" as const, text });

describe("splitBlocks", () => {
  it("makes each top-level list item its own block and keeps the rest whole", () => {
    const body = [
      "# Goal",
      "Ship it.",
      "",
      "- [ ] one",
      "- [x] two",
      "  - nested stays with two",
      "",
      "1. first",
      "2. second",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "> quoted",
      ">",
      "> still quoted",
      "",
      "```js",
      "const a = 1;",
      "",
      "",
      "const b = 2;",
      "```",
    ].join("\n");
    expect(splitBlocks(body)).toEqual([
      md("# Goal"),
      md("Ship it."),
      md("- [ ] one"),
      md("- [x] two\n  - nested stays with two"),
      md("1. first"),
      md("2. second"),
      md("| a | b |\n|---|---|\n| 1 | 2 |"),
      md("> quoted\n>\n> still quoted"),
      md("```js\nconst a = 1;\n\n\nconst b = 2;\n```"),
    ]);
    // The indent before a marker stays, so the nested item does not turn into indented code.
    expect(splitBlocks("   - a\n       - nested")).toEqual([md("   - a\n       - nested")]);
  });

  it("makes a telescope-chart fence a chart block", () => {
    const chart = '```telescope-chart\n{"title":"本周完成","kind":"kpi"}\n```';
    expect(splitBlocks(`Intro\n\n${chart}`)).toEqual([md("Intro"), { type: "chart", text: chart }]);
  });

  it("reads CRLF and lone CR line endings as LF", () => {
    expect(splitBlocks("a\r\nb\r\n\r\n- c\r\n- d\r\n")).toEqual([md("a\nb"), md("- c"), md("- d")]);
    expect(splitBlocks("a\rb\r\r- c\r- d\r")).toEqual([md("a\nb"), md("- c"), md("- d")]);
  });

  it("splits an empty body into no blocks", () => {
    expect(splitBlocks("")).toEqual([]);
    expect(splitBlocks("\n  \n")).toEqual([]);
    expect(joinBlocks([])).toBe("");
  });
});

describe("joinBlocks", () => {
  it("joins items of one list with a newline and everything else with a blank line", () => {
    const blocks = [
      md("# Goal"),
      md("- [ ] one"),
      md("- [x] two\n  - nested"),
      md("1. first"),
      md("2) other list"),
      md("* * *"),
      md("Para"),
    ];
    const joined =
      "# Goal\n\n- [ ] one\n- [x] two\n  - nested\n\n1. first\n\n2) other list\n\n* * *\n\nPara";
    expect(joinBlocks(blocks)).toBe(joined);
    expect(splitBlocks(joined)).toEqual(blocks);
  });
});

const withIds = (markdown: string) =>
  splitBlocks(markdown).map((block, index) => ({ id: `b${index}`, ...block }));
const diff = (base: ReadonlyArray<{ id: string; text: string }>, next: string) =>
  diffBlocks(base, splitBlocks(next));

describe("diffBlocks", () => {
  it("turns a checklist toggle into one update, even among identical items", () => {
    const base = withIds("# Plan\n\n- [ ] same\n- [ ] same\n- [ ] other");
    expect(diff(base, "# Plan\n\n- [ ] same\n- [x] same\n- [ ] other")).toEqual([
      { op: "update", id: "b2", type: "md", text: "- [x] same" },
    ]);
    expect(diff(base, "# Plan\n\n- [x] same\n- [ ] same\n- [ ] other")).toEqual([
      { op: "update", id: "b1", type: "md", text: "- [x] same" },
    ]);
  });

  it("leaves alone a block the writer did not touch, so another writer's later edit to it stays", () => {
    const base = withIds("# Plan\n\nGoal: ship.\n\n- [ ] review");
    // Another writer rewrites the goal after this base; this writer only toggles the item.
    expect(diff(base, "# Plan\n\nGoal: ship.\n\n- [x] review")).toEqual([
      { op: "update", id: "b2", type: "md", text: "- [x] review" },
    ]);
  });

  it("pairs changed blocks between anchors in order and inserts or removes the extras", () => {
    const base = withIds("A\n\nB\n\nC\n\nD");
    expect(diff(base, "A\n\nB2\n\nC2\n\nC3\n\nC4\n\nD")).toEqual([
      { op: "update", id: "b1", type: "md", text: "B2" },
      { op: "update", id: "b2", type: "md", text: "C2" },
      { op: "insert", afterId: "b2", blocks: [md("C3"), md("C4")] },
    ]);
    expect(diff(base, "A\n\nX\n\nD")).toEqual([
      { op: "update", id: "b1", type: "md", text: "X" },
      { op: "remove", id: "b2" },
    ]);
    expect(diff(base, "New\n\nA\n\nB\n\nC\n\nD")).toEqual([
      { op: "insert", afterId: null, blocks: [md("New")] },
    ]);
    expect(diff(withIds("```js\n{}\n```"), "```telescope-chart\n{}\n```")).toEqual([
      { op: "update", id: "b0", type: "chart", text: "```telescope-chart\n{}\n```" },
    ]);
  });

  it("anchors the unchanged head and tail before pairing what is left", () => {
    expect(diff(withIds("Draft\n\nDone"), "Done\n\nNew\n\nDone")).toEqual([
      { op: "update", id: "b0", type: "md", text: "Done" },
      { op: "insert", afterId: "b0", blocks: [md("New")] },
    ]);
    expect(diff(withIds("A\n\nB"), "A\n\nNew\n\nB")).toEqual([
      { op: "insert", afterId: "b0", blocks: [md("New")] },
    ]);
    expect(diff(withIds("- [ ] x\n- [ ] x"), "- [ ] x\n- [ ] x\n- [ ] x")).toEqual([
      { op: "insert", afterId: "b1", blocks: [md("- [ ] x")] },
    ]);
  });

  it("moves a block by removing it and inserting it again", () => {
    expect(diff(withIds("A\n\nB\n\nC"), "B\n\nC\n\nA")).toEqual([
      { op: "remove", id: "b0" },
      { op: "insert", afterId: "b2", blocks: [md("A")] },
    ]);
  });

  it("round-trips and rebuilds any body from any other", () => {
    const bodies = [
      "",
      '# Plan\n\nGoal: ship.\n\n- [ ] a\n- [x] b\n  - sub\n\n```telescope-chart\n{"kind":"kpi"}\n```',
      "# Plan\n\nGoal: ship faster.\n\n- [ ] a\n- [ ] c\n\n| x |\n|---|\n| 1 |\n\n> note",
      "1. one\n2. two\n\n- a\n\n  loose\n- b\n\n* * *\n\n```\nfence\n\n\nwith gaps\n```",
      "Para one\r\n\r\n- [ ] x\r\n- [ ] x\r\n- [ ] x\r\n",
      "  indented para\n\n    code block\n\n<!-- html -->\n\n[ref]: https://example.com\n\n- a\n\n1) b",
      "\uFEFF# Title\n\nPara one\n\n- [ ] a\n- [ ] b",
      "\uFEFF\uFEFF# Title\n\nPara one\n\n- [ ] a\n- [ ] b",
      "\uFEFF\uFEFF\uFEFF# Title\n\nPara one\n\n- [ ] a\n- [ ] b",
      "- a\n\n-not a list",
      "* item\n\n*Note:* text",
    ];
    for (const body of bodies) {
      const base = withIds(body);
      expect(splitBlocks(joinBlocks(base))).toEqual(splitBlocks(body));
      expect(diff(base, body)).toEqual([]);
      for (const next of bodies) {
        expect(applyOps(base, diff(base, next))).toEqual(splitBlocks(next));
      }
    }
    const body = "# Title\n\nPara one\n\n- [ ] a\n- [ ] b";
    expect(diff(withIds(body), `\uFEFF${body}`)).toEqual([]);
    expect(diff(withIds(body), `\uFEFF\uFEFF${body}`)).toEqual([]);
    expect(diff(withIds(body), `\uFEFF\uFEFF\uFEFF${body}`)).toEqual([]);
  });
});

/** Applies ops the plain way: each insert puts its blocks right after `afterId`, no cursor. */
function applyOps(
  base: ReadonlyArray<{ id: string; type: string; text: string }>,
  ops: ReadonlyArray<Op<string>>,
) {
  const rows: Array<{ id?: string; type: string; text: string }> = base.map((block) => ({
    ...block,
  }));
  const at = (id: string | null) => rows.findIndex((row) => row.id === id);
  for (const op of ops) {
    if (op.op === "remove") rows.splice(at(op.id), 1);
    else if (op.op === "update") rows.splice(at(op.id), 1, op);
    else rows.splice(at(op.afterId) + 1, 0, ...op.blocks);
  }
  return rows.map(({ type, text }) => ({ type, text }));
}
