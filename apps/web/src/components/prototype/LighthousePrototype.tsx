// PROTOTYPE, wipe me. The Lighthouse mode inside the real Codi shell at /prototype/lighthouse.
// Everything is scoped to the current workspace and filtered by the viewer's permissions. The
// user talks only to a Chief of Staff; Workers, tickets and PRs are links. Mock data only.
import { LockIcon, MessageSquareIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { BotAvatar } from "./LighthouseChatList";
import { LighthousePanel } from "./LighthousePanel";
import { ChatComposerCard, ChatTimeline, type ChatMessage } from "./LighthouseChat";
import {
  ASKS,
  PROJECT_COS,
  PROJECTS,
  VIEWERS,
  WORKERS,
  WORKSPACES,
  projectsIn,
  type LighthouseViewer,
} from "./lighthouseData";
import { normalizeLighthouseSearch, useLighthouseSearch } from "./lighthouseLocation";
import { RAIL_ITEMS } from "./LighthouseRail";
import { TasksPage } from "./LighthouseTasks";
import { BotsPage, DashboardPage } from "./LighthouseWork";
import { DecisionsPage } from "./LighthouseDecisions";
import { useWorkspaceId } from "./workspaceStore";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";

function ToneDot({ tone }: { tone: "ok" | "warn" | "bad" }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        tone === "ok" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-destructive",
      )}
    />
  );
}

function ThreadLink({ worker }: { worker: string }) {
  const w = WORKERS.find((x) => x.id === worker);
  return (
    <a
      href="#"
      onClick={(e) => e.preventDefault()}
      className="inline-flex items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline"
    >
      <MessageSquareIcon className="size-3.5" />
      {worker}
      {w ? <span className="text-muted-foreground">· {w.ticket}</span> : null}
    </a>
  );
}

function Locked({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <LockIcon className="size-3.5" />
      {children}
    </span>
  );
}

function asksFor(viewer: LighthouseViewer, workspace: string, project?: string) {
  const open = projectsIn(workspace, viewer).open;
  return ASKS.filter(
    (a) =>
      a.for.includes(viewer) &&
      open.includes(a.project) &&
      (project === undefined || a.project === project),
  );
}

