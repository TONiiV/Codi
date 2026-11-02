// PROTOTYPE, wipe me. The Code right panel, cut down to Browser, Files and a side chat with the
// Chief of Staff or a project Chief Agent. The side chat never opens the conversation already in the main pane.
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  FilesIcon,
  FolderIcon,
  Globe2Icon,
  ListChecksIcon,
  LockIcon,
  MessagesSquareIcon,
  PlusIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { ChatComposerCard, ChatTimeline, type ChatMessage } from "./LighthouseChat";
import {
  createTask,
  createTicket,
  createWorker,
  findTask,
  useRegistryVersion,
  useSideChatRequest,
  type Kickoff,
} from "./lighthouseActions";
import { BotAvatar } from "./LighthouseChatList";
import {
  PROJECTS,
  VIEWERS,
  TASK_STATUS,
  chatsFor,
  type LighthouseTask,
  type LighthouseChat,
  type LighthouseView,
  type LighthouseViewer,
} from "./lighthouseData";
import { PreviewPanelShell } from "../preview/PreviewPanelShell";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import { PanelTabCloseButton } from "../ui/panel-tab-close-button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { PanelLayoutControls, RightPanelMaximizeControl } from "../chat/PanelLayoutControls";

const DOCS = [
  { workspace: "toniiv", level: "public", kind: "制度", title: "远程协作约定（第 3 版）" },
  { workspace: "toniiv", level: "public", kind: "周报", title: "本周周报" },
  { workspace: "toniiv", level: "team", kind: "OKR", title: "Q4 Lighthouse v1 上线" },
  { workspace: "toniiv", level: "confidential", kind: "财务", title: "11 月模型与算力账单" },
  { workspace: "dimx", level: "public", kind: "周报", title: "机器人方向周报" },
  { workspace: "dimx", level: "team", kind: "方案", title: "灵巧手触觉 PoC 技术路线" },
  { workspace: "dimx", level: "confidential", kind: "合同", title: "太湖杯比赛合作协议" },
] as const;

const PREVIEW = {
  toniiv: { url: "github.com/TONiiV/codi-site/pull/88", project: "site", title: "价格页修复" },
  dimx: { url: "github.com/DimensionX/gripper/pull/12", project: "gripper", title: "单指触觉标定" },
} as const;

type Surface =
  | { id: string; kind: "browser" }
  | { id: string; kind: "files" }
  | { id: string; kind: "sidechat" }
  | { id: string; kind: "file"; title: string; folder: string; locked: boolean };

const LAUNCH = [
  { kind: "browser", label: "Browser", icon: Globe2Icon, shortcut: "B" },
  { kind: "files", label: "Files", icon: FilesIcon, shortcut: "F" },
  { kind: "sidechat", label: "Side chat", icon: MessagesSquareIcon, shortcut: "S" },
] as const;

const OPENING_LINE: Record<LighthouseView, string> = {
  chats: "要我先看哪件？",
  projects: "要接入哪个项目，或者改哪位 Chief Agent 的权限？",
  bots: "要重启哪个，或者给哪个项目加 Worker？",
  dashboard: "要我解释哪个数字？",
  tasks: "改状态、加工单、改派 Worker，说一句就行。",
  decisions: "要追溯哪个决定？",
  members: "要给谁加权限？",
};

function surfaceTitle(s: Surface) {
  if (s.kind === "browser") return "Browser";
  if (s.kind === "files") return "Files";
  if (s.kind === "sidechat") return "Side chat";
  return s.title;
}

function SurfaceIcon({ surface }: { surface: Surface }) {
  if (surface.kind === "browser") return <Globe2Icon className="size-3 shrink-0" />;
  if (surface.kind === "files") return <FilesIcon className="size-3 shrink-0" />;
  if (surface.kind === "sidechat") return <MessagesSquareIcon className="size-3 shrink-0" />;
  return <FileTextIcon className="size-3 shrink-0" />;
}

