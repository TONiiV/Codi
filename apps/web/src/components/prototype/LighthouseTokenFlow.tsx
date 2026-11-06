// PROTOTYPE, wipe me. Token flow drawn like an income-statement sankey: projects on the left
// feed one total, the total splits into harness providers, and each provider splits into
// input, cache-hit and output tokens. Seeded per project so the numbers are stable across reloads.
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { projectName } from "./LighthouseWork";

const PROVIDERS = [
  { id: "claude", label: "Claude Code", yuanPerM: 58, color: "var(--warning)", cache: 0.58 },
  { id: "codex", label: "Codex", yuanPerM: 44, color: "var(--foreground)", cache: 0.42 },
  { id: "cursor", label: "Cursor", yuanPerM: 50, color: "var(--info)", cache: 0.35 },
  { id: "opencode", label: "OpenCode", yuanPerM: 18, color: "var(--success)", cache: 0.2 },
] as const;

const TYPES = [
  { id: "cache", label: "缓存命中", note: "便宜，付 1/10", color: "var(--success)" },
  { id: "input", label: "输入", note: "全价", color: "var(--muted-foreground)" },
  { id: "output", label: "输出", note: "最贵，约 5 倍", color: "var(--destructive)" },
] as const;

function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h >>> 0) % 10_000) / 10_000;
  };
}

/** Tokens in thousands, per project and provider, for this week (0) and last week (1). */
function usage(project: string, week: 0 | 1) {
  const next = seeded(`${project}:${week}`);
  const scale = 400 + next() * 3200;
  return PROVIDERS.map((p, i) => {
    const share = next() * (i === 0 ? 1 : 0.55);
    return Math.round(scale * share);
  });
}

/** Splits a provider's tokens into cache hits, fresh input and output. */
function split(k: number, provider: (typeof PROVIDERS)[number]) {
  const cache = Math.round(k * provider.cache);
  const output = Math.round(k * 0.12);
  return { cache, input: k - cache - output, output };
}

