// PROTOTYPE, wipe me. Notion-style task tracker: one database, several views. A task holds
// several tickets (GitHub / GitLab issues); assignees can be people or bots.
import {
  AlignLeftIcon,
  ArrowUpDownIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckBigIcon,
  CircleDotDashedIcon,
  Columns3Icon,
  FlagIcon,
  ListChecksIcon,
  ListFilterIcon,
  MessageSquarePlusIcon,
  PlusIcon,
  SearchIcon,
  ShapesIcon,
  SquareCheckBigIcon,
  SquareIcon,
  StarIcon,
  TicketIcon,
  TypeIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { BotAvatar } from "./LighthouseChatList";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  TASK_TYPE,
  VIEWERS,
  projectsIn,
  type LighthouseTask,
  type LighthouseViewer,
  type TaskAssignee,
  type TaskStatus,
} from "./lighthouseData";
import { ThreadAnchor, projectName } from "./LighthouseWork";
import { openTaskInSideChat, taskAgent, useAllTasks } from "./lighthouseActions";
import { normalizeLighthouseSearch, useLighthouseSearch } from "./lighthouseLocation";
import { useWorkspaceId } from "./workspaceStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "../ui/group";

type TaskView = "all" | "status" | "mine" | "checklist" | "projects";

const VIEWS: ReadonlyArray<{ id: TaskView; label: string; icon: typeof StarIcon }> = [
  { id: "all", label: "全部任务", icon: StarIcon },
  { id: "status", label: "按状态", icon: CircleDotDashedIcon },
  { id: "mine", label: "我的任务", icon: UserIcon },
  { id: "checklist", label: "清单", icon: ListChecksIcon },
  { id: "projects", label: "按项目", icon: Columns3Icon },
];

const STATUS_ORDER: ReadonlyArray<TaskStatus> = ["todo", "doing", "review", "done"];

function Assignee({ a }: { a: TaskAssignee }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {a.kind === "bot" ? (
        <BotAvatar tone={a.tone} size="sm" readOnly={a.name === "总台"} />
      ) : (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-secondary text-2xs font-medium text-secondary-foreground">
          {a.name[0]}
        </span>
      )}
      <span className="truncate">{a.name}</span>
    </span>
  );
}

// Live states reuse the repo's stepped status animations: a ping while work runs, a pulse
// while it waits on a person.
function LiveDot({ live, className }: { live: "running" | "waiting" | null; className: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {live === "running" ? (
        <span className="absolute inline-flex size-full rounded-full bg-current opacity-75 motion-safe:animate-status-ping" />
      ) : null}
      <span
        className={cn(
          "relative inline-flex size-full rounded-full bg-current",
          live === "waiting" && "motion-safe:animate-status-pulse",
        )}
      />
    </span>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status];
  return (
    <Badge variant={s.badge} size="lg">
      <LiveDot
        className="size-1.5"
        live={status === "doing" ? "running" : status === "review" ? "waiting" : null}
      />
      {s.label}
    </Badge>
  );
}

function TicketChip({ ticket }: { ticket: LighthouseTask["tickets"][number] }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border bg-card px-1.5 py-0.5 text-xs">
      {ticket.state === "open" ? (
        <LiveDot className="size-2 text-success" live={ticket.worker ? "running" : null} />
      ) : (
        <PullRequestGlyph.pullRequest
          className={cn(
            "size-3",
            ticket.state === "merged" ? "text-muted-foreground" : "text-success",
            ticket.state === "pr" && "motion-safe:animate-status-pulse",
          )}
        />
      )}
      <span className="font-mono">{ticket.id}</span>
      <span className="text-muted-foreground">{ticket.title}</span>
      {ticket.worker ? <ThreadAnchor id={ticket.worker} /> : null}
    </span>
  );
}

const COLS: ReadonlyArray<{ label: string; icon: typeof TypeIcon; width: string }> = [
  { label: "任务", icon: TypeIcon, width: "w-[15rem]" },
  { label: "状态", icon: CircleDotDashedIcon, width: "w-[7rem]" },
  { label: "负责", icon: UsersIcon, width: "w-[13rem]" },
  { label: "截止", icon: CalendarIcon, width: "w-[7rem]" },
  { label: "优先级", icon: FlagIcon, width: "w-[5rem]" },
  { label: "类型", icon: ShapesIcon, width: "w-[5.5rem]" },
  { label: "工单", icon: TicketIcon, width: "w-[5rem]" },
  { label: "说明", icon: AlignLeftIcon, width: "w-[16rem]" },
];

function Cell({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn("h-10 border-e border-b px-2 align-middle last:border-e-0", className)}>
      {children}
    </td>
  );
}

