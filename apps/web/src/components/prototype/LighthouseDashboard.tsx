// PROTOTYPE, wipe me. The dashboard answers one question: where is delivery stuck this week.
// Key numbers, a bar chart that filters the funnel and the detail table, drill-down with a
// breadcrumb, data provenance, and export. Tickets are seeded per project, so every number
// on the page is computed from the same rows.
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  DownloadIcon,
  InfoIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { PROJECT_COS, PROJECTS, TASKS, projectsIn, type LighthouseViewer } from "./lighthouseData";
import { projectName } from "./LighthouseWork";

const STAGES = [
  { id: "created", label: "创建" },
  { id: "started", label: "开工" },
  { id: "pr", label: "PR" },
  { id: "green", label: "CI 绿" },
  { id: "merged", label: "合并" },
] as const;
type Stage = (typeof STAGES)[number]["id"];
const stageIndex = (s: Stage) => STAGES.findIndex((x) => x.id === s);
const stageLabel = (s: Stage) => STAGES[stageIndex(s)]!.label;

const DAYS = ["10/27", "10/28", "10/29", "10/30", "10/31", "11/01", "11/02"];
const UPDATED = "10:24";

interface Ticket {
  id: string;
  title: string;
  project: string;
  worker: string;
  /** 0 = the last 7 days, 1 = the 7 days before. */
  week: 0 | 1;
  day: number;
  stage: Stage;
  stuck: string | null;
  /** Hours a ticket at PR or CI green has waited for a human to confirm. */
  waitHours: number;
  /** Hours from created to merged; 0 until merged. */
  cycleHours: number;
}

