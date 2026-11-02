// PROTOTYPE, wipe me. Shared mock data for the Lighthouse Work tab prototype.
export type LighthouseViewer = "admin" | "lead" | "member";
export type LighthouseChatId = string;

export interface LighthouseWorkspace {
  id: string;
  name: string;
}

export const WORKSPACES: ReadonlyArray<LighthouseWorkspace> = [
  { id: "toniiv", name: "TONiiV" },
  { id: "dimx", name: "DimensionX" },
];

export const PROJECTS: Record<
  string,
  {
    name: string;
    workspace: string;
    lead: string;
    tone: "ok" | "warn" | "bad";
    line: string;
    pr: string;
  }
> = {
  codi: {
    name: "Codi",
    workspace: "toniiv",
    lead: "Tonic",
    tone: "ok",
    line: "Lighthouse 地图 8 票，3 关；PR #14 原型等试。",
    pr: "2 个 PR 等合并确认",
  },
  site: {
    name: "官网",
    workspace: "toniiv",
    lead: "Keting Chen",
    tone: "warn",
    line: "价格页 Safari 错位修好了，等人确认合并。",
    pr: "PR #88 CI 绿",
  },
  app: {
    name: "移动端",
    workspace: "toniiv",
    lead: "Max",
    tone: "bad",
    line: "家里电脑离线 2 小时，app#41 挂起。",
    pr: "PR #140 CI 红",
  },
  docs: {
    name: "文档站",
    workspace: "toniiv",
    lead: "Keting Chen",
    tone: "ok",
    line: "API 参考自动生成已上线。",
    pr: "无待合并",
  },
  ops: {
    name: "运维",
    workspace: "toniiv",
    lead: "Tonic",
    tone: "ok",
    line: "云容器配额本周够用。",
    pr: "无待合并",
  },
  gripper: {
    name: "夹爪 Demo",
    workspace: "dimx",
    lead: "Tonic",
    tone: "ok",
    line: "硬件设计完成，软件开发进行中，视频录制排在 7/25。",
    pr: "PR #7 CI 绿",
  },
  tactile: {
    name: "触觉传感器",
    workspace: "dimx",
    lead: "Max",
    tone: "warn",
    line: "ESP32-S3 四路电阻式已验证，护膝角度 Demo 两天方案进行中。",
    pr: "PR #3 等评审",
  },
};

export const VIEWERS: Record<
  LighthouseViewer,
  {
    name: string;
    title: string;
    projects: ReadonlyArray<string>;
    docs: ReadonlyArray<string>;
    cos: { name: string };
  }
> = {
  admin: {
    name: "Tonic",
    title: "管理员",
    projects: ["codi", "site", "app", "docs", "ops", "gripper", "tactile"],
    docs: ["public", "team", "confidential"],
    cos: { name: "砚书" },
  },
  lead: {
    name: "Keting Chen",
    title: "官网负责人",
    projects: ["site", "gripper"],
    docs: ["public", "team"],
    cos: { name: "小满" },
  },
  member: {
    name: "Max",
    title: "成员",
    projects: ["app", "tactile"],
    docs: ["public"],
    cos: { name: "助理" },
  },
};

/** Projects of the workspace, split into the ones the viewer can open and the ones they cannot. */
export function projectsIn(workspace: string, viewer: LighthouseViewer) {
  const all = Object.keys(PROJECTS).filter((id) => PROJECTS[id]!.workspace === workspace);
  const open = all.filter((id) => VIEWERS[viewer].projects.includes(id));
  return { all, open, locked: all.filter((id) => !open.includes(id)) };
}

/**
 * The Codi project behind each Lighthouse project: the same record the Code page shows
 * (title, workspace root, repository, machine). Lighthouse adds a Chief of Staff and members.
 */
export const PROJECT_SOURCE: Record<string, { root: string; repo: string; machine: string }> = {
  codi: { root: "~/code/codi", repo: "github.com/TONiiV/Codi", machine: "lighthouse-01" },
  site: { root: "~/code/site", repo: "github.com/TONiiV/site", machine: "lighthouse-01" },
  app: { root: "~/code/app", repo: "github.com/TONiiV/app", machine: "mac-mini-2" },
  docs: { root: "~/code/docs", repo: "github.com/TONiiV/docs", machine: "lighthouse-01" },
  ops: { root: "~/code/ops", repo: "gitlab.com/toniiv/ops", machine: "ws-lin-3" },
  gripper: { root: "~/dimx/gripper", repo: "gitlab.com/dimx/gripper", machine: "ws-lin-3" },
  tactile: { root: "~/dimx/tactile", repo: "gitlab.com/dimx/tactile", machine: "mac-mini-2" },
};

