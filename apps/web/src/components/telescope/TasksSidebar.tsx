import { type Telescope } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useEnvironmentQuery } from "../../state/query";
import { TELESCOPE_PATH } from "../sidebar/mainAppLocation";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { LoadFailed, SidebarNote } from "./TelescopeSidebarNotes";
import { type BoardTarget, useBoardTarget } from "./TasksParts";
import { telescope } from "./telescopeState";
import {
  knownProjectId,
  telescopeSearch,
  useTasksLayout,
  useTasksProjectId,
} from "./telescopeViews";

/** The workspace's projects and the one 任务 is filtered to; a project it no longer has is 全部. */
export function useTasksProject(target: BoardTarget | null) {
  const projects = useEnvironmentQuery(
    target === null
      ? null
      : telescope.projects({
          environmentId: target.environmentId,
          input: { workspaceId: target.workspaceId },
        }),
  );
  const list = projects.data?.projects ?? null;
  return { projects, list, selected: knownProjectId(useTasksProjectId(), list) };
}

/** The 任务 sidebar body: 全部, then each project of the current workspace. */
export function TasksSidebar() {
  const target = useBoardTarget();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const layout = useTasksLayout();
  const { projects, list, selected } = useTasksProject(target);
  if (target === null) return null;
  const pick = (project?: Telescope.TelescopeProjectId) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: TELESCOPE_PATH,
      search: telescopeSearch("tasks", layout, undefined, undefined, project),
    });
  };
  const row = (label: string, project?: Telescope.TelescopeProjectId) => (
    <SidebarMenuItem key={project ?? "all"}>
      <SidebarMenuButton
        isActive={selected === project}
        aria-current={selected === project ? "page" : undefined}
        onClick={() => pick(project)}
      >
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
  return (
    <>
      <SidebarMenu>
        {row("全部")}
        {list?.map((project) => row(project.name, project.id))}
      </SidebarMenu>
      {list === null ? (
        projects.error === null ? (
          <div className="flex justify-center py-3">
            <Spinner tone="muted" />
          </div>
        ) : (
          <LoadFailed onRetry={projects.refresh} />
        )
      ) : list.length === 0 ? (
        <SidebarNote>这个工作区还没有项目。</SidebarNote>
      ) : null}
    </>
  );
}
