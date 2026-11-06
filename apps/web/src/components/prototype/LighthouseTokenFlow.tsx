// PROTOTYPE, wipe me. Token flow: which project spent how many tokens on which harness provider
// this week, with an estimated cost. Seeded per project so the numbers are stable across reloads.
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { projectName } from "./LighthouseWork";

const PROVIDERS = [
  { id: "claude", label: "Claude Code", yuanPerM: 58 },
  { id: "codex", label: "Codex", yuanPerM: 44 },
  { id: "cursor", label: "Cursor", yuanPerM: 50 },
  { id: "opencode", label: "OpenCode", yuanPerM: 18 },
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

const fmtK = (k: number) => (k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${k}K`);
const fmtYuan = (k: number, yuanPerM: number) => `¥${Math.round((k / 1000) * yuanPerM)}`;

export function TokenFlow({ projects }: { projects: ReadonlyArray<string> }) {
  const [week, setWeek] = useState<0 | 1>(0);
  const [unit, setUnit] = useState<"tokens" | "cost">("tokens");
  const rows = projects.map((p) => ({ id: p, cells: usage(p, week), before: usage(p, 1) }));
  const colTotals = PROVIDERS.map((_, i) => rows.reduce((s, r) => s + r.cells[i]!, 0));
  const grand = colTotals.reduce((s, v) => s + v, 0);
  const max = Math.max(1, ...rows.flatMap((r) => r.cells));
  const cell = (k: number, i: number) =>
    unit === "tokens" ? fmtK(k) : fmtYuan(k, PROVIDERS[i]!.yuanPerM);
  const rowTotal = (cells: ReadonlyArray<number>) =>
    unit === "tokens"
      ? fmtK(cells.reduce((s, v) => s + v, 0))
      : `¥${Math.round(cells.reduce((s, v, i) => s + (v / 1000) * PROVIDERS[i]!.yuanPerM, 0))}`;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <span className="text-sm font-medium">
          token 流向 · {week === 0 ? "本周" : "上周"}{" "}
          <span className="text-muted-foreground tabular-nums">共 {fmtK(grand)}</span>
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
            variant={unit === "tokens" ? "secondary" : "ghost-muted"}
            onClick={() => setUnit("tokens")}
          >
            token
          </Button>
          <Button
            size="xs"
            variant={unit === "cost" ? "secondary" : "ghost-muted"}
            onClick={() => setUnit("cost")}
          >
            估算费用
          </Button>
        </span>
      </div>
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
            <TableHead className="text-end">较上周</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const total = r.cells.reduce((s, v) => s + v, 0);
            const prior = r.before.reduce((s, v) => s + v, 0);
            const delta =
              week === 0 && prior > 0 ? Math.round(((total - prior) / prior) * 100) : null;
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
                      {k === 0 ? "0" : cell(k, i)}
                    </span>
                  </TableCell>
                ))}
                <TableCell className="text-end">
                  <span className="font-medium tabular-nums">{rowTotal(r.cells)}</span>
                </TableCell>
                <TableCell className="text-end">
                  <span
                    className={cn(
                      "tabular-nums",
                      delta !== null && (delta > 0 ? "text-destructive" : "text-success"),
                    )}
                  >
                    {delta === null ? "" : `${delta > 0 ? "+" : ""}${delta}%`}
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
                <span className="font-medium tabular-nums">{cell(k, i)}</span>
              </TableCell>
            ))}
            <TableCell className="text-end">
              <span className="font-medium tabular-nums">{rowTotal(colTotals)}</span>
            </TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        费用按各 provider 的混合单价估算（Claude Code ¥58/M、Codex ¥44/M、Cursor ¥50/M、OpenCode
        ¥18/M）。真实接入要在 Codi 的用量汇总里加项目维度。
      </div>
    </div>
  );
}
