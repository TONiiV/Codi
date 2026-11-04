// PROTOTYPE, wipe me. The Telescope mode inside the real Codi shell at /prototype/lighthouse.
// Everything is scoped to the current workspace and filtered by the viewer's permissions. The
// user talks to their own agents (个人助理, Chief Agents, custom agents) or, in an enterprise
// workspace, to company agents; Workers, tickets and PRs are links. Mock data only.
import { LockIcon, MessageSquareIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { BotAvatar } from "./LighthouseChatList";
import { LighthousePanel } from "./LighthousePanel";
import { ChatComposerCard, ChatTimeline, type ChatMessage } from "./LighthouseChat";
import {
  ChannelFilter,
  ContextMeter,
  DraftReply,
  EmailCard,
  type ChannelFilterValue,
  type ContextLoad,
} from "./LighthouseChannels";
import { defaultHandle, type ChannelId } from "./channelStore";
import {
  ASKS,
  PROJECTS,
  VIEWERS,
  WORKERS,
  WORKSPACES,
  WORKSPACE_KIND,
  chatsFor,
  chiefName,
  companyAgent,
  customAgent,
  projectsIn,
  type LighthouseViewer,
} from "./lighthouseData";
import { normalizeLighthouseSearch, useLighthouseSearch } from "./lighthouseLocation";
import { RAIL_ITEMS } from "./LighthouseRail";
import { useRegistryVersion, useViewer } from "./lighthouseActions";
import { TasksPage } from "./LighthouseTasks";
import { DashboardPage } from "./LighthouseDashboard";
import { TeamsPage } from "./LighthouseTeams";
import { DecisionsPage } from "./LighthouseDecisions";
import { ProjectsPage } from "./LighthouseProjects";
import {
  acceptInvite,
  declineInvite,
  useInvites,
  useWorkspaceId,
  type WorkspaceInvite,
} from "./workspaceStore";

// Names can change at runtime; the version argument keeps the compiler honest.
const agentName = (viewer: LighthouseViewer, chat: string, _version: number) =>
  companyAgent(chat)?.name ?? chiefName(viewer, chat);

const chatIds = (viewer: LighthouseViewer, workspace: string, _version: number) =>
  chatsFor(viewer, workspace).map((c) => c.id);
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
                    {a.kind === "merge" ? "先看 diff" : "让个人助理定"}
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

function InviteInbox({ invites }: { invites: ReadonlyArray<WorkspaceInvite> }) {
  if (invites.length === 0) return null;
  return (
    <ul className="flex flex-col gap-4">
      {invites.map((invite) => (
        <li key={invite.code} className="flex gap-3">
          <span className="mt-1.5">
            <ToneDot tone="ok" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">
              工作区邀请 · {WORKSPACE_KIND[invite.workspace.kind]}
            </div>
            <div className="mt-0.5 text-sm">
              {invite.from} 邀请你以「{invite.role}」身份加入 {invite.workspace.name}。
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="xs" onClick={() => acceptInvite(invite)}>
                接受并进入
              </Button>
              <Button size="xs" variant="outline" onClick={() => declineInvite(invite)}>
                拒绝
              </Button>
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
  v: ReturnType<typeof useViewer>,
  workspace: string,
  chat: string,
): ReadonlyArray<ChatMessage> {
  const { open, locked } = projectsIn(workspace, viewer);
  const custom = customAgent(chat);
  if (custom) {
    return [
      {
        id: "a1",
        role: "assistant",
        author: chiefName(viewer, chat),
        body: "我是你的自定义 agent，只听你的。我用你给我的 skills 做事，没勾的权限会先问你。",
      },
    ];
  }
  const company = companyAgent(chat);
  if (company) {
    const extra: ReadonlyArray<ChatMessage> = chat === "hr" ? HR_MAIL : [];
    return [
      {
        id: "a1",
        role: "assistant",
        author: company.name,
        body: (
          <div className="flex flex-col gap-2">
            <span>
              我是公司的{company.dept}代理，归 {company.owner}。我按你的权限回答，能帮你：
            </span>
            <ul className="list-disc ps-5">
              {company.can.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ),
      },
      ...extra,
    ];
  }
  if (chat !== "mine") {
    const p = PROJECTS[chat];
    const cos = chiefName(viewer, chat);
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
    ...assistantChannels(
      v.cos.name,
      defaultHandle({ kind: "personal", viewer, workspace, agent: "cos" }, "email"),
    ),
  ];
}

const QUOTE = {
  from: "李工 <li@servo-sz.com>",
  subject: "报价单 · 夹爪舵机 200 套",
  lines: [
    "您好，附件是 200 套改型舵机的报价：单价 ¥86，含税，交期 3 周。",
    "500 套以上可以再谈 8% 的折扣。报价有效期到 11 月 15 日。",
    "麻烦在 11 月 8 日前确认数量。",
  ],
};

/** The 个人助理 hears from the same person on several channels; all of it lands in one chat. */
function assistantChannels(name: string, mail: string): ReadonlyArray<ChatMessage> {
  return [
    {
      id: "u2",
      role: "user",
      channel: "telegram",
      via: "09:20",
      body: "到公司了，今天的会帮我看一下",
    },
    {
      id: "a3",
      role: "assistant",
      author: name,
      channel: "telegram",
      via: "09:20",
      body: "今天 2 个会：10:30 夹爪评审，15:00 和舵机供应商。供应商的报价单刚到邮箱，放在下面了。",
    },
    {
      id: "a4",
      role: "assistant",
      author: name,
      channel: "email",
      via: `收到 · ${mail}`,
      body: (
        <div className="flex flex-col gap-2">
          <EmailCard from={QUOTE.from} to={mail} subject={QUOTE.subject} lines={QUOTE.lines} />
          <span>我把「确认舵机数量」放进了需要你定。回信我写成了草稿，你点发送才会发出。</span>
        </div>
      ),
    },
    {
      id: "a5",
      role: "assistant",
      author: name,
      channel: "email",
      via: "草稿",
      body: (
        <DraftReply
          to="李工"
          subject={`Re: ${QUOTE.subject}`}
          text={"李工您好，报价收到，谢谢。\n我们这周内确认数量，届时再回复您。"}
        />
      ),
    },
    { id: "u3", role: "user", channel: "wechat", via: "10:05", body: "下午 3 点的会推到 4 点" },
    {
      id: "a6",
      role: "assistant",
      author: name,
      channel: "wechat",
      via: "10:05",
      body: "已在「Codi」日历里改好。对方那边的会议邀请也要改，这算对外发消息，你点确认后我再发。",
    },
  ];
}

const HR_MAIL: ReadonlyArray<ChatMessage> = [
  {
    id: "a2",
    role: "assistant",
    author: "人事代理",
    channel: "email",
    via: "收到 · hr@dimx.ai",
    body: (
      <div className="flex flex-col gap-2">
        <EmailCard
          from="Chen Yu <chenyu.new@gmail.com>"
          to="hr@dimx.ai"
          subject="入职材料补交"
          lines={[
            "您好，我是下周一入职的 Chen Yu。附件是身份证和银行卡信息。",
            "学历证明还在学校办理，预计周三拿到，可以晚几天补吗？",
          ]}
        />
        <span>我按入职清单核对了：只缺学历证明扫描件。回信写成了草稿，由人事部发送。</span>
      </div>
    ),
  },
  {
    id: "a3",
    role: "assistant",
    author: "人事代理",
    channel: "email",
    via: "草稿",
    body: (
      <DraftReply
        to="Chen Yu"
        subject="Re: 入职材料补交"
        text={"Chen Yu 你好，材料已收到。学历证明可以在入职后一周内补交。\n欢迎加入 DimensionX。"}
      />
    ),
  },
  { id: "u1", role: "user", body: "11 月我有几天考勤异常？" },
  {
    id: "a4",
    role: "assistant",
    author: "人事代理",
    body: "按你的权限，我只看你自己的记录：11 月 0 天异常。别人的考勤我不会告诉你。",
  },
];

/** A static mock: how much this chat's agent has loaded, and from where. */
function contextFor(chat: string): ContextLoad {
  if (chat === "mine") {
    return {
      used: 18_400,
      total: 200_000,
      memories: 42,
      parts: [
        { label: "固定记忆", detail: "你的角色、偏好、常用项目", tokens: 1_200 },
        { label: "最近摘要", detail: "昨天和今天的 4 段对话，已压成摘要", tokens: 3_400 },
        { label: "检索到的 3 条", detail: "舵机供应商、夹爪 BOM、上次报价", tokens: 2_100 },
        { label: "当前任务板", detail: "夹爪 Demo · 7 张卡、2 个租约", tokens: 4_800 },
        { label: "本次对话", detail: "Codi、Telegram、微信、邮箱共 9 条", tokens: 6_900 },
      ],
    };
  }
  if (companyAgent(chat)) {
    return {
      used: 9_800,
      total: 200_000,
      memories: 17,
      parts: [
        { label: "固定记忆", detail: "部门规则和流程，按你的权限过滤", tokens: 2_600 },
        { label: "检索到的 3 条", detail: "入职清单、考勤规则、你的记录", tokens: 1_900 },
        { label: "本次对话", detail: "邮箱和 Codi 共 5 条", tokens: 5_300 },
      ],
    };
  }
  return {
    used: 12_600,
    total: 200_000,
    memories: 23,
    parts: [
      { label: "固定记忆", detail: "项目约定、你的偏好", tokens: 1_000 },
      { label: "最近摘要", detail: "这个项目最近 3 段对话", tokens: 2_800 },
      { label: "当前任务板", detail: "这个项目的卡、租约和决定", tokens: 5_200 },
      { label: "本次对话", detail: "3 条", tokens: 3_600 },
    ],
  };
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
  const v = useViewer(viewer);
  const version = useRegistryVersion();
  const asks = asksFor(viewer, workspace, chat === "mine" ? undefined : chat);
  const invites = useInvites(viewer).pending;
  const inviteAsks = chat === "mine" ? invites : [];
  const count = asks.length + inviteAsks.length;
  const cosName = chat === "mine" ? v.cos.name : agentName(viewer, chat, version);
  const [filter, setFilter] = useState<ChannelFilterValue>("all");
  const messages = conversation(viewer, v, workspace, chat);
  const counts: Partial<Record<ChannelId, number>> = {};
  for (const m of messages) counts[m.channel ?? "codi"] = (counts[m.channel ?? "codi"] ?? 0) + 1;
  const shown =
    filter === "all" ? messages : messages.filter((m) => (m.channel ?? "codi") === filter);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
        <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 py-6">
          {count > 0 ? (
            <div className="mb-8 flex flex-col gap-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                需要你定
                <Badge variant="secondary">{count}</Badge>
              </h2>
              <InviteInbox invites={inviteAsks} />
              <Inbox asks={asks} />
            </div>
          ) : null}
          {Object.keys(counts).length > 1 ? (
            <div className="mb-4 flex justify-center">
              <ChannelFilter counts={counts} value={filter} onChange={setFilter} />
            </div>
          ) : null}
          <ChatTimeline messages={shown} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 pb-4">
        <ChatComposerCard
          placeholder={`对 ${cosName} 说`}
          label={
            <span className="inline-flex items-center gap-1.5">
              <BotAvatar seed={cosName} size="xs" />
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
  const v = useViewer(viewer);
  const version = useRegistryVersion();
  // A chat this workspace does not have falls back to the viewer's 个人助理.
  const chat = chatIds(viewer, workspace, version).includes(search.chat) ? search.chat : "mine";
  const chatName = chat === "mine" ? v.cos.name : agentName(viewer, chat, version);
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
          <WorkspaceBreadcrumb ariaLabel="Telescope breadcrumb" className="min-w-0">
            <WorkspaceBreadcrumbItem>
              <span>{workspaceName}</span>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current>
              <h1>{view === "chats" ? chatName : viewLabel}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          {view === "chats" ? (
            <div className="ms-auto">
              <ContextMeter load={contextFor(chat)} />
            </div>
          ) : null}
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
                        : view === "projects" || view === "teams"
                          ? "mx-auto max-w-5xl px-5 pt-10"
                          : "mx-auto max-w-5xl px-5",
                  )}
                >
                  {view === "projects" ? (
                    <ProjectsPage viewer={viewer} workspace={workspace} />
                  ) : null}
                  {view === "teams" ? <TeamsPage viewer={viewer} workspace={workspace} /> : null}
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