export const PROJECT_COS: Record<string, { name: string; tone: string }> = {
  codi: { name: "Codi 幕僚长", tone: "bg-primary" },
  site: { name: "官网 幕僚长", tone: "bg-success" },
  app: { name: "移动端 幕僚长", tone: "bg-warning" },
  docs: { name: "文档站 幕僚长", tone: "bg-info" },
  ops: { name: "运维 幕僚长", tone: "bg-muted-foreground" },
  gripper: { name: "夹爪 幕僚长", tone: "bg-info" },
  tactile: { name: "触觉 幕僚长", tone: "bg-success" },
};

export interface LighthouseAsk {
  kind: "merge" | "question";
  project: string;
  thread: string;
  text: string;
  for: ReadonlyArray<LighthouseViewer>;
}

export const ASKS: ReadonlyArray<LighthouseAsk> = [
  {
    kind: "merge",
    project: "site",
    thread: "W3",
    text: "PR #88 价格页修复：CI 绿，评审通过。合并到 main？",
    for: ["admin", "lead"],
  },
  {
    kind: "question",
    project: "codi",
    thread: "W9",
    text: "反查工具要不要同时返回已结算的线程？",
    for: ["admin"],
  },
  {
    kind: "question",
    project: "app",
    thread: "W11",
    text: "家里电脑离线 2 小时，app#41 改派到云容器？",
    for: ["admin", "member"],
  },
  {
    kind: "question",
    project: "site",
    thread: "W4",
    text: "RSS 封面图用 og:image 还是首图？",
    for: ["lead"],
  },
  {
    kind: "merge",
    project: "gripper",
    thread: "W21",
    text: "夹爪软件 PR #7：CI 绿。合并？",
    for: ["admin", "lead"],
  },
  {
    kind: "question",
    project: "tactile",
    thread: "W24",
    text: "护膝 Demo 用电阻还是电容方案先做？",
    for: ["admin", "member"],
  },
];

export const WORKERS: ReadonlyArray<{
  id: string;
  project: string;
  harness: string;
  where: string;
  ticket: string;
  status: string;
  online: boolean;
}> = [
  {
    id: "W3",
    project: "site",
    harness: "Codex / gpt-5",
    where: "lighthouse-01",
    ticket: "site#12",
    status: "等人确认合并",
    online: true,
  },
  {
    id: "W4",
    project: "site",
    harness: "Codex / mini",
    where: "lighthouse-01",
    ticket: "site#14",
    status: "刚启动",
    online: true,
  },
  {
    id: "W7",
    project: "codi",
    harness: "Claude Code / Opus",
    where: "ws-lin-3",
    ticket: "codi#23",
    status: "等 CI",
    online: true,
  },
  {
    id: "W9",
    project: "codi",
    harness: "Claude Code / Sonnet",
    where: "ws-lin-3",
    ticket: "codi#31",
    status: "写代码",
    online: true,
  },
  {
    id: "W11",
    project: "app",
    harness: "Claude Code / Opus",
    where: "mac-mini-2",
    ticket: "app#41",
    status: "环境离线",
    online: false,
  },
  {
    id: "W21",
    project: "gripper",
    harness: "Codex / gpt-5",
    where: "lab-pc",
    ticket: "gripper#7",
    status: "等人确认合并",
    online: true,
  },
  {
    id: "W24",
    project: "tactile",
    harness: "Claude Code / Sonnet",
    where: "lab-pc",
    ticket: "tactile#3",
    status: "等评审",
    online: true,
  },
];

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

const LAST_LINE: Record<string, { last: string; time: string; unread: number }> = {
  codi: { last: "把 #23 的后续评论直通给 W7。", time: "10:42", unread: 0 },
  site: { last: "PR #88 CI 绿，等人确认合并。", time: "10:41", unread: 1 },
  app: { last: "环境离线，app#41 挂起。", time: "09:58", unread: 0 },
  docs: { last: "API 参考已重新生成。", time: "08:30", unread: 0 },
  ops: { last: "配额够用。", time: "昨天", unread: 0 },
  gripper: { last: "PR #7 CI 绿。", time: "10:12", unread: 1 },
  tactile: { last: "护膝方案等你选。", time: "09:40", unread: 0 },
};

