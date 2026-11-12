import { Telescope } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  LayoutDashboardIcon,
  ListChecksIcon,
  MessagesSquareIcon,
  UsersRoundIcon,
} from "lucide-react";

import { isAppModalPage, peekAppModalReturnHref, TELESCOPE_PATH } from "../sidebar/mainAppLocation";

const TELESCOPE_VIEWS = [
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
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    emptyTitle: "还没有数据",
    emptyDescription:
      "合并的 PR、卡住的工单和 token 用量会汇总在这里。agents 在项目里开始干活后，数字自动更新。",
  },
] as const;

export type TelescopeView = (typeof TELESCOPE_VIEWS)[number]["id"];

// 对话 and My Teams are paused while Telescope focuses on the task board; old links land on 任务.
const PAUSED_VIEWS: ReadonlySet<TelescopeView> = new Set(["chats", "teams"]);
export const VISIBLE_TELESCOPE_VIEWS = TELESCOPE_VIEWS.filter((view) => !PAUSED_VIEWS.has(view.id));

function parseTelescopeView(raw: unknown): TelescopeView {
  return VISIBLE_TELESCOPE_VIEWS.find((view) => view.id === raw)?.id ?? "tasks";
}

const TASKS_LAYOUTS = ["table", "board", "decisions"] as const;
export type TasksLayout = (typeof TASKS_LAYOUTS)[number];

/** The tasks tab rides along every Telescope URL, so switching views keeps it. */
type TelescopeSearch = {
  readonly view: TelescopeView;
  readonly layout?: Exclude<TasksLayout, "table">;
  /** The task whose detail drawer is open. */
  readonly task?: Telescope.TaskId;
  /** The agent whose chat is open in 对话. */
  readonly agent?: Telescope.AgentId;
};

const decodeTaskId = Schema.decodeUnknownOption(Telescope.TaskId);
const decodeAgentId = Schema.decodeUnknownOption(Telescope.AgentId);

export function telescopeSearch(
  view: TelescopeView,
  layout: TasksLayout,
  task?: Telescope.TaskId,
  agent?: Telescope.AgentId,
): TelescopeSearch {
  return {
    view,
    ...(layout === "table" ? {} : { layout }),
    ...(task === undefined ? {} : { task }),
    ...(agent === undefined ? {} : { agent }),
  };
}

export function parseTelescopeSearch(raw: Record<string, unknown>): TelescopeSearch {
  // 决定 was its own view before it became a tab of 任务; old links still land on it.
  const legacyDecisions = raw.view === "decisions";
  return telescopeSearch(
    legacyDecisions ? "tasks" : parseTelescopeView(raw.view),
    legacyDecisions ? "decisions" : (TASKS_LAYOUTS.find((id) => id === raw.layout) ?? "table"),
    Option.getOrUndefined(decodeTaskId(raw.task)),
    Option.getOrUndefined(decodeAgentId(raw.agent)),
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

export function useTaskParam(): Telescope.TaskId | null {
  return useLocation({
    select: (location) =>
      telescopeSearchAt(location.pathname, location.search, peekAppModalReturnHref())?.task ?? null,
  });
}

export function useChatAgentId(): Telescope.AgentId | null {
  return useLocation({
    select: (location) =>
      telescopeSearchAt(location.pathname, location.search, peekAppModalReturnHref())?.agent ??
      null,
  });
}

/** Re-renders only when this agent's chat opens or closes, not on every switch. */
export function useIsChatAgentSelected(agentId: Telescope.AgentId): boolean {
  return useLocation({
    select: (location) =>
      telescopeSearchAt(location.pathname, location.search, peekAppModalReturnHref())?.agent ===
      agentId,
  });
}