function Inbox({ asks }: { asks: ReturnType<typeof asksFor> }) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  if (asks.length === 0) return null;
  return (
    <ul className="flex flex-col gap-4">
      {asks.map((a) => (
        <li key={a.text} className="flex gap-3">
          <span className="mt-1.5">
            <ToneDot tone={a.kind === "merge" ? "ok" : "warn"} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">
              {PROJECTS[a.project]?.name} · <ThreadLink worker={a.thread} />
            </div>
            <div className="mt-0.5 text-sm">{a.text}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {done.has(a.text) ? (
                <Badge variant="secondary">已处理</Badge>
              ) : (
                <>
                  <Button size="xs" onClick={() => setDone(new Set([...done, a.text]))}>
                    {a.kind === "merge" ? "合并" : "回答"}
                  </Button>
                  <Button size="xs" variant="outline">
                    {a.kind === "merge" ? "先看 diff" : "让幕僚长定"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ProjectRows({
  viewer,
  workspace,
  only,
}: {
  viewer: LighthouseViewer;
  workspace: string;
  only?: string;
}) {
  const { all, open } = projectsIn(workspace, viewer);
  const ids = only ? [only] : all;
  return (
    <ul className="flex flex-col gap-4">
      {ids.map((id) => {
        const p = PROJECTS[id]!;
        return (
          <li key={id} className="text-sm">
            {open.includes(id) ? (
              <div className="flex items-start gap-3">
                <span className="mt-1.5">
                  <ToneDot tone={p.tone} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="ms-2 text-xs text-muted-foreground">{p.lead}</span>
                  <div className="text-muted-foreground">{p.line}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
                    {WORKERS.filter((w) => w.project === id).map((w) => (
                      <ThreadLink key={w.id} worker={w.id} />
                    ))}
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <PullRequestGlyph.pullRequest className="size-3.5" />
                      {p.pr}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <Locked>{p.name}</Locked>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DeskPage({ viewer, workspace }: { viewer: LighthouseViewer; workspace: string }) {
  const all = asksFor("admin", workspace).filter((a) =>
    projectsIn(workspace, viewer).open.includes(a.project),
  );
  return (
    <div className="flex flex-col gap-6">
      <ProjectRows viewer={viewer} workspace={workspace} />
      {all.length > 0 ? (
        <ul className="flex flex-col gap-3 text-sm">
          {all.map((a) => (
            <li key={a.text}>
              <div className="text-xs text-muted-foreground">
                {PROJECTS[a.project]?.name} · {a.thread}
              </div>
              {a.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function conversation(
  viewer: LighthouseViewer,
  workspace: string,
  chat: string,
): ReadonlyArray<ChatMessage> {
  const v = VIEWERS[viewer];
  const { open, locked } = projectsIn(workspace, viewer);
  if (chat !== "mine") {
    const p = PROJECTS[chat];
    const cos = PROJECT_COS[chat]?.name ?? chat;
    if (!p) return [];
    return [
      { id: "a1", role: "assistant", author: cos, body: p.line },
      { id: "u1", role: "user", body: "什么时候能合？" },
      {
        id: "a2",
        role: "assistant",
        author: cos,
        body: (
          <div className="flex flex-col gap-2">
            <span>{p.pr}。Worker 状态：</span>
            <ProjectRows viewer={viewer} workspace={workspace} only={chat} />
          </div>
        ),
      },
    ];
  }
  const asks = asksFor(viewer, workspace);
  return [
    {
      id: "a1",
      role: "assistant",
      author: v.cos.name,
      body:
        asks.length > 0
          ? `早。${asks.length} 件事等你定，按紧急排在上面。`
          : "早。今天没有要你定的事。",
    },
    { id: "u1", role: "user", body: "今天什么情况？" },
    {
      id: "a2",
      role: "assistant",
      author: v.cos.name,
      body: (
        <div className="flex flex-col gap-2">
          <span>
            {open.length} 个项目在跑
            {locked.length > 0 ? `，${locked.length} 个你没有权限` : ""}。
          </span>
          <ProjectRows viewer={viewer} workspace={workspace} />
        </div>
      ),
    },
  ];
}

function ChatPage({
  viewer,
  workspace,
  chat,
}: {
  viewer: LighthouseViewer;
  workspace: string;
  chat: string;
}) {
  const v = VIEWERS[viewer];
  const asks = asksFor(viewer, workspace, chat === "mine" ? undefined : chat);
  const cosName = chat === "mine" ? v.cos.name : (PROJECT_COS[chat]?.name ?? chat);
  const tone = chat === "mine" ? "bg-foreground" : (PROJECT_COS[chat]?.tone ?? "bg-foreground");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
        <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 py-6">
          {asks.length > 0 ? (
            <div className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                需要你定
                <Badge variant="secondary">{asks.length}</Badge>
              </h2>
              <Inbox asks={asks} />
            </div>
          ) : null}
          <ChatTimeline messages={conversation(viewer, workspace, chat)} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 pb-4">
        <ChatComposerCard
          placeholder={`对 ${cosName} 说`}
          label={
            <span className="inline-flex items-center gap-1.5">
              <BotAvatar tone={tone} size="xs" />
              {cosName}
            </span>
          }
        />
      </div>
    </div>
  );
}

function MembersPage({ workspace }: { workspace: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">成员与授权</h2>
      <ul className="divide-y text-sm">
        {(Object.keys(VIEWERS) as Array<LighthouseViewer>).map((k) => {
          const open = projectsIn(workspace, k).open;
          return (
            <li key={k} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                  {VIEWERS[k].name[0]}
                </span>
                <span className="font-medium">{VIEWERS[k].name}</span>
                <Badge variant="outline">{VIEWERS[k].title}</Badge>
              </span>
              <span className="text-xs text-muted-foreground">
                {open.length > 0 ? open.map((id) => PROJECTS[id]!.name).join("、") : "无项目"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LighthousePrototypePage({ background }: { background?: boolean }) {
  const search = useLighthouseSearch() ?? normalizeLighthouseSearch({});
  const workspace = useWorkspaceId();
  const workspaceName = WORKSPACES.find((w) => w.id === workspace)?.name ?? workspace;
  const { as: viewer, view } = search;
  const v = VIEWERS[viewer];
  const openProjects = projectsIn(workspace, viewer).open;
  // A project chat from another workspace falls back to the personal Chief of Staff.
  const chat =
    search.chat === "mine" || search.chat === "desk" || openProjects.includes(search.chat)
      ? search.chat
      : "mine";
  const chatName =
    chat === "mine" ? v.cos.name : chat === "desk" ? "总台" : (PROJECT_COS[chat]?.name ?? chat);
  const viewLabel =
    view === "members" ? "成员与授权" : (RAIL_ITEMS.find((r) => r.id === view)?.label ?? view);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none" inert={background}>
      <LighthousePanel
        key={view}
        viewer={viewer}
        workspace={workspace}
        view={view}
        mainChat={view === "chats" ? chat : null}
      >
        <header className="flex h-(--workspace-topbar-height) min-h-(--workspace-topbar-height) shrink-0 items-center pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)">
          <WorkspaceBreadcrumb ariaLabel="Lighthouse breadcrumb" className="min-w-0">
            <WorkspaceBreadcrumbItem>
              <span>{workspaceName}</span>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current>
              <h1>{view === "chats" ? chatName : viewLabel}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          {view === "chats" && chat === "desk" ? (
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
              <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 py-6">
                <DeskPage viewer={viewer} workspace={workspace} />
              </div>
            </div>
          ) : null}
          {view === "chats" && chat !== "desk" ? (
            <ChatPage
              key={viewer + chat + workspace}
              viewer={viewer}
              workspace={workspace}
              chat={chat}
            />
          ) : null}
          {view !== "chats" ? (
            <div className="flex min-h-0 flex-1">
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
                <div
                  className={cn(
                    "w-full py-6",
                    view === "tasks"
                      ? "px-8 pt-10"
                      : view === "decisions"
                        ? "mx-auto max-w-3xl px-5 pt-10"
                        : "mx-auto max-w-5xl px-5",
                  )}
                >
                  {view === "bots" ? <BotsPage viewer={viewer} workspace={workspace} /> : null}
                  {view === "dashboard" ? (
                    <DashboardPage viewer={viewer} workspace={workspace} />
                  ) : null}
                  {view === "tasks" ? (
                    <TasksPage key={viewer + workspace} viewer={viewer} workspace={workspace} />
                  ) : null}
                  {view === "members" ? <MembersPage workspace={workspace} /> : null}
                  {view === "decisions" ? (
                    <DecisionsPage viewer={viewer} workspace={workspace} />
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </LighthousePanel>
    </SidebarInset>
  );
}
