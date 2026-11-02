// PROTOTYPE, wipe me. Shared mock data for the Lighthouse Work tab prototype.
export type LighthouseViewer = "admin" | "lead" | "member";
export type LighthouseChatId = "mine" | "codi" | "site" | "app" | "desk";

export const VIEWERS: Record<
  LighthouseViewer,
  {
    name: string;
    title: string;
    projects: ReadonlyArray<string>;
    docs: ReadonlyArray<string>;
    cos: { name: string; motto: string; tone: string };
  }
> = {
  admin: {
    name: "林砚",
    title: "管理员",
    projects: ["codi", "site", "app"],
    docs: ["public", "team", "confidential"],
    cos: { name: "砚书", motto: "把复杂留在边界，把简单留给你。", tone: "克制，先给结论" },
  },
  lead: {
    name: "沈叙白",
    title: "官网负责人",
    projects: ["site"],
    docs: ["public", "team"],
    cos: { name: "小满", motto: "今天只做最重要的三件。", tone: "活泼，爱列清单" },
  },
  member: {
    name: "周清野",
    title: "移动端成员",
    projects: ["app"],
    docs: ["public"],
    cos: { name: "助理", motto: "先量出来，再谈感觉。", tone: "默认人设，未自定义" },
  },
};

export const PROJECT_COS: Record<string, { name: string; tone: string }> = {
  codi: { name: "Codi 幕僚长", tone: "bg-primary" },
  site: { name: "官网 幕僚长", tone: "bg-success" },
  app: { name: "移动端 幕僚长", tone: "bg-warning" },
};

export interface LighthouseChat {
  id: LighthouseChatId;
  name: string;
  tone: string;
  last: string;
  time: string;
  unread: number;
  online: boolean;
  readOnly?: boolean;
}

export function chatsFor(viewer: LighthouseViewer): ReadonlyArray<LighthouseChat> {
  const v = VIEWERS[viewer];
  const mine: LighthouseChat = {
    id: "mine",
    name: `${v.cos.name}（我的）`,
    tone: "bg-foreground",
    last:
      viewer === "admin"
        ? "官网 PR #88 我建议今天合…"
        : viewer === "lead"
          ? "PR #88 是你的，合并前要不要…"
          : "云容器配额我已经起草了申请…",
    time: "09:05",
    unread: viewer === "admin" ? 3 : viewer === "lead" ? 2 : 1,
    online: true,
  };
  const projects: ReadonlyArray<LighthouseChat> = [
    {
      id: "codi" as const,
      last: "把 #23 的后续评论直通给 W7，不新开工单。",
      time: "10:42",
      unread: 0,
      online: true,
    },
    {
      id: "site" as const,
      last: "PR #88 CI 绿，等人确认合并。",
      time: "10:41",
      unread: 1,
      online: true,
    },
    {
      id: "app" as const,
      last: "环境离线，app#41 挂起，等机器回来。",
      time: "09:58",
      unread: 0,
      online: false,
    },
  ]
    .filter((c) => v.projects.includes(c.id))
    .map((c) => ({ ...c, name: PROJECT_COS[c.id]!.name, tone: PROJECT_COS[c.id]!.tone }));
  const desk: LighthouseChat = {
    id: "desk",
    name: "总台",
    tone: "bg-muted-foreground",
    last: "本周周报已整理。只读。",
    time: "09:00",
    unread: 0,
    online: true,
    readOnly: true,
  };
  return [mine, ...projects, desk];
}

export type LighthouseView = "chats" | "bots" | "dashboard" | "tasks";

export type TaskStatus = "todo" | "doing" | "review" | "done";
export type TaskPriority = "high" | "medium" | "low";
export type TaskType = "feature" | "bug" | "polish" | "research";

export const TASK_STATUS: Record<
  TaskStatus,
  { label: string; badge: "outline" | "info" | "warning" | "success" }
> = {
  todo: { label: "未开始", badge: "outline" },
  doing: { label: "进行中", badge: "info" },
  review: { label: "等确认", badge: "warning" },
  done: { label: "完成", badge: "success" },
};

export const TASK_PRIORITY: Record<
  TaskPriority,
  { label: string; badge: "error" | "warning" | "outline" }
