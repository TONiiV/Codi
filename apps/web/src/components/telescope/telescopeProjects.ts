import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { cappedPowers, ownerCanMergePRs } from "@t3tools/client-runtime/telescope/agents";
import {
  boundWorkspaceIds,
  type WorkspaceMount,
} from "@t3tools/client-runtime/telescope/workspaces";
import type { Telescope } from "@t3tools/contracts";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { powerSummary } from "./myTeamsShared";

/** One row per Telescope project; each mount joins its Code project and the caller's Chief Agent there. */
export function projectRows(
  projects: ReadonlyArray<Telescope.Project>,
  codeProjects: ReadonlyArray<EnvironmentProject>,
  agents: ReadonlyArray<Telescope.Agent>,
  self: Telescope.Member,
) {
  return projects.map((project) => {
    const role =
      project.leadSubjectId === self.subjectId
        ? "你是负责人"
        : self.role === "admin"
          ? "你是管理员"
          : "你是成员";
    return {
      project,
      mounts: project.mounts.map((mount) => {
        const chief = agents.find(
          (agent) => agent.kind === "chief_agent" && agent.projectId === mount.projectId,
        );
        const powers =
          chief && cappedPowers(chief.standingPowers, ownerCanMergePRs(self, chief, projects));
        return {
          mount,
          code: codeProjects.find(
            (code) => code.environmentId === mount.environmentId && code.id === mount.projectId,
          ),
          chief,
          detail: `${role} · ${powers ? `直接做：${powerSummary(powers)}` : "还没有你的 Chief Agent"}`,
        };
      }),
    };
  });
}

/** How a project's repository reads in the page; a project with no remote is a local directory. */
export const repositoryLabel = (project: Pick<SidebarProjectSnapshot, "repositoryIdentity">) =>
  project.repositoryIdentity?.canonicalKey ?? "本地目录";

/**
 * Live Code project groups that nothing in the workspace mounts, from the environment's binding
 * summary or the workspace's own projects. 接入 turns one into a project the caller leads.
 */
export function unlinkedProjects(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
  mounted: ReadonlyArray<WorkspaceMount>,
  projects: ReadonlyArray<Telescope.Project>,
  self: Telescope.Member,
) {
  const taken = [
    ...mounted,
    ...projects.flatMap(({ workspaceId, mounts }) =>
      mounts.map((mount) => ({ workspaceId, ...mount })),
    ),
  ];
  return groups
    .filter(
      (group) =>
        group.isScratch !== true &&
        !group.archived &&
        boundWorkspaceIds(taken, group.memberProjectRefs).size === 0,
    )
    .map((group) => ({
      group,
      input: {
        workspaceId: self.workspaceId,
        name: group.displayName,
        leadSubjectId: self.subjectId,
        mounts: group.memberProjectRefs,
      },
    }));
}
