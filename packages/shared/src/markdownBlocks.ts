import type { Node } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);

export type BlockType = "md" | "chart";
export type Block = { type: BlockType; text: string };

/**
 * One block per top-level node, except that each top-level list item is its own block. Tables,
 * fences, quotes and nested lists stay whole. Line endings become "\n" and a leading BOM goes, since
 * the parser skips it without counting it in its offsets.
 */
export function splitBlocks(markdown: string): Block[] {
  const source = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const cut = (node: Node) => {
    const start = node.position?.start.offset ?? 0;
    return source.slice(source.lastIndexOf("\n", start - 1) + 1, node.position?.end.offset);
  };
  return parser.parse(source).children.flatMap((node): Block[] => {
    if (node.type === "list") return node.children.map((item) => ({ type: "md", text: cut(item) }));
    const chart = node.type === "code" && node.lang === "telescope-chart";
    return [{ type: chart ? "chart" : "md", text: cut(node) }];
  });
}

// Adjacent lists with the same bullet, or the same number delimiter, would have parsed as one list.
const listMarker = (text: string) =>
  /^ {0,3}(?:([-+*])|\d{1,9}([.)]))(?=\s|$)/.exec(text)?.slice(1).join("");

export function joinBlocks(blocks: ReadonlyArray<Block>): string {
  return blocks
    .map(({ text }, index) => {
      const previous = blocks[index - 1];
      if (!previous) return text;
      const marker = listMarker(text);
      return (marker && marker === listMarker(previous.text) ? "\n" : "\n\n") + text;
    })
    .join("");
}

/** An insert's blocks go, in order, right after `afterId`; a null `afterId` is the start of the body. */
export type Op<Id> =
  | { op: "update"; id: Id; type: BlockType; text: string }
  | { op: "remove"; id: Id }
  | { op: "insert"; afterId: Id | null; blocks: Block[] };

/**
 * Block operations that turn `base` into `next` (from `splitBlocks`). The unchanged head and tail
 * anchor first, then blocks with the same text; unmatched blocks between two anchors pair up in
 * order as updates, and the extras become one insert or removes. No two inserts share an `afterId`.
 */
export function diffBlocks<Id extends string>(
  base: ReadonlyArray<{ id: Id; text: string }>,
  next: ReadonlyArray<Block>,
): Array<Op<Id>> {
  const shorter = Math.min(base.length, next.length);
  let head = 0;
  while (head < shorter && base[head]?.text === next[head]?.text) head++;
  let tail = 0;
  while (head + tail < shorter && base.at(-1 - tail)?.text === next.at(-1 - tail)?.text) tail++;
  const rows = base.slice(head, base.length - tail);
  const blocks = next.slice(head, next.length - tail);

  const width = blocks.length + 1;
  // ponytail: O(n*m) LCS, n and m <= 400 blocks; add move detection when history shows lost block ids
  const common = new Uint32Array((rows.length + 1) * width);
  const lcs = (i: number, j: number) => common[i * width + j] ?? 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    for (let j = blocks.length - 1; j >= 0; j--) {
      common[i * width + j] =
        rows[i]?.text === blocks[j]?.text
          ? lcs(i + 1, j + 1) + 1
          : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }

  const ops: Array<Op<Id>> = [];
  let afterId: Id | null = base[head - 1]?.id ?? null;
  let removed: Id[] = [];
  let added: Block[] = [];
  const closeGap = () => {
    added.forEach(({ type, text }, index) => {
      const id = removed[index];
      if (id === undefined) return;
      ops.push({ op: "update", id, type, text });
      afterId = id;
    });
    const extra = added.slice(removed.length);
    if (extra.length > 0) ops.push({ op: "insert", afterId, blocks: extra });
    for (const id of removed.slice(added.length)) ops.push({ op: "remove", id });
    removed = [];
    added = [];
  };
  for (let i = 0, j = 0; i < rows.length || j < blocks.length;) {
    const from = rows[i];
    const to = blocks[j];
    if (from && to?.text === from.text) {
      closeGap();
      afterId = from.id;
      i++;
      j++;
    } else if (from && (!to || lcs(i + 1, j) >= lcs(i, j + 1))) {
      removed.push(from.id);
      i++;
    } else if (to) {
      added.push(to);
      j++;
    }
  }
  closeGap();
  return ops;
}
