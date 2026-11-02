// PROTOTYPE, wipe me. The Code right panel, cut down to Browser, Files and a side chat with a
// Chief of Staff. The side chat never opens the conversation already in the main pane.
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExpandIcon,
  FileTextIcon,
  FilesIcon,
  FolderIcon,
  Globe2Icon,
  LockIcon,
  MessagesSquareIcon,
  PlusIcon,
  RotateCwIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { ChatComposerCard, ChatTimeline } from "./LighthouseChat";
import { BotAvatar } from "./LighthouseChatList";
import {
  PROJECTS,
  VIEWERS,
  chatsFor,
  type LighthouseView,
  type LighthouseViewer,
} from "./lighthouseData";
import { PreviewPanelShell } from "../preview/PreviewPanelShell";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { PanelTabCloseButton } from "../ui/panel-tab-close-button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

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
  { kind: "browser", label: "Browser", icon: Globe2Icon },
  { kind: "files", label: "Files", icon: FilesIcon },
  { kind: "sidechat", label: "Side chat", icon: MessagesSquareIcon },
] as const;

const OPENING_LINE: Record<LighthouseView, string> = {
  chats: "要我先看哪件？",
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

function SideChatSurface({
  viewer,
  workspace,
  view,
  mainChat,
  onExpand,
}: {
  viewer: LighthouseViewer;
  workspace: string;
  view: LighthouseView;
  mainChat: string | null;
  onExpand: (chat: string) => void;
}) {
  const choices = chatsFor(viewer, workspace).filter((c) => c.id !== mainChat);
  const [picked, setPicked] = useState<string | null>(null);
  const current = choices.find((c) => c.id === picked) ?? choices[0];
  if (!current) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-1 px-2 pb-2">
        <div className="w-52 min-w-0">
          <Select value={current.id} onValueChange={(val) => setPicked(String(val))}>
            <SelectTrigger size="sm">
              <SelectValue>
                <span className="flex items-center gap-2">
                  <BotAvatar tone={current.tone} size="xs" readOnly={current.readOnly === true} />
                  {current.name}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {choices.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    <BotAvatar tone={c.tone} size="xs" readOnly={c.readOnly === true} />
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="在主窗口打开"
          onClick={() => onExpand(current.id)}
        >
          <ExpandIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <ChatTimeline
          messages={[
            {
              id: "a1",
              role: "assistant",
              author: current.name,
              body: current.readOnly === true ? "要查哪份文档？" : OPENING_LINE[view],
            },
          ]}
        />
      </div>
      <div className="p-3">
        <ChatComposerCard placeholder={`对 ${current.name} 说`} />
      </div>
    </div>
  );
}

export function LighthousePanel({
  viewer,
  workspace,
  view,
  mainChat,
  onExpand,
}: {
  viewer: LighthouseViewer;
  workspace: string;
  view: LighthouseView;
  mainChat: string | null;
  onExpand: (chat: string) => void;
}) {
  const first: Surface =
    view === "chats" ? { id: "files", kind: "files" } : { id: "sidechat", kind: "sidechat" };
  const [surfaces, setSurfaces] = useState<ReadonlyArray<Surface>>([first]);
  const [activeId, setActiveId] = useState<string | null>(first.id);
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
  const launch = (kind: Surface["kind"] & (typeof LAUNCH)[number]["kind"]) =>
    open({ id: kind, kind });

  return (
    <PreviewPanelShell
      mode="inline"
      widthStorageKey="lighthouse-prototype-panel"
      defaultWidth={400}
    >
      <div className="flex h-(--workspace-topbar-height) min-h-(--workspace-topbar-height) shrink-0 items-center gap-1 pr-3 pl-2">
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
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {active === null ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-(--workspace-topbar-height)">
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
            viewer={viewer}
            workspace={workspace}
            view={view}
            mainChat={mainChat}
            onExpand={onExpand}
          />
        ) : null}
      </div>
    </PreviewPanelShell>
  );
}
