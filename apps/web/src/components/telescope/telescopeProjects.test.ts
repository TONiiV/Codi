import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import { projectRows, unlinkedProjects } from "./telescopeProjects";

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

const mount = (id: string, environmentId = local): Telescope.ProjectMount => ({
  environmentId,
  projectId: ProjectId.make(id),
});

const tProject = (
  name: string,
  mounts: ReadonlyArray<Telescope.ProjectMount>,
  leadSubjectId?: string,
): Telescope.Project => ({
  id: Telescope.TelescopeProjectId.make(`t-${name}`),
  workspaceId,
  name,
  ...(leadSubjectId === undefined ? {} : { leadSubjectId }),
  mounts,
  createdAt: AT,
});

const taken = (id: string, environmentId = local, inWorkspace = workspaceId) => ({
  workspaceId: inWorkspace,
  ...mount(id, environmentId),
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
  it("joins each Telescope project's mounts to their Code projects and the caller's Chief Agent", () => {
    const projects = [
      tProject("Shop", [mount("app"), mount("site", remote)], "me"),
      tProject("Docs", [mount("docs")], "someone"),
      tProject("Empty", []),
    ];
    const rows = projectRows(
      projects,
      [project("app"), project("docs"), project("site", {}, remote), project("site")],
      [chief("site", "custom"), chief("app"), chief("docs")],
      self,
    );
    expect(
      rows.map((row) => ({
        name: row.project.name,
        mounts: row.mounts.map((entry) => ({
          code: entry.code === undefined ? null : `${entry.code.environmentId}:${entry.code.id}`,
          chief: entry.chief?.id ?? null,
          detail: entry.detail,
        })),
      })),
    ).toEqual([
      {
        name: "Shop",
        mounts: [
          {
            code: "local:app",
            chief: "chief_agent-app",
            detail: "你是负责人 · 直接做：开工单、合并 PR",
          },
          { code: "remote:site", chief: null, detail: "你是负责人 · 还没有你的 Chief Agent" },
        ],
      },
      {
        name: "Docs",
        mounts: [
          { code: "local:docs", chief: "chief_agent-docs", detail: "你是成员 · 直接做：开工单" },
        ],
      },
      { name: "Empty", mounts: [] },
    ]);
    const admin = { ...self, role: "admin" as const };
    const adminRows = projectRows([tProject("Docs", [mount("docs")])], [], [chief("docs")], admin);
    expect(adminRows[0]?.mounts[0]?.detail).toBe("你是管理员 · 直接做：开工单、合并 PR");
  });

  it("offers each live Code project group that no workspace has taken, as a new project it leads", () => {
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
    const elsewhere = taken("app", remote, Telescope.WorkspaceId.make("other"));
    const unlinked = unlinkedProjects(groups, [taken("taken"), elsewhere], [], self);
    expect(unlinked.map(({ input }) => input)).toEqual([
      { workspaceId, name: "free", leadSubjectId: "me", mounts: [mount("free")] },
      { workspaceId, name: "taken", leadSubjectId: "me", mounts: [mount("taken", remote)] },
      {
        workspaceId,
        name: "lib",
        leadSubjectId: "me",
        mounts: [mount("lib"), mount("lib", remote)],
      },
    ]);
    // A project this workspace already holds is taken even before the binding summary loads.
    const held = unlinkedProjects(groups, [], [tProject("Held", [mount("free")])], self);
    expect(held.map(({ group }) => group.displayName)).toEqual(["taken", "taken", "app", "lib"]);
  });
});
