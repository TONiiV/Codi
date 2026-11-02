// PROTOTYPE, wipe me. Non-chat views of the Work tab (Bots, Dashboard, Tasks) and the Copilot
// panel that sits on their right, where the user can switch which Chief of Staff they talk to.
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CpuIcon,
  ExpandIcon,
  KanbanIcon,
  MessageSquareIcon,
  PlusIcon,
  SendIcon,
  ServerIcon,
  Table2Icon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { BotAvatar } from "./LighthouseChatList";
import {
  BOTS,
  TASKS,
  TASK_STATUS,
  VIEWERS,
  chatsFor,
  type LighthouseChatId,
  type LighthouseTask,
  type LighthouseView,
  type LighthouseViewer,
  type TaskStatus,
} from "./lighthouseData";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Textarea } from "../ui/textarea";

const PROJECT_NAME: Record<string, string> = { codi: "Codi", site: "官网", app: "移动端" };

function ThreadAnchor({ id, muted }: { id: string; muted?: boolean }) {
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

function TicketChip({ ticket }: { ticket: LighthouseTask["tickets"][number] }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border bg-card px-1.5 py-0.5 text-xs">
      {ticket.state === "open" ? (
        <span className="size-2 rounded-full bg-success" />
      ) : (
        <PullRequestGlyph.pullRequest
          className={cn(
            "size-3",
            ticket.state === "merged" ? "text-muted-foreground" : "text-success",
          )}
        />
      )}
      <span className="font-mono">{ticket.id}</span>
      <span className="text-muted-foreground">{ticket.title}</span>
      {ticket.worker ? <ThreadAnchor id={ticket.worker} /> : null}
    </span>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status];
  return (
    <Badge variant="outline">
      <span className={cn("size-1.5 rounded-full", s.tone)} /> {s.label}
    </Badge>
  );
}

