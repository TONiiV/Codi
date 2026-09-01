import { useMemo } from "react";
import type { DecisionNode, DecisionState } from "../../mock/types";
import { toggleNode, useApp } from "../../store/app";
import { shallowEqual } from "../../store/store";
import { cx } from "../../ui/primitives";

const COL_W = 268;
const CARD_W = 228;
const ROW_H = 124;

type Placed = {
  node: DecisionNode;
  depth: number;
  x: number;
  y: number;
  hasChildren: boolean;
  collapsed: boolean;
};

type Link = { from: Placed; to: Placed };

/**
 * Tidy horizontal tree: depth drives the column, leaves claim rows in order,
 * and a parent centres on the span of its visible children.
 */
function layout(root: DecisionNode, collapsed: Record<string, boolean>) {
  const placed: Placed[] = [];
  const links: Link[] = [];
  let row = 0;

  const walk = (node: DecisionNode, depth: number): Placed => {
    const hasChildren = Boolean(node.children?.length);
    const isCollapsed = hasChildren && Boolean(collapsed[node.id]);
    const x = depth * COL_W;

    if (!hasChildren || isCollapsed) {
      const entry: Placed = {
        node,
        depth,
        x,
        y: row * ROW_H + ROW_H / 2,
        hasChildren,
        collapsed: isCollapsed,
      };
      row += 1;
      placed.push(entry);
      return entry;
    }

    const children = node.children!.map((child) => walk(child, depth + 1));
    const first = children[0]!;
    const last = children[children.length - 1]!;
    const entry: Placed = {
      node,
      depth,
      x,
      y: (first.y + last.y) / 2,
      hasChildren,
      collapsed: false,
    };
    placed.push(entry);
    children.forEach((child) => links.push({ from: entry, to: child }));
    return entry;
  };

  walk(root, 0);
  const maxDepth = placed.reduce((max, item) => Math.max(max, item.depth), 0);
  return {
    placed,
    links,
    width: maxDepth * COL_W + CARD_W,
    height: Math.max(row, 1) * ROW_H,
  };
}

const STATE_LABEL: Record<DecisionState, string> = {
  chosen: "已采纳",
  rejected: "已否决",
  open: "未决",
};

const STATE_TONE: Record<DecisionState, string> = {
  chosen: "text-live",
  rejected: "text-faint",
  open: "text-warn",
};

function NodeCard({ item }: { item: Placed }) {
  const { node } = item;
  return (
    <div
      style={{ left: item.x, top: item.y, width: CARD_W }}
      className={cx(
        "absolute -translate-y-1/2 rounded-[11px] bg-card px-4 py-3",
        node.state === "chosen" && "border border-ink",
        node.state === "rejected" && "border border-dashed border-rule",
        node.state === "open" && "border border-dashed border-warn/45",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className={cx("eyebrow", STATE_TONE[node.state])}>{STATE_LABEL[node.state]}</span>
        {node.when ? <span className="num text-[10.5px] text-faint">{node.when}</span> : null}
        {node.owner ? <span className="ml-auto text-[10.5px] text-faint">{node.owner}</span> : null}
      </div>
      <div
        className={cx(
          "mt-2 text-[13.5px] leading-snug font-medium",
          node.state === "rejected" ? "text-muted line-through decoration-rule-strong" : "text-ink",
        )}
      >
        {node.title}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-[1.65] text-muted">{node.detail}</p>

      {item.hasChildren ? (
        <button
          type="button"
          onClick={() => toggleNode(node.id)}
          title={item.collapsed ? "展开分支" : "收起分支"}
          className="absolute top-1/2 -right-3 z-10 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-rule bg-card text-[12px] leading-none text-ink-2 transition-colors hover:border-ink hover:text-ink"
        >
          {item.collapsed ? "+" : "−"}
        </button>
      ) : null}
    </div>
  );
}

export function DecisionTree({ root }: { root: DecisionNode }) {
  const collapsed = useApp((s) => s.collapsedNodes, shallowEqual);
  const { placed, links, width, height } = useMemo(
    () => layout(root, collapsed),
    [root, collapsed],
  );

  return (
    <div className="overflow-x-auto pb-2">
      <div className="relative" style={{ width, height: height + 24 }}>
        <svg
          width={width}
          height={height + 24}
          className="absolute inset-0 text-rule-strong"
          aria-hidden
        >
          {links.map(({ from, to }) => {
            const x1 = from.x + CARD_W;
            const x2 = to.x;
            const mid = x1 + (x2 - x1) / 2;
            return (
              <path
                key={`${from.node.id}-${to.node.id}`}
                d={`M ${x1} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${x2} ${to.y}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                strokeDasharray={to.node.state === "rejected" ? "3 4" : undefined}
              />
            );
          })}
        </svg>
        {placed.map((item) => (
          <NodeCard key={item.node.id} item={item} />
        ))}
      </div>
    </div>
  );
}
