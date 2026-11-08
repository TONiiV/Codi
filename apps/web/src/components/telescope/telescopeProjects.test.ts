import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
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

const chief = (projectId: string, kind: Telescope.AgentKind = "chief_agent"): Telescope.Agent => ({
  id: Telescope.AgentId.make(`${kind}-${projectId}`),
  workspaceId,
  ownerSubjectId: "me",
  kind,
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
      [chief("site", "custom"), chief("app"), chief("docs")],
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
      {
        project: "local:app",
        chief: "chief_agent-app",
        detail: "你是负责人 · 直接做：开工单、合并 PR",
      },
      { project: "local:docs", chief: "chief_agent-docs", detail: "你是成员 · 直接做：开工单" },
      { project: "local:site", chief: null, detail: "你是成员 · 还没有你的 Chief Agent" },
    ]);
    const admin = { ...self, role: "admin" as const };
    expect(boundProjectRows([binding("docs")], [], [chief("docs")], admin)[0]?.detail).toBe(
      "你是管理员 · 直接做：开工单、合并 PR",
    );
  });

  it("offers each live Code project group that no workspace has taken, bound whole", () => {
    const repo = (name: string) => ({
      canonicalKey: `github.com/acme/${name}`,
      locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl: name },
    });
    const groups = buildSidebarProjectSnapshots({
      projects: [
        project("free"),
        project("scratch", { isScratch: true }),
        project("archived", { archivedAt: AT }),
        project("taken"),
        project("taken", {}, remote),
        project("app", { repositoryIdentity: repo("app") }),
        project("app", { repositoryIdentity: repo("app") }, remote),
        project("lib", { repositoryIdentity: repo("lib") }),
        project("lib", { repositoryIdentity: repo("lib") }, remote),
      ],
      settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
      primaryEnvironmentId: local,
      resolveEnvironmentLabel: (id) => (id === local ? "本机" : null),
    });
    const elsewhere = {
      ...binding("app", undefined, remote),
      workspaceId: Telescope.WorkspaceId.make("other"),
    };
    const unlinked = unlinkedProjects(groups, [binding("taken"), elsewhere], self);
    expect(unlinked.map(({ machines, binds }) => ({ machines, binds }))).toEqual([
      {
        machines: ["本机"],
        binds: [{ workspaceId, environmentId: local, projectId: "free", leadSubjectId: "me" }],
      },
      {
        machines: ["remote"],
        binds: [{ workspaceId, environmentId: remote, projectId: "taken", leadSubjectId: "me" }],
      },
      {
        machines: ["本机", "remote"],
        binds: [
          { workspaceId, environmentId: local, projectId: "lib", leadSubjectId: "me" },
          { workspaceId, environmentId: remote, projectId: "lib", leadSubjectId: "me" },
        ],
      },
    ]);
  });
});
