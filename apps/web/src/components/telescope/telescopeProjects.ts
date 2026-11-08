import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { cappedPowers, ownerCanMergePRs } from "@t3tools/client-runtime/telescope/agents";
import { boundWorkspaceIds } from "@t3tools/client-runtime/telescope/workspaces";
import type { Telescope } from "@t3tools/contracts";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { powerSummary } from "./myTeamsShared";

/** One row per project bound to the workspace: its Code project and the caller's Chief Agent there. */
export function boundProjectRows(
  bindings: ReadonlyArray<Telescope.ProjectBinding>,
  projects: ReadonlyArray<EnvironmentProject>,
  agents: ReadonlyArray<Telescope.Agent>,
  self: Telescope.Member,
) {
  return bindings.map((binding) => {
    const chief = agents.find(
      (agent) => agent.kind === "chief_agent" && agent.projectId === binding.projectId,
    );
    const role =
      binding.leadSubjectId === self.subjectId
        ? "你是负责人"
        : self.role === "admin"
          ? "你是管理员"
          : "你是成员";
    const powers =
      chief && cappedPowers(chief.standingPowers, ownerCanMergePRs(self, chief, bindings));
    return {
      binding,
      project: projects.find(
        (project) =>
          project.environmentId === binding.environmentId && project.id === binding.projectId,
      ),
      chief,
      detail: `${role} · ${powers ? `直接做：${powerSummary(powers)}` : "还没有你的 Chief Agent"}`,
    };
  });
}

/** Live Code project groups with no member bound to any workspace; 接入 binds the whole group, the caller as lead. */
export function unlinkedProjects(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
  bindings: ReadonlyArray<Telescope.ProjectBinding>,
  self: Telescope.Member,
) {
  return groups
    .filter(
      (group) =>
        group.isScratch !== true &&
        !group.archived &&
        boundWorkspaceIds(bindings, group.memberProjectRefs).size === 0,
    )
    .map((group) => ({
      group,
      machines: [
        ...new Set(group.memberProjects.map((m) => m.environmentLabel ?? m.environmentId)),
      ],
      binds: group.memberProjectRefs.map((ref) => ({
        workspaceId: self.workspaceId,
        environmentId: ref.environmentId,
        projectId: ref.projectId,
        leadSubjectId: self.subjectId,
      })),
    }));
}
