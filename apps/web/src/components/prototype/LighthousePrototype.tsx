// PROTOTYPE, wipe me. Round 3 of the Lighthouse "工作" tab, mounted inside the real Codi shell at
// /prototype/lighthouse. Three layouts behind ?variant=A|B|C, a viewer switch behind ?as=.
// Rule under test: on this tab the user talks only to their Chief of Staff; company information is
// read-only and everything else is a link, a Worker link opening its Codi thread. Mock data only.
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  BuildingIcon,
  CircleDotIcon,
  FolderKanbanIcon,
  LockIcon,
  MessageSquareIcon,
  ScaleIcon,
  SendIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { BotAvatar } from "./LighthouseChatList";
import {
  PROJECT_COS,
  VIEWERS,
  type LighthouseChatId,
  type LighthouseView,
  type LighthouseViewer,
} from "./lighthouseData";
import { RAIL_ITEMS } from "./LighthouseRail";
import { BotsPage, CopilotPanel, DashboardPage, TasksPage } from "./LighthouseWork";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";

export type LighthouseVariant = "A" | "B" | "C";
export interface LighthouseSearch {
  readonly variant: LighthouseVariant;
  readonly as: LighthouseViewer;
  readonly chat: LighthouseChatId;
  readonly view: LighthouseView;
}

const PROJECTS: Record<
  string,
  {
    name: string;
    lead: string;
    tone: "ok" | "warn" | "bad";
    line: string;
    workers: number;
    pr: string;
  }
> = {
  codi: {
    name: "Codi",
    lead: "林砚",
    tone: "ok",
    line: "Lighthouse 地图 8 票，3 关；PR #14 原型等试。",
    workers: 4,
    pr: "2 个 PR 等合并确认",
  },
  site: {
    name: "官网",
    lead: "沈叙白",
    tone: "warn",
    line: "价格页 Safari 错位修好了，等人确认合并。",
    workers: 2,
    pr: "PR #88 CI 绿",
  },
  app: {
    name: "移动端",
    lead: "周清野",
    tone: "bad",
    line: "家里电脑离线 2 小时，app#41 挂起。",
    workers: 2,
    pr: "PR #140 CI 红",
  },
};

const DOCS = [
  { level: "public", kind: "制度", title: "远程协作约定（第 3 版）", meta: "上周更新" },
  {
    level: "public",
    kind: "周报",
    title: "本周周报：三个项目的进展与阻塞",
    meta: "总台整理 · 今天 09:00",
  },
  {
    level: "team",
    kind: "OKR",
    title: "Q4 目标：Lighthouse v1 上线，官网转化 +15%",
    meta: "负责人以上可见",
  },
  {
    level: "team",
    kind: "决定",
    title: "工单真源用 GitHub/GitLab issue，不用 Linear",
    meta: "2026-11-02",
  },
  { level: "confidential", kind: "财务", title: "11 月模型与算力账单预估", meta: "仅管理员" },
  { level: "confidential", kind: "人事", title: "招聘：移动端第二位工程师", meta: "仅管理员" },
];

const DECISIONS = [
  {
    state: "chosen",
    when: "11-02 · 林砚",
    title: "Lighthouse 架在 Codi 之上，Codi 只当 Worker 池",
  },
  { state: "rejected", when: "11-02", title: "全部塞进 Codi 服务器" },
  {
    state: "open",
    when: "票 #13",
    title: "成员与授权的真源：Lighthouse 成员表，还是从 forge 推导",
  },
  { state: "open", when: "票 #15", title: "私人幕僚长与公司总台怎么分屏" },
] as const;

const ASKS: Record<
  LighthouseViewer,
  ReadonlyArray<{ kind: "merge" | "question"; from: string; text: string; thread: string }>
> = {
  admin: [
    {
      kind: "merge",
      from: "官网 · W3",
      text: "PR #88 价格页修复：CI 绿，评审 agent 通过。合并到 main？",
      thread: "W3",
    },
    {
      kind: "question",
      from: "Codi · W9",
      text: "反查工具要不要同时返回已结算的线程？默认只返回未结算。",
      thread: "W9",
    },
    {
      kind: "question",
      from: "移动端 · W11",
      text: "家里电脑离线 2 小时，app#41 改派到云容器？需要 Android 模拟器。",
      thread: "W11",
    },
  ],
  lead: [
    {
      kind: "merge",
      from: "官网 · W3",
      text: "你的 PR #88：CI 绿，评审通过。合并到 main？",
      thread: "W3",
    },
    {
      kind: "question",
      from: "官网 · W4",
      text: "RSS 封面图用 og:image 还是首图？两种都能做。",
      thread: "W4",
    },
  ],
  member: [
    {
      kind: "question",
      from: "移动端 · W11",
      text: "机器离线，要我帮你申请云容器配额吗？",
      thread: "W11",
    },
  ],
};