function FileRow({
  depth,
  icon: Icon,
  label,
  muted,
  onClick,
}: {
  depth: 0 | 1;
  icon: typeof FileTextIcon;
  label: string;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md pe-2 text-left text-sm hover:bg-accent/60",
        depth === 0 ? "ps-2" : "ps-7",
        muted && "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function FilesSurface({
  viewer,
  workspace,
  onOpen,
}: {
  viewer: LighthouseViewer;
  workspace: string;
  onOpen: (title: string, folder: string, locked: boolean) => void;
}) {
  const v = VIEWERS[viewer];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <FileRow depth={0} icon={FolderIcon} label="文档" />
      {DOCS.filter((d) => d.workspace === workspace).map((d) => {
        const locked = !v.docs.includes(d.level);
        return (
          <FileRow
            key={d.title}
            depth={1}
            icon={locked ? LockIcon : FileTextIcon}
            label={locked ? `${d.kind}（无权限）` : `${d.kind} · ${d.title}`}
            muted={locked}
            onClick={() => onOpen(locked ? d.kind : d.title, "文档", locked)}
          />
        );
      })}
    </div>
  );
}

function FileSurface({ surface }: { surface: Extract<Surface, { kind: "file" }> }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">
      <div className="text-xs text-muted-foreground">{surface.folder}</div>
      <h2 className="mt-1 text-base font-semibold">{surface.title}</h2>
      {surface.locked ? (
        <p className="mt-4 inline-flex items-center gap-1.5 text-muted-foreground">
          <LockIcon className="size-3.5" />
          无权限
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-2 text-muted-foreground">
          <div className="h-3 w-11/12 rounded-sm bg-muted" />
          <div className="h-3 w-9/12 rounded-sm bg-muted" />
          <div className="h-3 w-10/12 rounded-sm bg-muted" />
          <div className="h-3 w-7/12 rounded-sm bg-muted" />
        </div>
      )}
    </div>
  );
}

function BrowserSurface({ workspace }: { workspace: string }) {
  const page = workspace === "dimx" ? PREVIEW.dimx : PREVIEW.toniiv;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-2">
        <Button size="icon-xs" variant="ghost-muted" aria-label="Back">
          <ChevronLeftIcon />
        </Button>
        <Button size="icon-xs" variant="ghost-muted" aria-label="Forward">
          <ChevronRightIcon />
        </Button>
        <Button size="icon-xs" variant="ghost-muted" aria-label="Reload">
          <RotateCwIcon />
        </Button>
        <div className="flex h-7 min-w-0 flex-1 items-center rounded-md bg-muted/60 px-2.5 text-xs text-muted-foreground">
          <span className="truncate">{page.url}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-card px-5 py-4 text-sm">
        <div className="text-xs text-muted-foreground">{PROJECTS[page.project]?.name}</div>
        <h2 className="mt-1 text-base font-semibold">{page.title}</h2>
        <div className="mt-2 flex gap-2">
          <Badge variant="success">Open</Badge>
          <Badge variant="outline">CI 通过</Badge>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <div className="h-3 w-10/12 rounded-sm bg-muted" />
          <div className="h-3 w-8/12 rounded-sm bg-muted" />
          <div className="h-24 w-full rounded-md bg-muted/60" />
        </div>
      </div>
    </div>
  );
}

const PICKER_LIMIT = 5;

