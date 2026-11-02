// PROTOTYPE, wipe me. Non-chat views of Lighthouse (Bots, Dashboard) and the Copilot panel on the
// right of every non-chat view, where the user picks which Chief of Staff to talk to.
import { CpuIcon, MessageSquareIcon, PlusIcon, ServerIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { BotAvatar } from "./LighthouseChatList";
import { useAllBots } from "./lighthouseActions";
import { AGENT_STATES, Bloub, type AgentState } from "./LighthouseBloub";
import {
  ASKS,
  PROJECTS,
  TASKS,
  VIEWERS,
  WORKERS,
  projectsIn,
  type LighthouseBot,
  type LighthouseView,
  type LighthouseViewer,
} from "./lighthouseData";
import { useWorkspaceId } from "./workspaceStore";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function projectName(id: string): string {
  return PROJECTS[id]?.name ?? id;
}

export function ThreadAnchor({ id, muted }: { id: string; muted?: boolean }) {
  return (
    <a
      href="#"
      onClick={(e) => e.preventDefault()}
      className={cn(
        "inline-flex items-center gap-1 underline-offset-4 hover:underline",
        muted ? "text-muted-foreground" : "text-primary",
      )}
    >
      <MessageSquareIcon className="size-3.5" />
      {id}
    </a>
  );
}

function botState(b: LighthouseBot): AgentState {
  if (!b.online) return "sleeping";
  if (/写代码|刚启动|分发/.test(b.status)) return "working";
  if (/等/.test(b.status)) return "waiting";
  return "idle";
}

function AvatarShowcase({ bots }: { bots: ReadonlyArray<LighthouseBot> }) {
  const [state, setState] = useState<AgentState>("idle");
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Agent 头像</h2>
          <p className="text-xs text-muted-foreground">
            照搬 bloub。形状和颜色由名字决定，同一个 agent 在哪里都一样。
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {AGENT_STATES.map((s) => (
            <Button
              key={s.id}
              size="xs"
              variant={state === s.id ? "secondary" : "ghost-muted"}
              onClick={() => setState(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {bots.map((b) => (
          <figure key={b.id} className="flex flex-col items-center gap-1">
            <Bloub seed={b.name} state={state} roomy followPointer lively className="w-full" />
            <figcaption className="text-xs font-medium">{b.name}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

export function BotsPage({ viewer, workspace }: { viewer: LighthouseViewer; workspace: string }) {
  const open = projectsIn(workspace, viewer).open;
  const rows = useAllBots().filter((b) =>
    b.project ? open.includes(b.project) : b.kind === "router" || b.kind === "desk",
  );
  return (
    <div className="flex flex-col gap-4">
      <AvatarShowcase bots={rows.slice(0, 6)} />
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Bots</h2>
        <Button size="xs" variant="outline">
          <PlusIcon /> 新建 Worker
        </Button>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bot</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>Harness / 模型</TableHead>
              <TableHead>机器</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-end">打开</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="relative">
                      <BotAvatar seed={b.name} size="sm" state={botState(b)} />
                      <span
                        className={cn(
                          "absolute -end-0.5 -bottom-0.5 size-2 rounded-full border-2 border-card",
                          b.online ? "bg-success" : "bg-muted-foreground",
                        )}
                      />
                    </span>
                    <span className="font-medium">{b.name}</span>
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground">
                    {b.kind === "router"
                      ? "路由"
                      : b.kind === "desk"
                        ? "总台"
                        : b.kind === "cos"
                          ? "项目幕僚长"
                          : `Worker · ${projectName(b.project ?? "")}`}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <CpuIcon className="size-3.5 text-muted-foreground" /> {b.harness}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                    <ServerIcon className="size-3.5 text-muted-foreground" /> {b.where}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground">{b.status}</span>
                </TableCell>
                <TableCell className="text-end">
                  {b.kind === "worker" ? (
                    <ThreadAnchor id="线程" />
                  ) : b.chat ? (
                    <ThreadAnchor id="聊天" muted />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

const WEEK = [3, 5, 2, 6, 4, 7, 5];
const DAYS = ["一", "二", "三", "四", "五", "六", "日"];

export function DashboardPage({
  viewer,
  workspace,
}: {
  viewer: LighthouseViewer;
  workspace: string;
}) {
  const open = projectsIn(workspace, viewer).open;
  const tasks = TASKS.filter((t) => open.includes(t.project));
  const workers = WORKERS.filter((w) => open.includes(w.project));
  const asks = ASKS.filter((a) => a.for.includes(viewer) && open.includes(a.project));
  const prs = tasks.flatMap((t) => t.tickets).filter((t) => t.state === "pr").length;
  const max = Math.max(...WEEK);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Dashboard</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="等你定"
          value={String(asks.length)}
          hint="合并、回答"
          tone="text-warning-foreground"
        />
        <Tile
          label="Worker 在干活"
          value={`${workers.filter((w) => w.online).length}/${workers.length}`}
          hint="在线 / 全部"
        />
        <Tile label="PR 等合并" value={String(prs)} hint="CI 绿" tone="text-success-foreground" />
        <Tile label="今日信道消息" value="14" hint="企微 6 · GitHub 5 · 邮箱 3" />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">本周合并</span>
            <span className="text-xs text-muted-foreground">PR / 天</span>
          </div>
          <svg
            viewBox="0 0 280 80"
            className="mt-3 h-24 w-full"
            role="img"
            aria-label="本周每天合并数"
          >
            {WEEK.map((n, i) => {
              const h = (n / max) * 60;
              return (
                <g key={DAYS[i]}>
                  <rect
                    x={i * 40 + 8}
                    y={64 - h}
                    width={24}
                    height={h}
                    rx={3}
                    className={i === 6 ? "fill-primary" : "fill-primary/35"}
                  />
                  <text
                    x={i * 40 + 20}
                    y={76}
                    textAnchor="middle"
                    className="fill-muted-foreground text-3xs"
                  >
                    {DAYS[i]}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <span className="text-sm font-medium">项目健康</span>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {open.map((p) => {
              const ts = TASKS.filter((t) => t.project === p);
              const done = ts.filter((t) => t.status === "done").length;
              return (
                <li key={p}>
                  <div className="flex justify-between">
                    <span>{projectName(p)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {done}/{ts.length}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-1.5 rounded-full",
                        PROJECTS[p]?.tone === "bad"
                          ? "bg-destructive"
                          : PROJECTS[p]?.tone === "warn"
                            ? "bg-warning"
                            : "bg-success",
                      )}
                      style={{ width: `${ts.length ? (done / ts.length) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="rounded-lg border bg-card">
        <div className="px-4 py-2.5 text-sm font-medium">刚刚发生</div>
        <ul className="divide-y border-t text-sm">
          {open.map((p) => (
            <li key={p} className="flex gap-3 px-4 py-2">
              <span className="w-28 shrink-0 font-medium">{projectName(p)}</span>
              <span className="text-muted-foreground">{PROJECTS[p]?.line}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function WorkSubList({ view, viewer }: { view: LighthouseView; viewer: LighthouseViewer }) {
  const workspace = useWorkspaceId();
  const open = projectsIn(workspace, viewer).open;
  const items =
    view === "tasks"
      ? ["全部任务", ...open.map(projectName)]
      : view === "bots"
        ? ["全部", "常驻", "Worker", "离线"]
        : view === "members"
          ? [VIEWERS[viewer].title]
          : ["全部", ...open.map(projectName)];
  const [active, setActive] = useState(0);
  return (
    <div className="flex flex-col gap-0.5 px-2 pt-1">
      {items.map((label, i) => (
        <Button
          key={label}
          size="sm"
          variant={active === i ? "secondary" : "ghost-muted"}
          className="justify-start"
          onClick={() => setActive(i)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