/** Prototype only: a project linked from Code joins every registry the views read. */
export function registerProject(
  id: string,
  project: { name: string; workspace: string; lead: string; cos: string; viewer: LighthouseViewer },
  source: { root: string; repo: string; machine: string },
) {
  PROJECTS[id] = {
    name: project.name,
    workspace: project.workspace,
    lead: project.lead,
    tone: "ok",
    line: "刚接入，幕僚长在读仓库和最近的 PR。",
    pr: "还没有 PR",
  };
  PROJECT_SOURCE[id] = source;
  PROJECT_COS[id] = { name: project.cos, tone: "bg-primary" };
  LAST_LINE[id] = { last: "接入完成，正在读仓库。", time: "刚刚", unread: 0 };
  const v = VIEWERS[project.viewer];
  v.projects = [...v.projects, id];
}

export function chatsFor(
  viewer: LighthouseViewer,
  workspace: string,
): ReadonlyArray<LighthouseChat> {
  const v = VIEWERS[viewer];
  const open = projectsIn(workspace, viewer).open;
  const asks = ASKS.filter((a) => a.for.includes(viewer) && open.includes(a.project));
  const mine: LighthouseChat = {
    id: "mine",
    name: v.cos.name,
    tone: "bg-foreground",
    last: asks[0]?.text ?? "今天没有要你定的事。",
    time: "09:05",
    unread: asks.length,
    online: true,
  };
  const projects = open.map((id) => ({
    id,
    name: PROJECT_COS[id]!.name,
    tone: PROJECT_COS[id]!.tone,
    online: id !== "app",
    ...LAST_LINE[id]!,
  }));
  const desk: LighthouseChat = {
    id: "desk",
    name: "总台",
    tone: "bg-muted-foreground",
    last: "本周周报已整理。",
    time: "09:00",
    unread: 0,
    online: true,
    readOnly: true,
  };
  return [mine, ...projects, desk];
}

export type LighthouseView =
  | "chats"
  | "projects"
  | "bots"
  | "dashboard"
  | "tasks"
  | "decisions"
  | "members";

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

