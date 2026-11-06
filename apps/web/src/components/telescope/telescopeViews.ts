import { useLocation } from "@tanstack/react-router";
import {
  GitBranchIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MessagesSquareIcon,
  UsersRoundIcon,
} from "lucide-react";

export const TELESCOPE_PATH = "/telescope";

export const TELESCOPE_VIEWS = [
  {
    id: "chats",
    label: "对话",
    icon: MessagesSquareIcon,
    emptyTitle: "还没有对话",
    emptyDescription:
      "你和个人助理、各个 agent 的对话会列在这里。你可以先开口，agent 需要你时也会来找你。",
  },
  {
    id: "teams",
    label: "My Teams",
    icon: UsersRoundIcon,
    emptyTitle: "还没有团队",
    emptyDescription:
      "你的 agents 和它们会用的 Skills 会列在这里。添加第一个 agent 后，团队就从这里长出来。",
  },
  {
    id: "tasks",
    label: "任务",
    icon: ListChecksIcon,
    emptyTitle: "还没有任务",
    emptyDescription:
      "这个工作区还没有任务。任务由你或你的 agents 创建，所有成员实时看到同一块板。",
  },
  {
    id: "decisions",
    label: "决定",
    icon: GitBranchIcon,
    emptyTitle: "还没有决定",
    emptyDescription:
      "这个工作区还没有记下决定。你或 agents 拍板的事会连同理由记在这里，所有成员都查得到。",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    emptyTitle: "还没有数据",
    emptyDescription:
      "合并的 PR、卡住的工单和 token 用量会汇总在这里。agents 在项目里开始干活后，数字自动更新。",
  },
] as const;

export type TelescopeView = (typeof TELESCOPE_VIEWS)[number]["id"];

export function parseTelescopeView(raw: unknown): TelescopeView {
  return TELESCOPE_VIEWS.find((view) => view.id === raw)?.id ?? "chats";
}

export function telescopeViewEntry(view: TelescopeView) {
  return TELESCOPE_VIEWS.find((entry) => entry.id === view) ?? TELESCOPE_VIEWS[0];
}

/** The Telescope view on screen, or null while the app is in Code (Microscope). */
export function useTelescopeView(): TelescopeView | null {
  return useLocation({
    select: (location) =>
      location.pathname === TELESCOPE_PATH ? parseTelescopeView(location.search.view) : null,
  });
}