const WORKERS = [
  {
    id: "W3",
    project: "site",
    harness: "Codex / gpt-5",
    ticket: "site#12",
    status: "等人确认合并",
  },
  { id: "W4", project: "site", harness: "Codex / mini", ticket: "site#14", status: "刚启动" },
  { id: "W7", project: "codi", harness: "Claude Code / Opus", ticket: "codi#23", status: "等 CI" },
  {
    id: "W9",
    project: "codi",
    harness: "Claude Code / Sonnet",
    ticket: "codi#31",
    status: "写代码",
  },
  {
    id: "W11",
    project: "app",
    harness: "Claude Code / Opus",
    ticket: "app#41",
    status: "环境离线",
  },
];

const COMPANY_PAGES = [
  { id: "desk", label: "总台", icon: BuildingIcon },
  { id: "projects", label: "项目", icon: FolderKanbanIcon },
  { id: "docs", label: "文档", icon: BookOpenIcon },
  { id: "decisions", label: "决定", icon: ScaleIcon },
  { id: "people", label: "成员与授权", icon: UsersIcon },
] as const;
type CompanyPageId = (typeof COMPANY_PAGES)[number]["id"];

const VARIANT_LABEL: Record<LighthouseVariant, string> = {
  A: "对话主场，公司是顶部的只读页签",
  B: "对话在左，公司在 Codi 的右侧面板",
  C: "收件箱优先，对话在下，公司在右",
};

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