const sum = (xs: ReadonlyArray<number>) => xs.reduce((s, v) => s + v, 0);
const fmtK = (k: number) => (k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${k}K`);
const fmtYuan = (k: number, yuanPerM: number) => `¥${Math.round((k / 1000) * yuanPerM)}`;
const fmtDelta = (now: number, before: number) =>
  before === 0 ? "" : `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}%`;

/* Sankey geometry. One scale for every column, so a band keeps its width across the chart. */
const W = 960;
const H = 420;
const NODE = 14;
const GAP = 14;
const COLS = [150, 400, 640, 870];

interface Node {
  key: string;
  col: number;
  value: number;
  y: number;
  color: string;
  title: string;
  lines: ReadonlyArray<string>;
}
interface Link {
  from: string;
  to: string;
  value: number;
  color: string;
  /** The project the band belongs to, for hover focus. */
  project: string | null;
}

function stack(nodes: Node[], scale: number) {
  const byCol = new Map<number, Node[]>();
  for (const n of nodes) byCol.set(n.col, [...(byCol.get(n.col) ?? []), n]);
  for (const col of byCol.values()) {
    const height = sum(col.map((n) => n.value)) * scale + GAP * (col.length - 1);
    let y = (H - height) / 2;
    for (const n of col) {
      n.y = y;
      y += n.value * scale + GAP;
    }
  }
}

function band(x0: number, y0: number, x1: number, y1: number, h: number) {
  const mx = (x0 + x1) / 2;
  return `M${x0} ${y0} C${mx} ${y0} ${mx} ${y1} ${x1} ${y1} L${x1} ${y1 + h} C${mx} ${y1 + h} ${mx} ${y0 + h} ${x0} ${y0 + h} Z`;
}

function Sankey({
  projects,
  week,
  focus,
  onFocus,
}: {
  projects: ReadonlyArray<string>;
  week: 0 | 1;
  focus: string | null;
  onFocus: (project: string | null) => void;
}) {
  const rows = projects.map((p) => ({ id: p, cells: usage(p, week), before: usage(p, 1) }));
  const byProvider = PROVIDERS.map((_, i) => sum(rows.map((r) => r.cells[i]!)));
  const grand = sum(byProvider);
  const beforeGrand = sum(rows.flatMap((r) => r.before));
  const typeTotals = TYPES.map((t) => sum(PROVIDERS.map((p, i) => split(byProvider[i]!, p)[t.id])));
  const scale = (H - GAP * (Math.max(rows.length, PROVIDERS.length) - 1) - 24) / grand;

  const nodes: Node[] = [
    ...rows.map((r) => ({
      key: `p:${r.id}`,
      col: 0,
      value: sum(r.cells),
      y: 0,
      color: "var(--primary)",
      title: projectName(r.id),
      lines: [fmtK(sum(r.cells)), fmtDelta(sum(r.cells), sum(r.before))],
    })),
    {
      key: "total",
      col: 1,
      value: grand,
      y: 0,
      color: "var(--primary)",
      title: "总用量",
      lines: [fmtK(grand), `较上周 ${fmtDelta(grand, beforeGrand) || "无"}`],
    },
    ...PROVIDERS.map((p, i) => ({
      key: `h:${p.id}`,
      col: 2,
      value: byProvider[i]!,
      y: 0,
      color: p.color,
      title: p.label,
      lines: [
        `${fmtK(byProvider[i]!)} · ${Math.round((byProvider[i]! / grand) * 100)}%`,
        `${fmtYuan(byProvider[i]!, p.yuanPerM)} 估算`,
      ],
    })),
    ...TYPES.map((t, i) => ({
      key: `t:${t.id}`,
      col: 3,
      value: typeTotals[i]!,
      y: 0,
      color: t.color,
      title: t.label,
      lines: [`${fmtK(typeTotals[i]!)} · ${Math.round((typeTotals[i]! / grand) * 100)}%`, t.note],
    })),
  ];
  stack(nodes, scale);
  const at = new Map(nodes.map((n) => [n.key, n]));

  const links: Link[] = [
    ...rows.map((r) => ({
      from: `p:${r.id}`,
      to: "total",
      value: sum(r.cells),
      color: "var(--primary)",
      project: r.id,
    })),
    ...rows.flatMap((r) =>
      PROVIDERS.map((p, i) => ({
        from: "total",
        to: `h:${p.id}`,
        value: r.cells[i]!,
        color: p.color,
        project: r.id,
      })),
    ),
    ...PROVIDERS.flatMap((p, i) =>
      TYPES.map((t) => ({
        from: `h:${p.id}`,
        to: `t:${t.id}`,
        value: split(byProvider[i]!, p)[t.id],
        color: t.color,
        project: null,
      })),
    ),
  ];
  // Bands leave and enter a node in the order the links are listed, so offsets accumulate.
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const paths = links.map((l) => {
    const a = at.get(l.from)!;
    const b = at.get(l.to)!;
    const y0 = a.y + (outOffset.get(l.from) ?? 0);
    const y1 = b.y + (inOffset.get(l.to) ?? 0);
    const h = l.value * scale;
    outOffset.set(l.from, y0 - a.y + h);
    inOffset.set(l.to, y1 - b.y + h);
    return { ...l, d: band(COLS[a.col]! + NODE, y0, COLS[b.col]!, y1, h) };
  });

  const dim = (project: string | null) => focus !== null && project !== null && project !== focus;
  // Label blocks sit beside their node, centred on it, and get pushed down when the node above
  // is too short for its own block. The total node alone is labelled above itself.
  const LINE = 14;
  const labelY = new Map<string, number>();
  for (const col of [0, 2, 3]) {
    let bottom = 0;
    for (const n of nodes.filter((n) => n.col === col)) {
      const block = LINE * (n.lines.length + 1);
      const y = Math.max(n.y + (n.value * scale) / 2 - block / 2, bottom + 4);
      labelY.set(n.key, y);
      bottom = y + block;
    }
  }
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="token 流向图：项目流向总用量，再流向各 provider，再分成缓存命中、输入和输出"
      className="w-full"
      style={{ fontFamily: "inherit" }}
      onMouseLeave={() => onFocus(null)}
    >
      {paths.map((p) => (
        <path
          key={`${p.from}-${p.to}`}
          d={p.d}
          fill={p.color}
          className="transition-opacity duration-150 motion-reduce:transition-none"
          style={{ opacity: dim(p.project) ? 0.08 : 0.36 }}
        />
      ))}
      {nodes.map((n) => {
        const x = COLS[n.col]!;
        const h = Math.max(2, n.value * scale);
        const left = n.col === 0;
        const tx = left ? x - 10 : n.col === 1 ? x + NODE / 2 : x + NODE + 10;
        const anchor = left ? "end" : n.col === 1 ? "middle" : "start";
        const ty =
          n.col === 1 ? n.y - 8 - (n.lines.length - 1) * LINE : (labelY.get(n.key) ?? n.y) + 12;
        const project = n.key.startsWith("p:") ? n.key.slice(2) : null;
        const faded = project !== null && focus !== null && project !== focus;
        return (
          <g
            key={n.key}
            onMouseEnter={project ? () => onFocus(project) : undefined}
            style={{ cursor: project ? "default" : undefined, opacity: faded ? 0.35 : 1 }}
          >
            {project ? (
              <rect
                x={0}
                y={Math.min(n.y, ty - 12)}
                width={x + NODE}
                height={Math.max(h, LINE * (n.lines.length + 1))}
                fill="transparent"
              />
            ) : null}
            <rect x={x} y={n.y} width={NODE} height={h} fill={n.color} rx={1} />
            <text
              x={tx}
              y={ty}
              textAnchor={anchor}
              className="fill-foreground text-sm font-medium"
              style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 4 }}
            >
              {n.title}
            </text>
            {n.lines.map((line, i) => (
              <text
                key={line + String(i)}
                x={tx}
                y={ty + LINE * (i + 1)}
                textAnchor={anchor}
                className="fill-muted-foreground text-2xs tabular-nums"
                style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 4 }}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function TokenFlow({ projects }: { projects: ReadonlyArray<string> }) {
  const [week, setWeek] = useState<0 | 1>(0);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [focus, setFocus] = useState<string | null>(null);
  const rows = projects.map((p) => ({ id: p, cells: usage(p, week), before: usage(p, 1) }));
  const colTotals = PROVIDERS.map((_, i) => sum(rows.map((r) => r.cells[i]!)));
  const grand = sum(colTotals);
  const max = Math.max(1, ...rows.flatMap((r) => r.cells));
  const cost = (cells: ReadonlyArray<number>) =>
    `¥${Math.round(sum(cells.map((v, i) => (v / 1000) * PROVIDERS[i]!.yuanPerM)))}`;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <span className="text-sm font-medium">
          token 流向 · {week === 0 ? "本周" : "上周"}{" "}
          <span className="text-muted-foreground tabular-nums">
            共 {fmtK(grand)} · 约 {cost(colTotals)}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <Button
            size="xs"
            variant={week === 0 ? "secondary" : "ghost-muted"}
            onClick={() => setWeek(0)}
          >
            本周
          </Button>
          <Button
            size="xs"
            variant={week === 1 ? "secondary" : "ghost-muted"}
            onClick={() => setWeek(1)}
          >
            上周
          </Button>
          <span className="mx-1 h-4 w-px bg-border" />
          <Button
            size="xs"
            variant={view === "chart" ? "secondary" : "ghost-muted"}
            onClick={() => setView("chart")}
          >
            流向图
          </Button>
          <Button
            size="xs"
            variant={view === "table" ? "secondary" : "ghost-muted"}
            onClick={() => setView("table")}
          >
            明细表
          </Button>
        </span>
      </div>
      {view === "chart" ? (
        <div className="px-3 pb-2">
          <Sankey projects={projects} week={week} focus={focus} onFocus={setFocus} />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>项目</TableHead>
              {PROVIDERS.map((p) => (
                <TableHead key={p.id} className="text-end">
                  {p.label}
                </TableHead>
              ))}
              <TableHead className="text-end">合计</TableHead>
              <TableHead className="text-end">估算费用</TableHead>
              <TableHead className="text-end">较上周</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const delta = week === 0 ? fmtDelta(sum(r.cells), sum(r.before)) : "";
              return (
                <TableRow key={r.id}>
                  <TableCell>{projectName(r.id)}</TableCell>
                  {r.cells.map((k, i) => (
                    <TableCell key={PROVIDERS[i]!.id} className="text-end">
                      <span
                        className="inline-block rounded-sm px-1.5 py-0.5 tabular-nums"
                        style={{
                          background: `color-mix(in oklab, var(--primary) ${Math.round((k / max) * 42)}%, transparent)`,
                        }}
                      >
                        {fmtK(k)}
                      </span>
                    </TableCell>
                  ))}
                  <TableCell className="text-end">
                    <span className="font-medium tabular-nums">{fmtK(sum(r.cells))}</span>
                  </TableCell>
                  <TableCell className="text-end">
                    <span className="tabular-nums">{cost(r.cells)}</span>
                  </TableCell>
                  <TableCell className="text-end">
                    <span
                      className={cn(
                        "tabular-nums",
                        delta.startsWith("+") ? "text-destructive" : "text-success",
                      )}
                    >
                      {delta}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell>
                <span className="font-medium">合计</span>
              </TableCell>
              {colTotals.map((k, i) => (
                <TableCell key={PROVIDERS[i]!.id} className="text-end">
                  <span className="font-medium tabular-nums">{fmtK(k)}</span>
                </TableCell>
              ))}
              <TableCell className="text-end">
                <span className="font-medium tabular-nums">{fmtK(grand)}</span>
              </TableCell>
              <TableCell className="text-end">
                <span className="font-medium tabular-nums">{cost(colTotals)}</span>
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      )}
      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        费用按各 provider 的混合单价估算（Claude Code ¥58/M、Codex ¥44/M、Cursor ¥50/M、OpenCode
        ¥18/M）。悬停左侧项目名，只看它的流向。真实接入要在 Codi 的用量汇总里加项目维度。
      </div>
    </div>
  );
}