const TONIIV_TASKS: ReadonlyArray<LighthouseTask> = [
  {
    id: "T-12",
    title: "官网 RSS 与封面图",
    project: "site",
    status: "review",
    assignees: [P("Keting Chen"), B("官网 幕僚长", "bg-success")],
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
    assignees: [P("Tonic"), B("Codi 幕僚长", "bg-primary")],
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
    assignees: [P("Max"), B("移动端 幕僚长", "bg-warning")],
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
    assignees: [P("Tonic"), P("Keting Chen")],
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
    assignees: [P("Tonic")],
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
    assignees: [P("Max")],
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

const DIMX_TASKS: ReadonlyArray<LighthouseTask> = [
  {
    id: "D-01",
    title: "工业夹取机器人 / 灵巧手触觉 PoC",
    project: "gripper",
    status: "doing",
    assignees: [B("夹爪 幕僚长", "bg-info")],
    priority: "high",
    type: "feature",
    description: "DimensionX 机器人方向第一版 Demo。",
    tickets: [{ id: "gripper#1", title: "PoC 范围", state: "open" }],
  },
  {
    id: "D-02",
    title: "夹爪 Demo 硬件设计",
    project: "gripper",
    status: "done",
    assignees: [P("Tonic"), P("Keting Chen")],
    due: "2026-07-11",
    priority: "high",
    tickets: [{ id: "gripper#2", title: "结构与选型", state: "merged" }],
  },
  {
    id: "D-03",
    title: "夹爪 Demo 软件开发",
    project: "gripper",
    status: "doing",
    assignees: [P("Tonic"), B("夹爪 幕僚长", "bg-info")],
    due: "2026-07-18",
    tickets: [{ id: "gripper#7", title: "抓取控制", worker: "W21", state: "pr" }],
  },
  {
    id: "D-04",
    title: "夹爪 Demo 视频录制",
    project: "gripper",
    status: "todo",
    assignees: [P("Tonic"), P("Keting Chen")],
    due: "2026-07-25",
    tickets: [],
  },
  {
    id: "D-05",
    title: "ESP32-S3 四路电阻式传感器 + BLE Demo",
    project: "tactile",
    status: "done",
    assignees: [P("Max")],
    priority: "medium",
    type: "feature",
    description: "GPIO4/5/6/7，每路一个分压。",
    tickets: [{ id: "tactile#1", title: "BLE 传输", state: "merged" }],
  },
  {
    id: "D-06",
    title: "护膝膝关节角度 Demo（电阻 + 电容，2 天方案）",
    project: "tactile",
    status: "doing",
    assignees: [P("Max"), B("触觉 幕僚长", "bg-success")],
    type: "feature",
    description: "用现有 5×5 cm 传感器、ESP32-S3 和护膝。",
    tickets: [{ id: "tactile#3", title: "角度标定", worker: "W24", state: "pr" }],
  },
  {
    id: "D-07",
    title: "Robot Tactile Project Research",
    project: "tactile",
    status: "todo",
    assignees: [],
    type: "research",
    tickets: [],
  },
];

export const TASKS: ReadonlyArray<LighthouseTask> = [...TONIIV_TASKS, ...DIMX_TASKS];

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
  {
    id: "cos-gripper",
    name: "夹爪 幕僚长",
    kind: "cos",
    tone: "bg-info",
    harness: "Codi 滚动线程 / Sonnet",
    where: "lab-pc",
    status: "管 1 个 Worker",
    online: true,
    project: "gripper",
    chat: "gripper",
  },
  {
    id: "cos-tactile",
    name: "触觉 幕僚长",
    kind: "cos",
    tone: "bg-success",
    harness: "Codi 滚动线程 / Sonnet",
    where: "lab-pc",
    status: "等人选方案",
    online: true,
    project: "tactile",
    chat: "tactile",
  },
  {
    id: "W21",
    name: "W21",
    kind: "worker",
    tone: "bg-info",
    harness: "Codex / gpt-5",
    where: "lab-pc",
    status: "等人确认合并 · gripper#7",
    online: true,
    project: "gripper",
  },
  {
    id: "W24",
    name: "W24",
    kind: "worker",
    tone: "bg-success",
    harness: "Claude Code / Sonnet",
    where: "lab-pc",
    status: "等评审 · tactile#3",
    online: true,
    project: "tactile",
  },
];

export type DecisionWeight = "key" | "major" | "minor";
export type DecisionState = "chosen" | "rejected" | "open" | "replaced";

export interface DecisionNode {
  id: string;
  when: string;
  weight: DecisionWeight;
  state: DecisionState;
  title: string;
  why: string;
  owner: string;
  source: string;
}

/** Per project, oldest first: the chain of decisions that led to the project's current state. */
export const DECISION_CHAINS: Record<
  string,
  { now: string; updated: string; nodes: ReadonlyArray<DecisionNode> }
> = {
  codi: {
    now: "Lighthouse 原型在 PR #14 等试用，地图 #6 下 8 张票。",
    updated: "今天 09:00",
    nodes: [
      {
        id: "c1",
        when: "10-12",
        weight: "key",
        state: "chosen",
        title: "fork t3code，改名 Codi",
        why: "多 harness 已经现成，不重写。",
        owner: "Tonic",
        source: "codi#1",
      },
      {
        id: "c2",
        when: "10-28",
        weight: "minor",
        state: "chosen",
        title: "Worker 线程沿用 Codi thread",
        why: "不另起执行模型。",
        owner: "Tonic",
        source: "W7",
      },
      {
        id: "c3",
        when: "11-02",
        weight: "key",
        state: "chosen",
        title: "Lighthouse 架在 Codi 之上，Codi 只当 Worker 池",
        why: "公司层状态和权限不进 Codi 服务器。",
        owner: "Tonic",
        source: "#6",
      },
      {
        id: "c4",
        when: "11-02",
        weight: "major",
        state: "rejected",
        title: "全部塞进 Codi 服务器",
        why: "权限和多租户会污染单机模型。",
        owner: "Tonic",
        source: "#6",
      },
      {
        id: "c5",
        when: "11-02",
        weight: "major",
        state: "chosen",
        title: "工作区既是权限边界也是筛选",
        why: "绑定存在 Lighthouse 的表里。",
        owner: "Tonic",
        source: "#15",
      },
      {
        id: "c6",
        when: "未定",
        weight: "major",
        state: "open",
        title: "项目幕僚长每项目一个，还是每人一个",
        why: "建议每项目一个，加每人一个私人幕僚长。",
        owner: "Tonic",
        source: "#15",
      },
    ],
  },
  site: {
    now: "价格页 Safari 错位已修，PR #88 CI 绿，等合并。",
    updated: "今天 08:40",
    nodes: [
      {
        id: "s1",
        when: "09-03",
        weight: "key",
        state: "chosen",
        title: "官网改用 Astro 静态站",
        why: "首屏快，内容同学能直接改 md。",
        owner: "Keting Chen",
        source: "site#2",
      },
      {
        id: "s2",
        when: "09-20",
        weight: "minor",
        state: "replaced",
        title: "价格页用 CSS Grid 双列",
        why: "Safari 16 下错位，被 s4 取代。",
        owner: "Keting Chen",
        source: "W3",
      },
      {
        id: "s3",
        when: "10-15",
        weight: "major",
        state: "chosen",
        title: "Q4 目标：转化 +15%",
        why: "OKR 对齐。",
        owner: "Tonic",
        source: "OKR",
      },
      {
        id: "s4",
        when: "11-01",
        weight: "minor",
        state: "chosen",
        title: "价格页改回 flex 布局",
        why: "修 Safari，PR #88。",
        owner: "Keting Chen",
        source: "W3 · site#12",
      },
    ],
  },
  app: {
    now: "家里电脑离线 2 小时，app#41 挂起，PR #140 CI 红。",
    updated: "今天 09:05",
    nodes: [
      {
        id: "a1",
        when: "08-30",
        weight: "key",
        state: "chosen",
        title: "移动端用 Expo",
        why: "和 Codi mobile 共享代码。",
        owner: "Max",
        source: "app#1",
      },
      {
        id: "a2",
        when: "10-10",
        weight: "major",
        state: "chosen",
        title: "Worker 跑在家里电脑",
        why: "省云容器费用。",
        owner: "Max",
        source: "W11",
      },
      {
        id: "a3",
        when: "今天",
        weight: "major",
        state: "open",
        title: "app#41 改派到云容器？",
        why: "家里电脑离线，等你定。",
        owner: "Max",
        source: "W11 · app#41",
      },
    ],
  },
  gripper: {
    now: "单指触觉标定中，PR #12 等评审。",
    updated: "昨天 18:00",
    nodes: [
      {
        id: "g1",
        when: "06-20",
        weight: "key",
        state: "chosen",
        title: "夹爪走电驱，不用气动",
        why: "比赛场地没有气源。",
        owner: "Keting Chen",
        source: "gripper#1",
      },
      {
        id: "g2",
        when: "07-11",
        weight: "key",
        state: "chosen",
        title: "先做单指触觉，再做整手",
        why: "先验证传感器精度。",
        owner: "Keting Chen",
        source: "gripper#4",
      },
      {
        id: "g3",
        when: "08-02",
        weight: "minor",
        state: "chosen",
        title: "主控用 ESP32-S3",
        why: "现货多，社区成熟。",
        owner: "Keting Chen",
        source: "W21",
      },
      {
        id: "g4",
        when: "10-30",
        weight: "major",
        state: "chosen",
        title: "标定数据存仓库 LFS",
        why: "评审时能复现。",
        owner: "Keting Chen",
        source: "W21 · gripper#12",
      },
    ],
  },
  tactile: {
    now: "护膝 Demo 方案未定，PoC 路线在写。",
    updated: "今天 07:30",
    nodes: [
      {
        id: "t1",
        when: "09-01",
        weight: "key",
        state: "chosen",
        title: "触觉阵列 16×16",
        why: "成本和分辨率折中。",
        owner: "Max",
        source: "tactile#1",
      },
      {
        id: "t2",
        when: "10-05",
        weight: "minor",
        state: "rejected",
        title: "柔性 PCB 自己打样",
        why: "周期太长，外包。",
        owner: "Max",
        source: "W24",
      },
      {
        id: "t3",
        when: "未定",
        weight: "major",
        state: "open",
        title: "护膝 Demo 先做电阻还是电容",
        why: "电阻便宜，电容更稳。",
        owner: "Max",
        source: "tactile#7",
      },
    ],
  },
};