function CosPicker({
  choices,
  current,
  onPick,
}: {
  choices: ReadonlyArray<LighthouseChat>;
  current: LighthouseChat;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchable = choices.length > PICKER_LIMIT;
  const shown = choices
    .filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, PICKER_LIMIT);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm hover:bg-accent/60"
          />
        }
      >
        <BotAvatar seed={current.name} size="xs" />
        <span className="truncate font-medium">{current.name}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPopup align="start" padding="compact" width="sm">
        {searchable ? (
          <Input
            nativeInput
            size="compact"
            autoFocus
            placeholder="搜索 agent"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        ) : null}
        <div className={cn("flex flex-col gap-0.5", searchable && "mt-2")}>
          {shown.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onPick(c.id);
                setOpen(false);
                setQuery("");
              }}
              className={cn(
                "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent/60",
                c.id === current.id && "bg-accent",
              )}
            >
              <BotAvatar seed={c.name} size="xs" />
              <span className="min-w-0 truncate">{c.name}</span>
            </button>
          ))}
          {shown.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">没有匹配</div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

type ActionId = "nudge" | "ticket" | "worker" | "task";

const ACTIONS: ReadonlyArray<{ id: ActionId; label: string }> = [
  { id: "nudge", label: "催进度" },
  { id: "ticket", label: "开工单" },
  { id: "worker", label: "派 Worker" },
  { id: "task", label: "拆成新任务" },
];

function Created({ kind, id, text, by }: { kind: string; id: string; text: string; by: string }) {
  return (
    <div className="mt-2 flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="success">已创建</Badge>
        <span className="text-muted-foreground">{kind}</span>
        <span className="font-mono">{id}</span>
      </div>
      <div className="text-sm">{text}</div>
      <div className="text-xs text-muted-foreground">以 {by} 的权限执行</div>
    </div>
  );
}

function taskSummary(task: LighthouseTask) {
  const status = TASK_STATUS[task.status].label;
  const open = task.tickets.filter((t) => t.state !== "merged");
  const parts = open.map((t) =>
    t.state === "pr"
      ? `${t.id} PR 等合并`
      : t.worker
        ? `${t.id} ${t.worker} 在做`
        : `${t.id} 没人接`,
  );
  return `${task.id}「${task.title}」${status}。${parts.length > 0 ? parts.join("，") + "。" : "还没有工单。"}要我推进哪一步？`;
}

const chatsAt = (viewer: LighthouseViewer, workspace: string, _version: number) =>
  chatsFor(viewer, workspace);

function SideChatSurface({
  viewer,
  workspace,
  view,
  mainChat,
  picked,
  onPick,
  taskId,
  kickoff,
  onClearTask,
}: {
  viewer: LighthouseViewer;
  workspace: string;
  view: LighthouseView;
  mainChat: string | null;
  picked: string | null;
  onPick: (id: string) => void;
  taskId: string | null;
  kickoff: Kickoff | null;
  onClearTask: () => void;
}) {
  const choices = chatsAt(viewer, workspace, useRegistryVersion()).filter((c) => c.id !== mainChat);
  const current = choices.find((c) => c.id === picked) ?? choices[0];
  const task = taskId ? findTask(taskId) : undefined;
  const [log, setLog] = useState<ReadonlyArray<ChatMessage>>([]);
  const [summary] = useState(() => (task ? taskSummary(task) : null));
  const scroller = useRef<HTMLDivElement>(null);
  if (!current) return null;
  const by = VIEWERS[viewer].name;

  const act = (id: ActionId) => {
    if (!task) return;
    const label = ACTIONS.find((a) => a.id === id)!.label;
    const ask: ChatMessage = { id: `u${log.length}`, role: "user", body: label };
    let body: ReactNode;
    if (id === "nudge") {
      const waiting = task.tickets.filter((t) => t.state !== "merged" && t.worker);
      body =
        waiting.length > 0
          ? `已在 ${waiting.map((t) => `${t.worker}（${t.id}）`).join("、")} 的线程里追问，有回复就告诉你。`
          : "这个任务还没有 Worker 在跑，要不要我开工单再派人？";
    } else if (id === "ticket") {
      const ticket = createTicket(task, `跟进 ${task.title}`);
      body = (
        <>
          开好了，挂在 {task.id} 下面。
          <Created kind="工单" id={ticket.id} text={ticket.title} by={by} />
        </>
      );
    } else if (id === "worker") {
      const fresh = findTask(task.id)!;
      const ticket =
        fresh.tickets.find((t) => t.state === "open" && !t.worker) ??
        createTicket(task, `跟进 ${task.title}`);
      const worker = createWorker(task, ticket);
      body = (
        <>
          派好了，{worker.id} 接 {ticket.id}。
          <Created
            kind="Worker"
            id={worker.id}
            text={`${worker.harness} · ${worker.where}`}
            by={by}
          />
        </>
      );
    } else {
      const next = createTask(task, `${task.title} · 后续`);
      body = (
        <>
          拆出来了，先放在待开始。
          <Created kind="任务" id={next.id} text={next.title} by={by} />
        </>
      );
    }
    setLog([...log, ask, { id: `a${log.length}`, role: "assistant", author: current.name, body }]);
  };

  const opening: ChatMessage = {
    id: "a-open",
    role: "assistant",
    author: current.name,
    body: summary ? summary : current.readOnly === true ? "要查哪份文档？" : OPENING_LINE[view],
  };

  const started: ReadonlyArray<ChatMessage> =
    task && kickoff
      ? [
          { id: "u-start", role: "user", body: `把 ${task.id} 拖到了进行中` },
          {
            id: "a-start",
            role: "assistant",
            author: current.name,
            body: kickoff.fresh ? (
              <>
                开干。{kickoff.worker} 接 {kickoff.ticket.id}，开工后我会盯着，有 PR
                或卡住就告诉你。
                <Created
                  kind="Worker"
                  id={kickoff.worker}
                  text={`${kickoff.ticket.id} · ${kickoff.ticket.title}`}
                  by={by}
                />
              </>
            ) : (
              `已经有人在做：在 ${kickoff.worker}（${kickoff.ticket.id}）的线程里催了一下，有回复就告诉你。`
            ),
          },
        ]
      : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center px-2 pb-2">
        <CosPicker choices={choices} current={current} onPick={onPick} />
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <ChatTimeline messages={[...(started.length > 0 ? started : [opening]), ...log]} />
      </div>
      <div className="flex flex-col gap-2 p-3">
        {task ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
              <ListChecksIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="font-mono">{task.id}</span>
              <span className="truncate">{task.title}</span>
              <button
                type="button"
                aria-label="移除任务"
                onClick={onClearTask}
                className="cursor-pointer rounded-sm text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </span>
            {ACTIONS.map((a) => (
              <Button key={a.id} size="xs" variant="outline" onClick={() => act(a.id)}>
                {a.label}
              </Button>
            ))}
          </div>
        ) : null}
        <ChatComposerCard placeholder={`对 ${current.name} 说`} />
      </div>
    </div>
  );
}

