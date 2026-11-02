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