export function BotsPage({ viewer }: { viewer: LighthouseViewer }) {
  const v = VIEWERS[viewer];
  const rows = BOTS.filter((b) => !b.project || v.projects.includes(b.project));
  const hidden = BOTS.length - rows.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">Bots</h2>
          <p className="text-sm text-muted-foreground">
            常驻的路由、总台、幕僚长，和正在干活的 Worker。每一行都是一个 Codi 线程。
          </p>
        </div>
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
                      <BotAvatar tone={b.tone} size="sm" readOnly={b.kind === "desk"} />
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
                        ? "总台 · 只读"
                        : b.kind === "cos"
                          ? `${PROJECT_NAME[b.project ?? ""] ?? ""} 幕僚长`
                          : `Worker · ${PROJECT_NAME[b.project ?? ""] ?? ""}`}
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
                  ) : (
                    <span className="text-xs text-muted-foreground">仅管理员</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {hidden > 0 ? (
        <p className="text-xs text-muted-foreground">
          另有 {hidden} 个 Bot 属于你看不到的项目，这里只告诉你它们存在。
        </p>
      ) : null}
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

export function DashboardPage({ viewer }: { viewer: LighthouseViewer }) {
  const v = VIEWERS[viewer];
  const tasks = TASKS.filter((t) => v.projects.includes(t.project));
  const workers = BOTS.filter(
    (b) => b.kind === "worker" && b.project && v.projects.includes(b.project),
  );
  const prs = tasks.flatMap((t) => t.tickets).filter((t) => t.state === "pr").length;
  const max = Math.max(...WEEK);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          顶层看板，实时。你看到的只是你视野内的 {v.projects.length} 个项目。
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="等你定"
          value={String(viewer === "admin" ? 3 : viewer === "lead" ? 2 : 1)}
          hint="合并、回答、授权"
          tone="text-warning-foreground"
        />
        <Tile
          label="Worker 在干活"
          value={`${workers.filter((w) => w.online).length}/${workers.length}`}
          hint="离线的在等机器回来"
        />
        <Tile
          label="PR 等合并"
          value={String(prs)}
          hint="CI 绿，等人点头"
          tone="text-success-foreground"
        />
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
                <g key={["一", "二", "三", "四", "五", "六", "日"][i]}>
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
                    {["一", "二", "三", "四", "五", "六", "日"][i]}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <span className="text-sm font-medium">项目健康</span>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {v.projects.map((p) => {
              const ts = TASKS.filter((t) => t.project === p);
              const done = ts.filter((t) => t.status === "done").length;
              return (
                <li key={p}>
                  <div className="flex justify-between">
                    <span>{PROJECT_NAME[p]}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {done}/{ts.length} 任务完成
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-1.5 rounded-full",
                        p === "app" ? "bg-warning" : "bg-success",
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
        <div className="flex items-center justify-between px-4 py-2.5 text-sm font-medium">
          <span>刚刚发生</span>
          <span className="text-xs font-normal text-muted-foreground">来自路由与幕僚长</span>
        </div>
        <ul className="divide-y border-t text-sm">
          {[
            ["10:42", "Codi 幕僚长", "把 #23 的后续评论直通给 W7"],
            ["10:41", "官网 幕僚长", "PR #88 CI 绿，等人确认合并"],
            ["10:20", "路由", "企微消息归入已有话题 codi#5，没开新工单"],
            ["09:58", "移动端 幕僚长", "mac-mini-2 离线，app#41 挂起"],
          ].map(([t, who, what]) => (
            <li key={t} className="flex gap-3 px-4 py-2">
              <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">{t}</span>
              <span className="w-28 shrink-0 font-medium">{who}</span>
              <span className="text-muted-foreground">{what}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const COLUMNS: ReadonlyArray<TaskStatus> = ["todo", "doing", "review", "done"];

function TaskRow({ task }: { task: LighthouseTask }) {
  const [open, setOpen] = useState(task.status !== "done");
  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setOpen(!open)}>
        <TableCell>
          <span className="flex items-center gap-2">
            {open ? (
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-3.5 text-muted-foreground" />
            )}
            <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
            <span className="font-medium">{task.title}</span>
          </span>
        </TableCell>
        <TableCell>
          <StatusBadge status={task.status} />
        </TableCell>
        <TableCell>
          <span className="text-muted-foreground">{PROJECT_NAME[task.project]}</span>
        </TableCell>
        <TableCell>
          <span className="text-muted-foreground">{task.owner}</span>
        </TableCell>
        <TableCell>
          <span className="text-muted-foreground tabular-nums">
            {task.tickets.filter((t) => t.state === "merged").length}/{task.tickets.length}
          </span>
        </TableCell>
        <TableCell>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <ClockIcon className="size-3.5" /> {task.due}
          </span>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={6}>
            <div className="flex flex-wrap gap-2 ps-6">
              {task.tickets.map((t) => (
                <TicketChip key={t.id} ticket={t} />
              ))}
              <Button size="xs" variant="ghost-muted">
                <PlusIcon /> 加工单
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export function TasksPage({ viewer }: { viewer: LighthouseViewer }) {
  const v = VIEWERS[viewer];
  const [mode, setMode] = useState<"table" | "board">("table");
  const tasks = TASKS.filter((t) => v.projects.includes(t.project));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">任务</h2>
          <p className="text-sm text-muted-foreground">
            一个任务对应若干工单（GitHub / GitLab issue）。你改任务，幕僚长去动工单和 Worker。
          </p>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center rounded-md border p-0.5">
            <Button
              size="xs"
              variant={mode === "table" ? "secondary" : "ghost-muted"}
              onClick={() => setMode("table")}
            >
              <Table2Icon /> 表格
            </Button>
            <Button
              size="xs"
              variant={mode === "board" ? "secondary" : "ghost-muted"}
              onClick={() => setMode("board")}
            >
              <KanbanIcon /> 看板
            </Button>
          </div>
          <Button size="xs">
            <PlusIcon /> 新任务
          </Button>
        </div>
      </div>
      {mode === "table" ? (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>任务</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>项目</TableHead>
                <TableHead>负责</TableHead>
                <TableHead>工单</TableHead>
                <TableHead>截止</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col} className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2">
              <div className="flex items-center justify-between px-1 text-xs font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", TASK_STATUS[col].tone)} />
                  {TASK_STATUS[col].label}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {tasks.filter((t) => t.status === col).length}
                </span>
              </div>
              {tasks
                .filter((t) => t.status === col)
                .map((t) => (
                  <div key={t.id} className="rounded-md border bg-card p-2.5 text-sm shadow-xs">
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {PROJECT_NAME[t.project]} · {t.owner}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {t.tickets.map((tk) => (
                        <span key={tk.id} className="rounded-sm border px-1 font-mono text-2xs">
                          {tk.id}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const COPILOT_LINE: Record<LighthouseView, string> = {
  chats: "",
  bots: "你在看 Bots。想让我重启哪个、换 harness，还是给某个项目加 Worker？",
  dashboard: "你在看看板。要我解释哪个数字，还是直接把等你定的三件事列出来？",
  tasks: "你在看任务。改状态、加工单、改派 Worker，说一句就行。",
};

export function CopilotPanel({
  viewer,
  view,
  chat,
  onChat,
}: {
  viewer: LighthouseViewer;
  view: LighthouseView;
  chat: LighthouseChatId;
  onChat: (c: LighthouseChatId) => void;
}) {
  const navigate = useNavigate();
  const chats = chatsFor(viewer);
  const current = chats.find((c) => c.id === chat) ?? chats[0]!;
  const readOnly = current.readOnly === true;
  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-s bg-sidebar/40">
      <div className="flex min-h-10 items-center gap-2 border-b px-2">
        <Select value={current.id} onValueChange={(val) => onChat(val as LighthouseChatId)}>
          <SelectTrigger className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <BotAvatar tone={current.tone} size="sm" readOnly={readOnly} />
              <SelectValue>{current.name}</SelectValue>
            </span>
          </SelectTrigger>
          <SelectPopup>
            {chats.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="全屏对话"
          onClick={() =>
            void navigate({
              to: "/prototype/lighthouse",
              search: { variant: "A", as: viewer, chat: current.id, view: "chats" },
            })
          }
        >
          <ExpandIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex gap-2">
          <BotAvatar tone={current.tone} size="sm" readOnly={readOnly} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="text-xs text-muted-foreground">{current.name}</div>
            <p className="mt-1 leading-6">
              {readOnly
                ? "我是总台，只读。能查文档、决定、成员，不派活。"
                : current.id === "mine"
                  ? COPILOT_LINE[view]
                  : `我只管 ${current.name.replace(" 幕僚长", "")} 的事。${COPILOT_LINE[view]}`}
            </p>
          </div>
        </div>
      </div>
      <div className="p-3">
        <div className="rounded-lg border bg-card p-2 shadow-composer">
          <Textarea
            rows={2}
            placeholder={readOnly ? "问总台：文档、决定、谁负责什么" : `对 ${current.name} 说…`}
          />
          <div className="flex items-center justify-end px-1 pb-1">
            <Button size="xs">
              <SendIcon /> 发送
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function WorkSubList({ view, viewer }: { view: LighthouseView; viewer: LighthouseViewer }) {
  const v = VIEWERS[viewer];
  const items =
    view === "tasks"
      ? [
          "全部任务",
          "我负责的",
          "本周到期",
          "等确认",
          ...v.projects.map((p) => `${PROJECT_NAME[p]} 的任务`),
        ]
      : view === "bots"
        ? ["全部", "常驻", "Worker", "离线"]
        : ["公司", ...v.projects.map((p) => PROJECT_NAME[p] ?? p)];
  const [active, setActive] = useState(0);
  return (
    <div className="flex flex-col gap-0.5 px-2 pt-1">
      <div className="px-2 pb-2 text-xs font-medium text-sidebar-muted-foreground">
        {view === "tasks" ? "视图" : view === "bots" ? "筛选" : "范围"}
      </div>
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
