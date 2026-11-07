import { Telescope } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  GitBranchIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MessagesSquareIcon,
  UsersRoundIcon,
} from "lucide-react";

import { isAppModalPage, peekAppModalReturnHref, TELESCOPE_PATH } from "../sidebar/mainAppLocation";

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

function parseTelescopeView(raw: unknown): TelescopeView {
  return TELESCOPE_VIEWS.find((view) => view.id === raw)?.id ?? "chats";
}

export type TasksLayout = "table" | "board";

/** The tasks layout rides along every Telescope URL, so switching views keeps it. */
type TelescopeSearch = {
  readonly view: TelescopeView;
  readonly layout?: "board";
  /** The task whose detail drawer is open. */
  readonly task?: Telescope.TaskId;
};

const decodeTaskId = Schema.decodeUnknownOption(Telescope.TaskId);

export function telescopeSearch(
  view: TelescopeView,
  layout: TasksLayout,
  task?: Telescope.TaskId,
): TelescopeSearch {
  return {
    view,
    ...(layout === "board" ? { layout } : {}),
    ...(task === undefined ? {} : { task }),
  };
}

export function parseTelescopeSearch(raw: Record<string, unknown>): TelescopeSearch {
  const layout = raw.layout === "board" ? "board" : "table";
  return telescopeSearch(
    parseTelescopeView(raw.view),
    layout,
    Option.getOrUndefined(decodeTaskId(raw.task)),
  );
}

export function telescopeViewEntry(view: TelescopeView) {
  return TELESCOPE_VIEWS.find((entry) => entry.id === view) ?? TELESCOPE_VIEWS[0];
}

/**
 * The Telescope search in effect: its own route's, or that of the route a Settings or Usage modal
 * was opened from, so the shell stays put behind the modal.
 */
export function telescopeSearchAt(
  pathname: string,
  search: Record<string, unknown>,
  modalReturnHref: string | null,
): TelescopeSearch | null {
  if (pathname === TELESCOPE_PATH) return parseTelescopeSearch(search);
  if (!isAppModalPage(pathname) || modalReturnHref === null) return null;
  const opener = new URL(modalReturnHref, "http://codi.local");
  return opener.pathname === TELESCOPE_PATH
    ? parseTelescopeSearch(Object.fromEntries(opener.searchParams))
    : null;
}

/** The Telescope view in effect, or null while the app is in Code (Microscope). */
export function useTelescopeView(): TelescopeView | null {
  return useLocation({
    select: (location) =>
      telescopeSearchAt(location.pathname, location.search, peekAppModalReturnHref())?.view ?? null,
  });
}

export function useTasksLayout(): TasksLayout {
  return useLocation({
    select: (location) =>
      telescopeSearchAt(location.pathname, location.search, peekAppModalReturnHref())?.layout ??
      "table",
  });
}

export function useTaskDrawerId(): Telescope.TaskId | null {
  return useLocation({
    select: (location) =>
      telescopeSearchAt(location.pathname, location.search, peekAppModalReturnHref())?.task ?? null,
  });
}
