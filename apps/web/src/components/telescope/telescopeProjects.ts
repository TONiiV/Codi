import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { cappedPowers, ownerCanMergePRs } from "@t3tools/client-runtime/telescope/agents";
import { boundWorkspaceIds } from "@t3tools/client-runtime/telescope/workspaces";
import type { Telescope } from "@t3tools/contracts";

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
    const role = binding.leadSubjectId === self.subjectId ? "你是负责人" : "你是成员";
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

/** Live Code projects bound to no workspace yet. */
export function unlinkedProjects(
  projects: ReadonlyArray<EnvironmentProject>,
  bindings: ReadonlyArray<Telescope.ProjectBinding>,
) {
  return projects.filter(
    (project) =>
      project.isScratch !== true &&
      !project.archivedAt &&
      boundWorkspaceIds(bindings, [{ environmentId: project.environmentId, projectId: project.id }])
        .size === 0,
  );
}