const noop = () => {};

/** The main column plus the Code-style right panel and its top-right layout controls. */
export function LighthousePanel({
  viewer,
  workspace,
  view,
  mainChat,
  children,
}: {
  viewer: LighthouseViewer;
  workspace: string;
  view: LighthouseView;
  mainChat: string | null;
  children: ReactNode;
}) {
  const first: Surface =
    view === "chats" ? { id: "files", kind: "files" } : { id: "sidechat", kind: "sidechat" };
  const [surfaces, setSurfaces] = useState<ReadonlyArray<Surface>>([first]);
  const [activeId, setActiveId] = useState<string | null>(first.id);
  const [panelOpen, setPanelOpen] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [kickoff, setKickoff] = useState<Kickoff | null>(null);
  const request = useSideChatRequest();
  const [seenRequest, setSeenRequest] = useState(request?.seq ?? 0);
  // A task sent from the tracker opens the side chat on its agent, once per request.
  if (request && request.seq !== seenRequest) {
    setSeenRequest(request.seq);
    setPicked(request.chat);
    setTaskId(request.task);
    setKickoff(request.kickoff ?? null);
    setPanelOpen(true);
    if (!surfaces.some((x) => x.kind === "sidechat")) {
      setSurfaces([...surfaces, { id: "sidechat", kind: "sidechat" }]);
    }
    setActiveId("sidechat");
  }
  const active = surfaces.find((s) => s.id === activeId) ?? null;

  const open = (surface: Surface) => {
    if (!surfaces.some((s) => s.id === surface.id)) setSurfaces([...surfaces, surface]);
    setActiveId(surface.id);
  };
  const close = (surface: Surface) => {
    const index = surfaces.findIndex((s) => s.id === surface.id);
    const next = surfaces.filter((s) => s.id !== surface.id);
    setSurfaces(next);
    if (activeId === surface.id) setActiveId(next[Math.max(0, index - 1)]?.id ?? null);
  };
  const launch = (kind: (typeof LAUNCH)[number]["kind"]) => open({ id: kind, kind });
  const onLauncherKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const hit = LAUNCH.find((a) => a.shortcut.toLowerCase() === event.key.toLowerCase());
    if (!hit || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    launch(hit.kind);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className={cn("flex min-w-0 flex-1 flex-col", panelOpen && maximized && "hidden")}>
        {children}
      </div>
      <PreviewPanelShell
        mode="inline"
        open={panelOpen}
        maximized={panelOpen && maximized}
        widthStorageKey="lighthouse-prototype-panel"
        defaultWidth={420}
      >
        <div className="flex h-(--workspace-topbar-height) min-h-(--workspace-topbar-height) shrink-0 items-center gap-1 pr-28 pl-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {surfaces.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "group/tab flex h-6 max-w-36 shrink-0 cursor-pointer items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
                  s.id === activeId
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <PanelTabCloseButton label={`Close ${surfaceTitle(s)}`} onClick={() => close(s)}>
                  <SurfaceIcon surface={s} />
                </PanelTabCloseButton>
                <button
                  type="button"
                  className="flex min-w-0 cursor-pointer items-center"
                  onClick={() => setActiveId(s.id)}
                >
                  <span className="truncate">{surfaceTitle(s)}</span>
                </button>
              </div>
            ))}
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label="Add panel surface"
                    className="shrink-0"
                    size="icon-xs"
                    variant="ghost-muted"
                  />
                }
              >
                <PlusIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="start" side="bottom" sideOffset={6}>
                {LAUNCH.map((a) => (
                  <MenuItem key={a.kind} onClick={() => launch(a.kind)}>
                    <a.icon />
                    {a.label}
                    <MenuShortcut>{a.shortcut}</MenuShortcut>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {active === null ? (
            <div
              tabIndex={0}
              onKeyDown={onLauncherKey}
              aria-label="Open a surface"
              className="flex min-h-0 flex-1 items-center justify-center px-6 pb-(--workspace-topbar-height) outline-none"
            >
              <div className="w-full max-w-xs py-6">
                <h3 className="mb-3 text-center text-sm font-medium text-foreground">
                  Open a surface
                </h3>
                <div className="flex flex-col gap-0.5">
                  {LAUNCH.map((a) => (
                    <button
                      key={a.kind}
                      type="button"
                      onClick={() => launch(a.kind)}
                      className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm transition-colors hover:bg-accent/60"
                    >
                      <a.icon className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{a.label}</span>
                      <Kbd>{a.shortcut}</Kbd>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {active?.kind === "files" ? (
            <FilesSurface
              viewer={viewer}
              workspace={workspace}
              onOpen={(title, folder, locked) =>
                open({ id: `file:${title}`, kind: "file", title, folder, locked })
              }
            />
          ) : null}
          {active?.kind === "file" ? <FileSurface surface={active} /> : null}
          {active?.kind === "browser" ? <BrowserSurface workspace={workspace} /> : null}
          {active?.kind === "sidechat" ? (
            <SideChatSurface
              key={`${picked ?? ""}:${taskId ?? ""}:${seenRequest}`}
              viewer={viewer}
              workspace={workspace}
              view={view}
              mainChat={mainChat}
              picked={picked}
              onPick={setPicked}
              taskId={taskId}
              kickoff={kickoff}
              onClearTask={() => {
                setTaskId(null);
                setKickoff(null);
              }}
            />
          ) : null}
        </div>
      </PreviewPanelShell>
      <div className="fixed top-(--workspace-controls-top) right-(--workspace-controls-right) z-50 flex h-(--workspace-topbar-height) items-center gap-1">
        {panelOpen ? (
          <RightPanelMaximizeControl
            maximized={maximized}
            onToggle={() => setMaximized(!maximized)}
          />
        ) : null}
        <PanelLayoutControls
          showThreadPanelControl={false}
          showTerminalControl={false}
          terminalAvailable={false}
          terminalOpen={false}
          terminalShortcutLabel={null}
          threadPanelOpen={false}
          threadPanelPresentation="inline"
          threadPanelShortcutLabel={null}
          rightPanelAvailable
          rightPanelOpen={panelOpen}
          rightPanelShortcutLabel={null}
          onToggleTerminal={noop}
          onToggleThreadPanel={noop}
          onToggleRightPanel={() => setPanelOpen(!panelOpen)}
        />
      </div>
    </div>
  );
}
