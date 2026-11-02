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

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: string }> = {
  todo: { label: "待排", tone: "bg-muted-foreground" },
  doing: { label: "进行中", tone: "bg-primary" },
  review: { label: "等确认", tone: "bg-warning" },
  done: { label: "完成", tone: "bg-success" },
};

export interface LighthouseTask {
  id: string;
  title: string;
  project: string;
  status: TaskStatus;
  owner: string;
  due: string;
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
    owner: "官网 幕僚长",
    due: "11-03",
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
    owner: "Codi 幕僚长",
    due: "11-05",
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
    owner: "移动端 幕僚长",
    due: "11-08",
    tickets: [{ id: "app#41", title: "SQLite 缓存层", worker: "W11", state: "open" }],
  },
  {
    id: "T-09",
    title: "企微 Bot 接入总台",
    project: "codi",
    status: "todo",
    owner: "Codi 幕僚长",
    due: "11-12",
    tickets: [
      { id: "codi#5", title: "WeCom 回调接入", state: "open" },
      { id: "codi#36", title: "消息去重并归入已有话题", state: "open" },
    ],
  },
  {
    id: "T-07",
    title: "Fold 品牌落地",
    project: "site",
    status: "done",
    owner: "官网 幕僚长",
    due: "10-28",
    tickets: [
      { id: "site#3", title: "Logo 与色板", state: "merged" },
      { id: "site#4", title: "首页改版", state: "merged" },
    ],
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
