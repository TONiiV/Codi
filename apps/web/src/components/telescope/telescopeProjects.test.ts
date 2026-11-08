import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { boundProjectRows, unlinkedProjects } from "./telescopeProjects";

const AT = "2026-11-08T00:00:00.000Z";
const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const workspaceId = Telescope.WorkspaceId.make("ws");
const self: Telescope.Member = {
  workspaceId,
  subjectId: "me",
  displayName: "Me",
  role: "member",
  joinedAt: AT,
};

const project = (
  id: string,
  extra: Partial<EnvironmentProject> = {},
  environmentId = local,
): EnvironmentProject => ({
  id: ProjectId.make(id),
  environmentId,
  title: id,
  workspaceRoot: `/code/${id}`,
  defaultModelSelection: null,
  scripts: [],
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const binding = (
  id: string,
  leadSubjectId?: string,
  environmentId = local,
): Telescope.ProjectBinding => ({
  workspaceId,
  environmentId,
  projectId: ProjectId.make(id),
  ...(leadSubjectId === undefined ? {} : { leadSubjectId }),
});

const chief = (projectId: string): Telescope.Agent => ({
  id: Telescope.AgentId.make(`chief-${projectId}`),
  workspaceId,
  ownerSubjectId: "me",
  kind: "chief_agent",
  projectId: ProjectId.make(projectId),
  name: `${projectId} Chief Agent`,
  standingPowers: {
    openTickets: true,
    dispatchWorkers: false,
    answerMembers: false,
    mergePRs: true,
  },
  exposure: "hidden",
  syncWithBoard: true,
  dispatchMode: "inbox",
  channels: [],
  createdAt: AT,
  updatedAt: AT,
});

describe("telescope projects page", () => {
  it("joins each bound project to its Code project and the caller's Chief Agent there", () => {
    const bindings = [binding("app", "me"), binding("docs", "someone"), binding("site")];
    const rows = boundProjectRows(
      bindings,
      [project("app"), project("docs", {}, remote), project("docs"), project("site")],
      [chief("app"), chief("docs")],
      self,
    );
    expect(
      rows.map((row) => ({
        project:
          row.project === undefined ? null : `${row.project.environmentId}:${row.project.id}`,
        chief: row.chief?.id ?? null,
        detail: row.detail,
      })),
    ).toEqual([
      { project: "local:app", chief: "chief-app", detail: "你是负责人 · 直接做：开工单、合并 PR" },
      { project: "local:docs", chief: "chief-docs", detail: "你是成员 · 直接做：开工单" },
      { project: "local:site", chief: null, detail: "你是成员 · 还没有你的 Chief Agent" },
    ]);
  });

  it("offers only live Code projects that no workspace has taken", () => {
    const unlinked = unlinkedProjects(
      [
        project("free"),
        project("scratch", { isScratch: true }),
        project("archived", { archivedAt: AT }),
        project("taken"),
        project("taken", {}, remote),
      ],
      [binding("taken", undefined, local)],
    );
    expect(unlinked.map((entry) => `${entry.environmentId}:${entry.id}`)).toEqual([
      "local:free",
      "remote:taken",
    ]);
  });
});