function Asks({ viewer }: { viewer: LighthouseViewer }) {
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  return (
    <ul className="divide-y">
      {ASKS[viewer].map((a, i) => (
        <li key={a.text} className="flex gap-3 py-3">
          <span className="mt-1.5">
            <ToneDot tone={a.kind === "merge" ? "ok" : "warn"} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">
              {a.from} · <ThreadLink worker={a.thread} />
            </div>
            <div className="mt-0.5 text-sm">{a.text}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {done.has(i) ? (
                <Badge variant="secondary">已交给幕僚长（原型，不生效）</Badge>
              ) : (
                <>
                  <Button size="xs" onClick={() => setDone(new Set([...done, i]))}>
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

function Composer({ cos }: { cos: string }) {
  return (
    <div className="rounded-lg border bg-card p-2 shadow-composer">
      <Textarea rows={2} placeholder={`对 ${cos} 说：派个活、问进度、改派……公司的事它会去总台查`} />
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-xs text-muted-foreground">
          这里只能和 {cos} 说话。Worker、工单、PR 都是链接。
        </span>
        <Button size="xs">
          <SendIcon /> 发送
        </Button>
      </div>
    </div>
  );
}

function Conversation({ viewer, dense }: { viewer: LighthouseViewer; dense?: boolean }) {
  const v = VIEWERS[viewer];
  const asks = ASKS[viewer];
  const lockedDocs = DOCS.filter((d) => !v.docs.includes(d.level)).length;
  return (
    <div className={cn("flex flex-col gap-5", dense && "gap-4")}>
      <div className="flex gap-3">
        <BotAvatar tone="bg-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="font-medium">{v.cos.name}</span>
            <span className="text-xs text-muted-foreground">你的幕僚长 · 09:00</span>
          </div>
          <p className="mt-1 text-sm leading-6">
            早。{asks.length} 件事等你定，我按紧急排好了。最急的是 <b>{asks[0]?.text}</b>
          </p>
          {dense ? null : (
            <div className="mt-2 rounded-lg border bg-card px-3">
              <Asks viewer={viewer} />
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-3">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-medium text-secondary-foreground">
          {v.name[0]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="font-medium">{v.name}</span>
            <span className="text-xs text-muted-foreground">09:04</span>
          </div>
          <p className="mt-1 text-sm leading-6">公司今天什么情况，有没有我该知道的决定？</p>
        </div>
      </div>
      <div className="flex gap-3">
        <BotAvatar tone="bg-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="font-medium">{v.cos.name}</span>
            <span className="text-xs text-muted-foreground">
              09:04 · 查了总台，按 {v.title} 过滤
            </span>
          </div>
          <p className="mt-1 text-sm leading-6">
            你视野内 {v.projects.length} 个项目
            {lockedDocs > 0 ? `，另有 ${lockedDocs} 份文档不对你开放，我只能说它们存在` : ""}。
          </p>
          <div className="mt-2 rounded-lg border bg-card">
            <ul className="divide-y px-3">
              {Object.entries(PROJECTS).map(([id, p]) => (
                <li key={id} className="flex items-start gap-3 py-2.5 text-sm">
                  {v.projects.includes(id) ? (
                    <>
                      <span className="mt-1.5">
                        <ToneDot tone={p.tone} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{p.name}</span>
                        <span className="ms-2 text-xs text-muted-foreground">{p.lead}</span>
                        <div className="text-muted-foreground">{p.line}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                          {WORKERS.filter((w) => w.project === id).map((w) => (
                            <ThreadLink key={w.id} worker={w.id} />
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <Locked>{p.name} · 没有访问权，只知道它存在</Locked>
                  )}
                </li>
              ))}
            </ul>
            <Separator />
            <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
              <span>最近的决定：{DECISIONS[0].title}</span>
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="text-primary hover:underline"
              >
                打开决定记录
              </a>
            </div>
          </div>
          <p className="mt-2 text-sm leading-6">
            {viewer === "admin"
              ? "官网 PR #88 我建议今天合，CI 和评审都过了；移动端那台机器我可以帮周清野申请云容器配额，你点头就行。"
              : viewer === "lead"
                ? "PR #88 是你的，合并前要不要我把 diff 摘要发到企微群？RSS 封面图我倾向 og:image。"
                : "云容器配额我已经起草了申请，等你确认就发给林砚。"}
          </p>
        </div>
      </div>
    </div>
  );
}

function CompanyPage({ page, viewer }: { page: CompanyPageId; viewer: LighthouseViewer }) {
  const v = VIEWERS[viewer];
  const note = (
    <p className="text-xs text-muted-foreground">
      总台只整理信息，不执行。按 <b>{v.title}</b> 过滤。要推进什么，回去和 {v.cos.name} 说。
    </p>
  );
  if (page === "projects" || page === "desk") {
    return (
      <div className="flex flex-col gap-4">
        {note}
        <ul className="divide-y rounded-lg border bg-card px-3">
          {Object.entries(PROJECTS).map(([id, p]) => (
            <li key={id} className="py-3 text-sm">
              {v.projects.includes(id) ? (
                <div className="flex items-start gap-3">
                  <span className="mt-1.5">
                    <ToneDot tone={p.tone} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.lead}</span>
                    </div>
                    <div className="text-muted-foreground">{p.line}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <span>{p.workers} 个 Worker</span>
                      <span className="inline-flex items-center gap-1">
                        <PullRequestGlyph.pullRequest className="size-3.5" />
                        {p.pr}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <Locked>{p.name} · 没有访问权</Locked>
              )}
            </li>
          ))}
        </ul>
        {page === "desk" ? (
          <>
            <h3 className="text-sm font-medium">需要人的事（全公司）</h3>
            <ul className="divide-y rounded-lg border bg-card px-3 text-sm">
              {ASKS.admin
                .filter((a) =>
                  v.projects.includes(WORKERS.find((w) => w.id === a.thread)?.project ?? ""),
                )
                .map((a) => (
                  <li key={a.text} className="py-2.5">
                    <div className="text-xs text-muted-foreground">{a.from}</div>
                    {a.text}
                  </li>
                ))}
            </ul>
          </>
        ) : null}
      </div>
    );
  }
  if (page === "docs") {
    return (
      <div className="flex flex-col gap-4">
        {note}
        <ul className="divide-y rounded-lg border bg-card px-3 text-sm">
          {DOCS.map((d) => (
            <li key={d.title} className="flex items-start gap-3 py-2.5">
              <Badge variant="outline" className="mt-0.5 w-12 justify-center">
                {d.kind}
              </Badge>
              {v.docs.includes(d.level) ? (
                <div>
                  <div className="font-medium">{d.title}</div>
                  <div className="text-xs text-muted-foreground">{d.meta}</div>
                </div>
              ) : (
                <Locked>这一份不对你开放；总台知道它存在</Locked>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (page === "decisions") {
    return (
      <div className="flex flex-col gap-4">
        {note}
        <ul className="flex flex-col gap-2 text-sm">
          {DECISIONS.map((d) => (
            <li
              key={d.title}
              className={cn(
                "rounded-lg border-s-2 bg-card py-2 ps-3",
                d.state === "chosen" && "border-s-foreground",
                d.state === "rejected" && "border-s-border text-muted-foreground",
                d.state === "open" && "border-s-warning",
              )}
            >
              <div className="text-xs text-muted-foreground">
                {d.state === "chosen" ? "已定" : d.state === "rejected" ? "否决" : "待定"} ·{" "}
                {d.when}
              </div>
              {d.title}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {note}
      <ul className="divide-y rounded-lg border bg-card px-3 text-sm">
        {(Object.keys(VIEWERS) as Array<LighthouseViewer>).map((k) => (
          <li key={k} className="flex items-center justify-between py-2.5">
            <span>
              <span className="font-medium">{VIEWERS[k].name}</span>
              <span className="ms-2 text-xs text-muted-foreground">{VIEWERS[k].title}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {VIEWERS[k].projects.length} 个项目 ·{" "}
              {VIEWERS[k].docs.includes("confidential")
                ? "全部文档"
                : VIEWERS[k].docs.includes("team")
                  ? "团队文档"
                  : "公开文档"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompanyTabs({
  page,
  onChange,
  compact,
}: {
  page: CompanyPageId;
  onChange: (p: CompanyPageId) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-1", compact && "flex-wrap")}>
      {COMPANY_PAGES.map((p) => (
        <Button
          key={p.id}
          size="xs"
          variant={page === p.id ? "secondary" : "ghost-muted"}
          onClick={() => onChange(p.id)}
        >
          <p.icon /> {p.label}
        </Button>
      ))}
    </div>
  );
}

function VariantA({ viewer }: { viewer: LighthouseViewer }) {
  const [page, setPage] = useState<CompanyPageId | null>(null);
  const v = VIEWERS[viewer];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-2">
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant={page === null ? "secondary" : "ghost-muted"}
            onClick={() => setPage(null)}
          >
            <BotAvatar tone="bg-foreground" size="sm" /> {v.cos.name}
          </Button>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <CompanyTabs page={page ?? "desk"} onChange={setPage} />
        </div>
        <span className="text-xs text-muted-foreground">公司页签只读</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
        <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 py-6">
          {page === null ? (
            <Conversation viewer={viewer} />
          ) : (
            <CompanyPage page={page} viewer={viewer} />
          )}
        </div>
      </div>
      {page === null ? (
        <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 pb-4">
          <Composer cos={v.cos.name} />
        </div>
      ) : null}
    </div>
  );
}

function VariantB({ viewer }: { viewer: LighthouseViewer }) {
  const [page, setPage] = useState<CompanyPageId>("desk");
  const v = VIEWERS[viewer];
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
          <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 py-6">
            <Conversation viewer={viewer} />
          </div>
        </div>
        <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 pb-4">
          <Composer cos={v.cos.name} />
        </div>
      </div>
      <aside className="flex w-[22rem] shrink-0 flex-col border-s bg-sidebar/40">
        <div className="flex min-h-10 items-center gap-1 border-b px-2">
          <CompanyTabs page={page} onChange={setPage} compact />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <CompanyPage page={page} viewer={viewer} />
        </div>
      </aside>
    </div>
  );
}

function VariantC({ viewer }: { viewer: LighthouseViewer }) {
  const [page, setPage] = useState<CompanyPageId>("projects");
  const v = VIEWERS[viewer];
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
          <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 py-6">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-lg font-semibold">需要你定</h2>
                <p className="text-sm text-muted-foreground">
                  {v.cos.name} 替你盯着 {v.projects.length} 个项目和所有信道，{ASKS[viewer].length}{" "}
                  件事等你。
                </p>
              </div>
              <BotAvatar tone="bg-foreground" size="lg" />
            </div>
            <div className="mt-3 rounded-lg border bg-card px-3">
              <Asks viewer={viewer} />
            </div>
            <h2 className="mt-8 text-sm font-medium text-muted-foreground">
              和 {v.cos.name} 的对话
            </h2>
            <div className="mt-3">
              <Conversation viewer={viewer} dense />
            </div>
          </div>
        </div>
        <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 pb-4">
          <Composer cos={v.cos.name} />
        </div>
      </div>
      <aside className="flex w-[20rem] shrink-0 flex-col border-s">
        <div className="flex min-h-10 items-center gap-1 border-b px-2">
          <CompanyTabs page={page} onChange={setPage} compact />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <CompanyPage page={page} viewer={viewer} />
        </div>
      </aside>
    </div>
  );
}

export function LighthousePrototypePage() {
  const search = useSearch({ from: "/_chat/prototype/lighthouse" });
  const navigate = useNavigate();
  const variant = search.variant;
  const viewer = search.as;
  const chat = search.chat;
  const view = search.view;
  const v = VIEWERS[viewer];
  const chatName =
    chat === "mine" ? v.cos.name : chat === "desk" ? "总台" : (PROJECT_COS[chat]?.name ?? chat);
  const viewLabel = RAIL_ITEMS.find((r) => r.id === view)?.label ?? view;
  const set = (patch: Partial<LighthouseSearch>) =>
    void navigate({ to: "/prototype/lighthouse", search: { ...search, ...patch }, replace: true });
  const cycle = (dir: 1 | -1) => {
    const keys: ReadonlyArray<LighthouseVariant> = ["A", "B", "C"];
    set({ variant: keys[(keys.indexOf(variant) + dir + keys.length) % keys.length] ?? "A" });
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- prototype switcher listens to the window for arrow keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,[contenteditable]")) return;
      if (view !== "chats") return;
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <header className="flex min-h-12 shrink-0 items-center gap-3 border-b ps-5 pe-3">
        <div className="flex items-center rounded-md border p-0.5">
          <Button size="xs" variant="ghost-muted" onClick={() => void navigate({ to: "/" })}>
            代码
          </Button>
          <Button size="xs" variant="secondary">
            工作
          </Button>
        </div>
        <WorkspaceBreadcrumb ariaLabel="Lighthouse breadcrumb" className="min-w-0">
          <WorkspaceBreadcrumbItem>
            <h1>{view === "chats" ? chatName : viewLabel}</h1>
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current>
            <span>
              {view !== "chats"
                ? `右侧和 ${chatName} 聊`
                : chat === "desk"
                  ? "只读"
                  : chat === "mine"
                    ? `${v.name} · 今天`
                    : "只回答本项目的事"}
            </span>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        <div className="ms-auto flex items-center gap-1">
          <span className="me-1 text-xs text-muted-foreground">以谁的身份看</span>
          {(Object.keys(VIEWERS) as Array<LighthouseViewer>).map((k) => (
            <Button
              key={k}
              size="xs"
              variant={viewer === k ? "secondary" : "ghost-muted"}
              onClick={() => set({ as: k })}
            >
              {VIEWERS[k].title}
            </Button>
          ))}
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {view !== "chats" ? (
          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
              <div className="mx-auto w-full max-w-5xl px-5 py-6">
                {view === "bots" ? <BotsPage viewer={viewer} /> : null}
                {view === "dashboard" ? <DashboardPage viewer={viewer} /> : null}
                {view === "tasks" ? <TasksPage key={viewer} viewer={viewer} /> : null}
              </div>
            </div>
            <CopilotPanel
              viewer={viewer}
              view={view}
              chat={chat}
              onChat={(c) => set({ chat: c })}
            />
          </div>
        ) : null}
        {view === "chats" && chat === "desk" ? (
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
            <div className="mx-auto w-full max-w-(--chat-content-max-width) px-5 py-6">
              <CompanyPage page="desk" viewer={viewer} />
            </div>
          </div>
        ) : null}
        {view === "chats" && chat !== "desk" && variant === "A" ? (
          <VariantA key={viewer + chat} viewer={viewer} />
        ) : null}
        {view === "chats" && chat !== "desk" && variant === "B" ? (
          <VariantB key={viewer + chat} viewer={viewer} />
        ) : null}
        {view === "chats" && chat !== "desk" && variant === "C" ? (
          <VariantC key={viewer + chat} viewer={viewer} />
        ) : null}
        {view === "chats" ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center lg:justify-start lg:ps-6">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black px-2 py-1.5 text-xs text-white shadow-lg">
              <button
                type="button"
                className="rounded-full bg-white/15 p-1"
                onClick={() => cycle(-1)}
                aria-label="上一个"
              >
                <ArrowLeftIcon className="size-3.5" />
              </button>
              <span className="min-w-56 text-center">
                <b className="font-mono">{variant}</b> · {VARIANT_LABEL[variant]}
              </span>
              <button
                type="button"
                className="rounded-full bg-white/15 p-1"
                onClick={() => cycle(1)}
                aria-label="下一个"
              >
                <ArrowRightIcon className="size-3.5" />
              </button>
            </div>
          </div>
        ) : null}
        <div
          className={cn(
            "pointer-events-none absolute bottom-3 hidden text-2xs text-muted-foreground lg:block",
            view === "chats" ? "end-3" : "start-3",
          )}
        >
          <CircleDotIcon className="me-1 inline size-3" />
          原型 · variant={variant} · as={viewer} · 可见项目 {v.projects.length}/3 · 可见文档{" "}
          {DOCS.filter((d) => v.docs.includes(d.level)).length}/{DOCS.length}
        </div>
      </div>
    </SidebarInset>
  );
}