function SideChatButton({ task }: { task: LighthouseTask }) {
  const search = useLighthouseSearch() ?? normalizeLighthouseSearch({});
  const workspace = useWorkspaceId();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`把 ${task.id} 加到 Side chat`}
            onClick={() => openTaskInSideChat(taskAgent(task, search.as, workspace), task.id)}
            className="hidden size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground group-hover:inline-flex hover:bg-accent hover:text-foreground focus-visible:inline-flex"
          />
        }
      >
        <MessageSquarePlusIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup>加到 Side chat，和负责的幕僚长推进</TooltipPopup>
    </Tooltip>
  );
}

function TaskRow({ task }: { task: LighthouseTask }) {
  const [open, setOpen] = useState(false);
  const merged = task.tickets.filter((t) => t.state === "merged").length;
  return (
    <>
      <tr className="group hover:bg-accent/40">
        <Cell>
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{task.title}</span>
            <span className="ms-auto hidden shrink-0 font-mono text-2xs text-muted-foreground group-hover:inline">
              {task.id}
            </span>
            <SideChatButton task={task} />
          </span>
        </Cell>
        <Cell>
          <StatusPill status={task.status} />
        </Cell>
        <Cell>
          <span className="flex min-w-0 items-center gap-3 overflow-hidden">
            {task.assignees.map((a) => (
              <Assignee key={a.name} a={a} />
            ))}
          </span>
        </Cell>
        <Cell className="text-muted-foreground tabular-nums">{task.due ?? ""}</Cell>
        <Cell>
          {task.priority ? (
            <Badge variant={TASK_PRIORITY[task.priority].badge} size="lg">
              {TASK_PRIORITY[task.priority].label}
            </Badge>
          ) : null}
        </Cell>
        <Cell>
          {task.type ? (
            <Badge variant={TASK_TYPE[task.type].badge} size="lg">
              {TASK_TYPE[task.type].label}
            </Badge>
          ) : null}
        </Cell>
        <Cell>
          {task.tickets.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="inline-flex items-center gap-1 rounded-sm px-1 text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground"
            >
              {open ? (
                <ChevronDownIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
              {merged}/{task.tickets.length}
            </button>
          ) : null}
        </Cell>
        <Cell>
          <span className="block max-w-[16rem] truncate text-muted-foreground">
            {task.description ?? ""}
          </span>
        </Cell>
      </tr>
      {open ? (
        <tr>
          <td colSpan={COLS.length} className="border-b bg-muted/30 px-2 py-2">
            <div className="flex flex-wrap items-center gap-2 ps-4">
              {task.tickets.map((t) => (
                <TicketChip key={t.id} ticket={t} />
              ))}
              <Button size="xs" variant="ghost-muted">
                <PlusIcon /> 加工单
              </Button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Database({
  groups,
}: {
  groups: ReadonlyArray<{ key: string; head?: ReactNode; tasks: ReadonlyArray<LighthouseTask> }>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-max min-w-full border-collapse text-sm">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c.label}
                className={cn(
                  "h-9 border-e border-b px-2 text-start font-normal text-muted-foreground last:border-e-0",
                  c.width,
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <c.icon className="size-3.5" />
                  {c.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              {g.head ? (
                <tr>
                  <td colSpan={COLS.length} className="px-1 pt-5 pb-2">
                    {g.head}
                  </td>
                </tr>
              ) : null}
              {g.tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
              <tr>
                <td colSpan={COLS.length} className="border-b">
                  <button
                    type="button"
                    className="flex h-9 w-full items-center gap-1.5 px-2 text-muted-foreground hover:bg-accent/40"
                  >
                    <PlusIcon className="size-3.5" /> 新任务
                  </button>
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Checklist({ tasks }: { tasks: ReadonlyArray<LighthouseTask> }) {
  return (
    <ul className="flex max-w-2xl flex-col">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-2.5 border-b py-2 text-sm">
          {t.status === "done" ? (
            <SquareCheckBigIcon className="size-4 text-primary" />
          ) : (
            <SquareIcon className="size-4 text-muted-foreground" />
          )}
          <span className={cn(t.status === "done" && "text-muted-foreground line-through")}>
            {t.title}
          </span>
          <span className="ms-auto text-xs text-muted-foreground tabular-nums">{t.due ?? ""}</span>
        </li>
      ))}
    </ul>
  );
}

function TaskCard({ task }: { task: LighthouseTask }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm shadow-xs">
      <span className="flex items-start gap-2 font-medium">
        <CircleCheckBigIcon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            task.status === "done" ? "text-success" : "text-muted-foreground",
          )}
        />
        {task.title}
      </span>
      {task.assignees.length > 0 ? (
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {task.assignees.map((a) => (
            <Assignee key={a.name} a={a} />
          ))}
        </span>
      ) : null}
      {task.priority || task.type ? (
        <span className="flex flex-wrap gap-1.5">
          {task.priority ? (
            <Badge variant={TASK_PRIORITY[task.priority].badge} size="lg">
              {TASK_PRIORITY[task.priority].label}
            </Badge>
          ) : null}
          {task.type ? (
            <Badge variant={TASK_TYPE[task.type].badge} size="lg">
              {TASK_TYPE[task.type].label}
            </Badge>
          ) : null}
        </span>
      ) : null}
      {task.tickets.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {task.tickets.map((tk) => (
            <span key={tk.id} className="rounded-sm border px-1 font-mono text-2xs">
              {tk.id}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

const STATUS_TINT: Record<TaskStatus, string> = {
  todo: "bg-muted/60",
  doing: "bg-info/8",
  review: "bg-warning/8",
  done: "bg-success/8",
};

function NewTaskButton() {
  return (
    <button
      type="button"
      className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground hover:bg-card"
    >
      <PlusIcon className="size-3.5" /> 新任务
    </button>
  );
}

/** Notion's "By Status": one kanban column per status, tinted by it. */
function StatusBoard({ tasks }: { tasks: ReadonlyArray<LighthouseTask> }) {
  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-2">
      {STATUS_ORDER.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <div
            key={s}
            className={cn("flex w-72 shrink-0 flex-col gap-2 rounded-xl p-2", STATUS_TINT[s])}
          >
            <div className="flex items-center gap-2 px-1 pt-1">
              <StatusPill status={s} />
              <span className="text-xs text-muted-foreground tabular-nums">{col.length}</span>
            </div>
            {col.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
            <NewTaskButton />
          </div>
        );
      })}
    </div>
  );
}

function ProjectBoard({
  tasks,
  projects,
}: {
  tasks: ReadonlyArray<LighthouseTask>;
  projects: ReadonlyArray<string>;
}) {
  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-2">
      {projects.map((p) => {
        const col = tasks.filter((t) => t.project === p);
        return (
          <div key={p} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/40 p-2">
            <div className="flex items-center gap-2 px-1 pt-1 text-sm">
              <span className="font-medium">{projectName(p)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{col.length}</span>
            </div>
            {col.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
            <NewTaskButton />
          </div>
        );
      })}
    </div>
  );
}

export function TasksPage({ viewer, workspace }: { viewer: LighthouseViewer; workspace: string }) {
  const v = VIEWERS[viewer];
  const [view, setView] = useState<TaskView>("all");
  const open = projectsIn(workspace, viewer).open;
  const tasks = useAllTasks().filter((t) => open.includes(t.project));
  const mine = tasks.filter((t) =>
    t.assignees.some((a) => a.name === v.name || a.name === v.cos.name),
  );
  return (
    <div className="flex flex-col">
      <h2 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
        <CircleCheckBigIcon className="size-8 text-success" />
        任务追踪
      </h2>
      <div className="mt-6 flex items-center gap-1 border-b pb-1.5">
        {VIEWS.map((x) => (
          <Button
            key={x.id}
            size="xs"
            variant={view === x.id ? "secondary" : "ghost-muted"}
            onClick={() => setView(x.id)}
          >
            <x.icon /> {x.label}
          </Button>
        ))}
        <span className="ms-auto flex items-center gap-0.5">
          <Button size="icon-xs" variant="ghost-muted" aria-label="筛选">
            <ListFilterIcon />
          </Button>
          <Button size="icon-xs" variant="ghost-muted" aria-label="排序">
            <ArrowUpDownIcon />
          </Button>
          <Button size="icon-xs" variant="ghost-muted" aria-label="搜索">
            <SearchIcon />
          </Button>
          <ButtonGroup className="ms-1">
            <Button size="xs">新建</Button>
            <ButtonGroupSeparator />
            <Button size="icon-xs" aria-label="从模板新建">
              <ChevronDownIcon />
            </Button>
          </ButtonGroup>
        </span>
      </div>
      <div className="mt-1">
        {view === "all" ? <Database groups={[{ key: "all", tasks }]} /> : null}
        {view === "mine" ? <Database groups={[{ key: "mine", tasks: mine }]} /> : null}
        {view === "status" ? (
          <div className="pt-3">
            <StatusBoard tasks={tasks} />
          </div>
        ) : null}
        {view === "checklist" ? (
          <div className="pt-3">
            <Checklist tasks={tasks} />
          </div>
        ) : null}
        {view === "projects" ? (
          <div className="pt-3">
            <ProjectBoard tasks={tasks} projects={open} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
