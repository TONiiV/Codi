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

/**
 * Live Code project groups that no workspace mounts. 接入 turns one into a Telescope project
 * the caller leads, holding the whole group, so it is also what a first-run flow submits.
 */
export function unlinkedProjects(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
  mounted: ReadonlyArray<WorkspaceMount>,
  self: Telescope.Member,
) {
  return groups
    .filter(
      (group) =>
        group.isScratch !== true &&
        !group.archived &&
        boundWorkspaceIds(mounted, group.memberProjectRefs).size === 0,
    )
    .map((group) => ({
      group,
      machines: [
        ...new Set(group.memberProjects.map((m) => m.environmentLabel ?? m.environmentId)),
      ],
      input: {
        workspaceId: self.workspaceId,
        name: group.displayName,
        leadSubjectId: self.subjectId,
        mounts: group.memberProjectRefs.map(({ environmentId, projectId }) => ({
          environmentId,
          projectId,
        })),
      },
    }));
}