const FILLER = [
  "修 Safari 下的布局错位",
  "补齐接口错误码",
  "首页图片懒加载",
  "登录态过期后自动刷新",
  "导出 CSV 加列头",
  "移除旧的埋点脚本",
  "升级依赖并跑回归",
  "补单测：结算边界",
  "改文案：定价页",
  "压缩首屏 JS",
  "CI 缓存 key 改成按锁文件",
  "日志加 trace id",
];
// A stuck reason has to fit the step the ticket stopped at.
const STUCK: Record<Stage, ReadonlyArray<string>> = {
  created: ["没人接", "等设计稿"],
  started: ["环境离线", "等设计稿", "依赖评审没回"],
  pr: ["CI 一直红", "评审没回"],
  green: ["等你确认合并"],
  merged: [],
};

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function seedTickets(project: string): Ticket[] {
  const r = rng(project);
  const real = TASKS.filter((t) => t.project === project).flatMap((t) => t.tickets);
  const risky =
    PROJECTS[project]?.tone === "bad" ? 0.45 : PROJECTS[project]?.tone === "warn" ? 0.3 : 0.15;
  const out: Ticket[] = [];
  let n = 60;
  for (const week of [0, 1] as const) {
    const count = 6 + Math.floor(r() * 6);
    for (let i = 0; i < count; i++) {
      const src = week === 0 ? real[i] : undefined;
      const stage: Stage = src
        ? src.state === "merged"
          ? "merged"
          : src.state === "pr"
            ? r() < 0.5
              ? "green"
              : "pr"
            : "started"
        : STAGES[Math.min(4, Math.floor(r() * 6))]!.id;
      const open = stage !== "merged";
      out.push({
        id: src?.id ?? `${project}#${n++}`,
        title: src?.title ?? FILLER[Math.floor(r() * FILLER.length)]!,
        project,
        worker: src?.worker ?? `W${2 + Math.floor(r() * 20)}`,
        week,
        day: Math.floor(r() * 7),
        stage,
        stuck:
          open && r() < risky
            ? (STUCK[stage][Math.floor(r() * STUCK[stage].length)] ?? null)
            : null,
        waitHours: stage === "pr" || stage === "green" ? Math.round(2 + r() * (week ? 30 : 22)) : 0,
        cycleHours: open ? 0 : Math.round(10 + r() * (week ? 70 : 50)),
      });
    }
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

const METRICS = [
  {
    id: "merged",
    label: "合并 PR",
    unit: "",
    better: "up",
    of: (ts: Ticket[]) => ts.filter((t) => t.stage === "merged").length,
    rows: (t: Ticket) => t.stage === "merged",
    how: "GitHub / GitLab 的 PR 合并事件，按合并时间落在近 7 天计。只算 Lighthouse 派出的工单。",
  },
  {
    id: "stuck",
    label: "卡住的工单",
    unit: "",
    better: "down",
    of: (ts: Ticket[]) => ts.filter((t) => t.stuck).length,
    rows: (t: Ticket) => t.stuck !== null,
    how: "未合并且 Worker 或 Chief Agent 标了阻塞原因的工单。阻塞解除就不再算。",
  },
  {
    id: "wait",
    label: "等你确认",
    unit: "h",
    better: "down",
    of: (ts: Ticket[]) =>
      Math.round(avg(ts.filter((t) => t.waitHours > 0).map((t) => t.waitHours))),
    rows: (t: Ticket) => t.waitHours > 0,
    how: "停在 PR 或 CI 绿、等人确认的工单，从提出确认到现在的小时数，取平均。",
  },
  {
    id: "cycle",
    label: "交付周期",
    unit: "h",
    better: "down",
    of: (ts: Ticket[]) => median(ts.filter((t) => t.cycleHours > 0).map((t) => t.cycleHours)),
    rows: (t: Ticket) => t.cycleHours > 0,
    how: "已合并工单从创建到合并的小时数，取中位数，不受个别长尾影响。",
  },
] as const;
type MetricId = (typeof METRICS)[number]["id"];
const metric = (id: MetricId) => METRICS.find((m) => m.id === id)!;

// Six earlier weeks for the sparkline; the last two points are the real windows.
function history(id: MetricId, now: number, before: number) {
  const r = rng(`hist-${id}`);
  const base = (now + before) / 2 || 1;
  return [...Array.from({ length: 6 }, () => Math.max(0, base * (0.6 + r() * 0.8))), before, now];
}

interface Path {
  project?: string;
  stage?: Stage;
  metric?: MetricId;
  ticket?: string;
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 76 + 2},${22 - (v / max) * 18}`);
  const last = pts.at(-1)!.split(",");
  return (
    <svg viewBox="0 0 80 24" className="h-6 w-20" aria-hidden="true">
      <polyline
        points={pts.join(" ")}
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-muted-foreground/60"
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" className="fill-foreground" />
    </svg>
  );
}

function Kpi({
  id,
  now,
  before,
  onCheck,
}: {
  id: MetricId;
  now: Ticket[];
  before: Ticket[];
  onCheck: () => void;
}) {
  const m = metric(id);
  const a = m.of(now);
  const b = m.of(before);
  const delta = a - b;
  const good = delta === 0 ? null : delta > 0 === (m.better === "up");
  const Arrow = delta >= 0 ? ArrowUpIcon : ArrowDownIcon;
  return (
    <button
      type="button"
      onClick={onCheck}
      className="flex cursor-pointer flex-col gap-1 rounded-lg border bg-card p-4 text-start hover:bg-accent/40"
    >
      <span className="text-xs text-muted-foreground">{m.label}</span>
      <span className="flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {a}
          {m.unit ? <span className="ms-0.5 text-sm text-muted-foreground">{m.unit}</span> : null}
        </span>
        <Sparkline values={history(id, a, b)} />
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 text-xs tabular-nums",
          good === null && "text-muted-foreground",
          good === true && "text-success-foreground",
          good === false && "text-destructive-foreground",
        )}
      >
        {delta === 0 ? null : <Arrow className="size-3" />}
        {delta === 0 ? "持平" : `${Math.abs(delta)}${m.unit}`}
        <span className="ms-1 text-muted-foreground">较前 7 天</span>
      </span>
    </button>
  );
}

function Bars({
  bars,
  picked,
  onPick,
  label,
}: {
  bars: ReadonlyArray<{ key: string; label: string; value: number }>;
  picked: string | null;
  onPick: (key: string) => void;
  label: string;
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  const w = 320 / bars.length;
  const bw = Math.min(28, w * 0.5);
  const labelled = picked ?? bars.reduce((a, b) => (b.value > a.value ? b : a), bars[0]!).key;
  return (
    <svg viewBox="0 0 320 140" className="h-44 w-full" role="img" aria-label={label}>
      <line x1="0" x2="320" y1="116" y2="116" className="stroke-border" />
      {bars.map((b, i) => {
        const h = (b.value / max) * 92;
        const x = i * w + (w - bw) / 2;
        const y = 116 - h;
        const r = Math.min(4, h);
        const on = picked === null || picked === b.key;
        return (
          <g key={b.key} className="cursor-pointer" onClick={() => onPick(b.key)}>
            <title>{`${b.label}：${b.value}`}</title>
            <rect x={i * w} y="0" width={w} height="132" className="fill-transparent" />
            {h > 0 ? (
              <path
                d={`M${x} 116 V${y + r} Q${x} ${y} ${x + r} ${y} H${x + bw - r} Q${x + bw} ${y} ${x + bw} ${y + r} V116 Z`}
                className={cn(on ? "fill-primary" : "fill-primary/25")}
              />
            ) : null}
            {b.key === labelled ? (
              <text
                x={x + bw / 2}
                y={y - 5}
                textAnchor="middle"
                className="fill-foreground text-2xs tabular-nums"
              >
                {b.value}
              </text>
            ) : null}
            <text
              x={i * w + w / 2}
              y="131"
              textAnchor="middle"
              className={cn(
                "text-2xs",
                picked === b.key ? "fill-foreground" : "fill-muted-foreground",
              )}
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Funnel({ tickets, onStage }: { tickets: Ticket[]; onStage: (s: Stage) => void }) {
  const counts = STAGES.map(
    (s) => tickets.filter((t) => stageIndex(t.stage) >= stageIndex(s.id)).length,
  );
  const top = Math.max(counts[0] ?? 0, 1);
  return (
    <ol className="flex flex-col gap-1.5">
      {STAGES.map((s, i) => {
        const n = counts[i] ?? 0;
        const prev = i === 0 ? n : (counts[i - 1] ?? 0);
        const stopped = tickets.filter((t) => t.stage === s.id).length;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onStage(s.id)}
              className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-start text-xs hover:bg-accent/40"
              aria-label={`${s.label} ${n}，停在这一步的 ${stopped} 张，点开看明细`}
            >
              <span className="w-10 shrink-0 text-muted-foreground">{s.label}</span>
              <span className="relative h-5 flex-1">
                <span
                  className="absolute inset-y-0 start-0 rounded-sm bg-primary/70 group-hover:bg-primary"
                  style={{ width: `${(n / top) * 100}%` }}
                />
              </span>
              <span className="w-6 shrink-0 text-end font-medium tabular-nums">{n}</span>
              <span className="w-10 shrink-0 text-end text-muted-foreground tabular-nums">
                {i === 0 ? "" : `${prev ? Math.round((n / prev) * 100) : 0}%`}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Provenance({ onCheck }: { onCheck: (id: MetricId) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="xs" variant="ghost-muted" />}>
        <InfoIcon /> 口径
      </PopoverTrigger>
      <PopoverPopup align="end" width="lg">
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-xs text-muted-foreground">
            窗口：近 7 天（10/27–11/02），对比前 7 天。来源：工单表 + Git 平台事件，每 15
            分钟同步一次，最近一次 {UPDATED}。只算你能看到的项目。
          </p>
          {METRICS.map((m) => (
            <div key={m.id} className="flex flex-col gap-0.5">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{m.label}</span>
                <Button
                  size="xs"
                  variant="link"
                  onClick={() => {
                    setOpen(false);
                    onCheck(m.id);
                  }}
                >
                  核对
                </Button>
              </span>
              <span className="text-xs text-muted-foreground">{m.how}</span>
            </div>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function toCsv(rows: Ticket[]) {
  const head = ["工单", "标题", "项目", "阶段", "卡住原因", "等你确认(h)", "Worker", "负责人"];
  const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  return [
    head,
    ...rows.map((t) => [
      t.id,
      t.title,
      projectName(t.project),
      stageLabel(t.stage),
      t.stuck ?? "",
      t.waitHours || "",
      t.worker,
      PROJECTS[t.project]?.lead ?? "",
    ]),
  ]
    .map((r) => r.map(esc).join(","))
    .join("\n");
}

function download(rows: Ticket[], name: string) {
  const blob = new Blob([`﻿${toCsv(rows)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Timeline({ t }: { t: Ticket }) {
  const reached = STAGES.slice(0, stageIndex(t.stage) + 1);
  const hours = [9, 11, 15, 16, 18];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-sm text-muted-foreground">{t.id}</span>
        <h3 className="text-lg font-semibold">{t.title}</h3>
        {t.stuck ? <Badge variant="warning">卡住：{t.stuck}</Badge> : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {projectName(t.project)} · Worker {t.worker} · 负责人 {PROJECTS[t.project]?.lead} · Chief
        Agent {PROJECT_COS[t.project]?.name}
      </div>
      <ol className="relative flex flex-col gap-3 before:absolute before:start-1.5 before:top-1 before:bottom-1 before:w-px before:bg-border">
        {reached.map((s, i) => (
          <li key={s.id} className="relative flex gap-3 text-sm">
            <span className="relative z-10 mt-1 size-3 shrink-0 rounded-full bg-primary ring-4 ring-background" />
            <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
              {DAYS[Math.min(6, t.day + Math.floor(i / 2))]} {hours[i]}:0{i}
            </span>
            <span>
              {s.id === "created" ? `Chief Agent 开单，派给 ${t.worker}` : null}
              {s.id === "started" ? `${t.worker} 开工` : null}
              {s.id === "pr" ? "PR 已开，等 CI" : null}
              {s.id === "green"
                ? `CI 绿，等你确认${t.waitHours ? `（已等 ${t.waitHours}h）` : ""}`
                : null}
              {s.id === "merged" ? `合并，交付周期 ${t.cycleHours}h` : null}
            </span>
          </li>
        ))}
        {t.stuck ? (
          <li className="relative flex gap-3 text-sm">
            <span className="relative z-10 mt-1 size-3 shrink-0 rounded-full bg-warning ring-4 ring-background" />
            <span className="w-24 shrink-0 text-muted-foreground">现在</span>
            <span>
              卡在「{stageLabel(t.stage)}」：{t.stuck}
            </span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

export function DashboardPage({
  viewer,
  workspace,
}: {
  viewer: LighthouseViewer;
  workspace: string;
}) {
  const open = projectsIn(workspace, viewer).open;
  const all = open.flatMap(seedTickets);
  const [path, setPath] = useState<Path>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const go = (next: Path) => {
    setPath(next);
    setPicked(null);
    setSent(null);
  };

  const inScope = (t: Ticket) =>
    (!path.project || t.project === path.project) &&
    (!path.stage || t.stage === path.stage) &&
    (!path.metric || metric(path.metric).rows(t));
  const now = all.filter((t) => t.week === 0 && inScope(t));
  const before = all.filter((t) => t.week === 1 && inScope(t));
  const overview = !path.project && !path.stage && !path.metric;
  const byProject = overview;
  const bars = byProject
    ? open.map((p) => ({
        key: p,
        label: projectName(p),
        value: now.filter((t) => t.project === p && t.stage !== "merged").length,
      }))
    : DAYS.map((d, i) => ({
        key: String(i),
        label: d,
        value: now.filter((t) => t.day === i && t.stage !== "merged").length,
      }));
  const linked = now.filter((t) =>
    picked === null ? true : byProject ? t.project === picked : t.day === Number(picked),
  );
  const ticket = path.ticket ? all.find((t) => t.id === path.ticket) : undefined;

  const crumbs: Array<{ label: string; to: Path }> = [{ label: "看板", to: {} }];
  if (path.project)
    crumbs.push({ label: projectName(path.project), to: { project: path.project } });
  const base = path.project ? { project: path.project } : {};
  if (path.stage)
    crumbs.push({ label: `停在 ${stageLabel(path.stage)}`, to: { ...base, stage: path.stage } });
  if (path.metric)
    crumbs.push({ label: metric(path.metric).label, to: { ...base, metric: path.metric } });
  if (path.ticket) crumbs.push({ label: path.ticket, to: path });

  const owners = [...new Set(linked.map((t) => PROJECTS[t.project]?.lead ?? ""))].filter(Boolean);
  // ASCII only: Chromium drops a non-ASCII download name for a blob link.
  const file = `lighthouse-${[path.project, path.stage, path.metric, picked].filter(Boolean).join("-") || "all"}.csv`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <nav aria-label="看板层级" className="flex flex-wrap items-center gap-0.5 text-xs">
            {crumbs.map((c, i) => (
              <span key={c.label} className="inline-flex items-center gap-0.5">
                {i > 0 ? <ChevronRightIcon className="size-3 text-muted-foreground" /> : null}
                {i === crumbs.length - 1 ? (
                  <span className="px-1 font-medium">{c.label}</span>
                ) : (
                  <Button size="xs" variant="ghost-muted" onClick={() => go(c.to)}>
                    {c.label}
                  </Button>
                )}
              </span>
            ))}
          </nav>
          <h1 className="text-2xl font-semibold">
            {ticket ? "这张工单卡在哪一步？" : "这周交付卡在哪里？"}
          </h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">数据更新于 {UPDATED}</span>
          <Provenance onCheck={(id) => go({ ...base, metric: id })} />
        </div>
      </div>

      {ticket ? (
        <div className="rounded-lg border bg-card p-5">
          <Timeline t={ticket} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {METRICS.map((m) => (
              <Kpi
                key={m.id}
                id={m.id}
                now={now}
                before={before}
                onCheck={() => go({ ...base, metric: m.id })}
              />
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-5">
            <div className="rounded-lg border bg-card p-4 lg:col-span-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  未合并工单 · {byProject ? "按项目" : "按开单日期"}
                </span>
                {picked !== null ? (
                  <Button size="xs" variant="secondary" onClick={() => setPicked(null)}>
                    {bars.find((b) => b.key === picked)?.label}
                    <XIcon />
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">点柱子，右边和下面跟着筛</span>
                )}
              </div>
              <Bars
                bars={bars}
                picked={picked}
                onPick={(k) => setPicked(picked === k ? null : k)}
                label={`未合并工单，${byProject ? "按项目" : "按开单日期"}`}
              />
            </div>
            <div className="rounded-lg border bg-card p-4 lg:col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">交付漏斗</span>
                <span className="text-xs text-muted-foreground">
                  {picked === null ? "全部" : bars.find((b) => b.key === picked)?.label} ·
                  点一段看停在那的
                </span>
              </div>
              <div className="mt-3">
                <Funnel tickets={linked} onStage={(s) => go({ ...base, stage: s })} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="text-sm font-medium">
                明细 <span className="text-muted-foreground tabular-nums">{linked.length} 行</span>
              </span>
              <span className="flex items-center gap-1">
                <Button size="xs" variant="outline" onClick={() => download(linked, file)}>
                  <DownloadIcon /> 导出明细
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={linked.length === 0}
                  onClick={() => setSent(`已发给 ${owners.join("、")}（CSV，${linked.length} 行）`)}
                >
                  <SendIcon /> 发给负责人
                </Button>
              </span>
            </div>
            {sent ? (
              <div className="mx-4 mb-2.5 flex items-center justify-between gap-2 rounded-md bg-success/8 px-3 py-2 text-sm">
                <span>
                  {sent}，附了当前筛选：{crumbs.map((c) => c.label).join(" / ")}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="关闭"
                  onClick={() => setSent(null)}
                >
                  <XIcon />
                </Button>
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>工单</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead>项目</TableHead>
                  <TableHead>阶段</TableHead>
                  <TableHead>卡住原因</TableHead>
                  <TableHead className="text-end">等你确认</TableHead>
                  <TableHead>负责人</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linked.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() =>
                      go(overview ? { project: t.project } : { ...path, ticket: t.id })
                    }
                  >
                    <TableCell>
                      <span className="font-mono text-xs">{t.id}</span>
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-64 truncate">{t.title}</span>
                    </TableCell>
                    <TableCell>{projectName(t.project)}</TableCell>
                    <TableCell>{stageLabel(t.stage)}</TableCell>
                    <TableCell>
                      {t.stuck ? <Badge variant="warning">{t.stuck}</Badge> : null}
                    </TableCell>
                    <TableCell className="text-end">
                      <span className="tabular-nums">{t.waitHours ? `${t.waitHours}h` : ""}</span>
                    </TableCell>
                    <TableCell>{PROJECTS[t.project]?.lead}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              {overview ? "点一行进入这个项目" : "点一行看这张工单的过程"}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