> = {
  high: { label: "高", badge: "error" },
  medium: { label: "中", badge: "warning" },
  low: { label: "低", badge: "outline" },
};

export const TASK_TYPE: Record<
  TaskType,
  { label: string; badge: "success" | "error" | "info" | "outline" }
> = {
  feature: { label: "需求", badge: "success" },
  bug: { label: "缺陷", badge: "error" },
  polish: { label: "打磨", badge: "info" },
  research: { label: "调研", badge: "outline" },
};

export interface TaskAssignee {
  kind: "person" | "bot";
  name: string;
  tone: string;
}

const P = (name: string): TaskAssignee => ({ kind: "person", name, tone: "bg-secondary" });
const B = (name: string, tone: string): TaskAssignee => ({ kind: "bot", name, tone });

export interface LighthouseTask {
  id: string;
  title: string;
  project: string;
  status: TaskStatus;
  assignees: ReadonlyArray<TaskAssignee>;
  due?: string;
  priority?: TaskPriority;
  type?: TaskType;
  description?: string;
  tickets: ReadonlyArray<{
    id: string;
    title: string;
    worker?: string;
    state: "open" | "pr" | "merged";
  }>;
}

export const TASKS: ReadonlyArray<LighthouseTask> = [
  {
    id: "T-12",
    title: "官网 RSS 与封面图",
    project: "site",
    status: "review",
    assignees: [P("沈叙白"), B("官网 幕僚长", "bg-success")],
    due: "2026-11-03",
    priority: "high",
    type: "feature",
    description: "博客输出全文 RSS，每篇自动生成 og:image。",
    tickets: [
      { id: "site#12", title: "RSS feed 输出全文", worker: "W3", state: "pr" },
      { id: "site#14", title: "og:image 自动生成", worker: "W4", state: "open" },
    ],
  },
  {
    id: "T-15",
    title: "Webhook 入口签名校验",
    project: "codi",
    status: "doing",
    assignees: [P("林砚"), B("Codi 幕僚长", "bg-primary")],
    due: "2026-11-05",
    priority: "high",
    type: "feature",
    description: "GitHub HMAC 与 GitLab Standard Webhooks 两种签名，加重放窗口。",
    tickets: [
      { id: "codi#23", title: "GitHub 签名校验", worker: "W7", state: "pr" },
      { id: "codi#31", title: "GitLab Standard Webhooks", worker: "W9", state: "open" },
      { id: "codi#32", title: "重放窗口与去重", state: "open" },
    ],
  },
  {
    id: "T-18",
    title: "移动端离线缓存",
    project: "app",
    status: "doing",
    assignees: [P("周清野"), B("移动端 幕僚长", "bg-warning")],
    due: "2026-11-08",
    priority: "medium",
    type: "feature",
    description: "SQLite 缓存线程列表，断网时只读。",
    tickets: [{ id: "app#41", title: "SQLite 缓存层", worker: "W11", state: "open" }],
  },
  {
    id: "T-09",
    title: "企微 Bot 接入总台",
    project: "codi",
    status: "todo",
    assignees: [B("Codi 幕僚长", "bg-primary")],
    due: "2026-11-12",
    priority: "medium",
    type: "feature",
    description: "企微消息先查重，归入已有话题，再决定开不开工单。",
    tickets: [
      { id: "codi#5", title: "WeCom 回调接入", state: "open" },
      { id: "codi#36", title: "消息去重并归入已有话题", state: "open" },
    ],
  },
  {
    id: "T-21",
    title: "价格页 Safari 错位",
    project: "site",
    status: "done",
    assignees: [B("官网 幕僚长", "bg-success")],
    due: "2026-10-30",
    priority: "high",
    type: "bug",
    tickets: [{ id: "site#88", title: "Safari flex gap 回退", worker: "W3", state: "merged" }],
  },
  {
    id: "T-07",
    title: "Fold 品牌落地",
    project: "site",
    status: "done",
    assignees: [P("林砚"), P("沈叙白")],
    due: "2026-10-28",
    priority: "medium",
    type: "polish",
    description: "Logo、色板、首页改版。",
    tickets: [
      { id: "site#3", title: "Logo 与色板", state: "merged" },
      { id: "site#4", title: "首页改版", state: "merged" },
    ],
  },
  {
    id: "T-22",
    title: "幕僚长上下文轮换",
    project: "codi",
    status: "todo",
    assignees: [P("林砚")],
    priority: "high",
    type: "research",
    description: "常驻线程到阈值时交接，测一次交接要多少 token。",
    tickets: [{ id: "codi#7", title: "Spike：常驻线程不亲自干活", state: "open" }],
  },
  {
    id: "T-24",
    title: "Android 模拟器配额",
    project: "app",
    status: "review",
    assignees: [P("周清野")],
    due: "2026-11-04",
    type: "research",
    description: "家里电脑离线时，app#41 改派到云容器。",
    tickets: [],
  },
  {
    id: "T-25",
    title: "周报模板",
    project: "codi",
    status: "doing",
    assignees: [B("总台", "bg-muted-foreground")],
    priority: "low",
    type: "polish",
    tickets: [],
  },
];

export interface LighthouseBot {
  id: string;
  name: string;
  kind: "cos" | "desk" | "router" | "worker";
  tone: string;
  harness: string;
  where: string;
  status: string;
  online: boolean;
  project?: string;
  chat?: LighthouseChatId;
}

export const BOTS: ReadonlyArray<LighthouseBot> = [
  {
    id: "router",
    name: "Lighthouse 路由",
    kind: "router",
    tone: "bg-foreground",
    harness: "Codi 常驻线程 / Haiku",
    where: "lighthouse-01",
    status: "盯 6 个信道，今天分发 14 条",
    online: true,
  },
  {
    id: "desk",
    name: "总台",
    kind: "desk",
    tone: "bg-muted-foreground",
    harness: "Codi 线程 / Sonnet",
    where: "lighthouse-01",
    status: "只读，按权限过滤",
    online: true,
    chat: "desk",
  },
  {
    id: "cos-codi",
    name: "Codi 幕僚长",
    kind: "cos",
    tone: "bg-primary",
    harness: "Codi 滚动线程 / Opus",
    where: "lighthouse-01",
    status: "管 2 个 Worker",
    online: true,
    project: "codi",
    chat: "codi",
  },
  {
    id: "cos-site",
    name: "官网 幕僚长",
    kind: "cos",
    tone: "bg-success",
    harness: "Codi 滚动线程 / Sonnet",
    where: "lighthouse-01",
    status: "等人确认 PR #88",
    online: true,
    project: "site",
    chat: "site",
  },
  {
    id: "cos-app",
    name: "移动端 幕僚长",
    kind: "cos",
    tone: "bg-warning",
    harness: "Codi 滚动线程 / Sonnet",
    where: "mac-mini-2",
    status: "环境离线，挂起",
    online: false,
    project: "app",
    chat: "app",
  },
  {
    id: "W3",
    name: "W3",
    kind: "worker",
    tone: "bg-success",
    harness: "Codex / gpt-5",
    where: "lighthouse-01",
    status: "等人确认合并 · site#12",
    online: true,
    project: "site",
  },
  {
    id: "W4",
    name: "W4",
    kind: "worker",
    tone: "bg-success",
    harness: "Codex / mini",
    where: "lighthouse-01",
    status: "刚启动 · site#14",
    online: true,
    project: "site",
  },
  {
    id: "W7",
    name: "W7",
    kind: "worker",
    tone: "bg-primary",
    harness: "Claude Code / Opus",
    where: "ws-lin-3",
    status: "等 CI · codi#23",
    online: true,
    project: "codi",
  },
  {
    id: "W9",
    name: "W9",
    kind: "worker",
    tone: "bg-primary",
    harness: "Claude Code / Sonnet",
    where: "ws-lin-3",
    status: "写代码 · codi#31",
    online: true,
    project: "codi",
  },
  {
    id: "W11",
    name: "W11",
    kind: "worker",
    tone: "bg-warning",
    harness: "Claude Code / Opus",
    where: "mac-mini-2",
    status: "环境离线 · app#41",
    online: false,
    project: "app",
  },
];
