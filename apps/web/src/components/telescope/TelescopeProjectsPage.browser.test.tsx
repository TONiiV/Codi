import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import { TelescopeProjectsPage } from "./TelescopeProjectsPage";

const AT = "2026-11-08T00:00:00.000Z";
const environmentId = EnvironmentId.make("local");
const workspaceId = Telescope.WorkspaceId.make("ws");
const self: Telescope.Member = {
  workspaceId,
  subjectId: "me",
  displayName: "Me",
  role: "admin",
  joinedAt: AT,
};
const workspace: Telescope.Workspace = {
  id: workspaceId,
  kind: "enterprise",
  name: "ws",
  createdAt: AT,
  createdBy: "me",
};
const codeProject = (id: string): EnvironmentProject => ({
  id: ProjectId.make(id),
  environmentId,
  title: id,
  workspaceRoot: `/code/${id}`,
  defaultModelSelection: null,
  scripts: [],
  createdAt: AT,
  updatedAt: AT,
});
const mount = (id: string): Telescope.ProjectMount => ({
  environmentId,
  projectId: ProjectId.make(id),
});

const fake = vi.hoisted(() => ({
  calls: [] as unknown[],
  projects: [] as ReadonlyArray<unknown>,
  summary: null as unknown,
}));

function setup(options: {
  projects?: ReadonlyArray<Telescope.Project>;
  summary?: { projects: ReadonlyArray<Telescope.ProjectBindingSummary> } | null;
}) {
  fake.calls = [];
  fake.projects = options.projects ?? [];
  fake.summary = options.summary === undefined ? { projects: [] } : options.summary;
}

vi.mock(import("./telescopeState"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useTelescopeWorkspaces: () => ({ environmentId, current: workspace, bindings: [] }),
    telescope: {
      ...actual.telescope,
      get: () => ({ key: "get" }),
      projects: () => ({ key: "projects" }),
      bindingSummary: () => ({ key: "summary" }),
      createProject: {
        ...actual.telescope.createProject,
        permissionAtom: () => Atom.make(true),
      },
    },
  } as never;
});

vi.mock(import("./myTeamsShared"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    telescopeAgents: {
      ...actual.telescopeAgents,
      listMine: () => ({ key: "mine" }),
      update: { ...actual.telescopeAgents.update, permissionAtom: () => Atom.make(true) },
    },
  } as never;
});

vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((atom: { key: string } | null) => {
    const data =
      atom?.key === "get"
        ? { workspace, self }
        : atom?.key === "mine"
          ? { agents: [] }
          : atom?.key === "projects"
            ? { projects: fake.projects }
            : fake.summary;
    return {
      data,
      dataUpdatedAt: 0,
      error: data === null ? "offline" : null,
      failure: null,
      isPending: false,
      isSuccess: data !== null,
      refresh: () => {},
    };
  }) as never,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: () => [codeProject("free"), codeProject("held")],
}));

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentIdentities: () => [],
}));

vi.mock(import("../settings/useSettingsProjectGroups"), () => ({
  useSettingsProjectGroups: () =>
    buildSidebarProjectSnapshots({
      projects: [codeProject("free"), codeProject("held")],
      settings: { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} },
      primaryEnvironmentId: environmentId,
      resolveEnvironmentLabel: () => null,
    }),
}));

vi.mock(import("../../state/use-atom-command"), () => ({
  // Never settles, so the row stays pending for as long as the test looks.
  useAtomCommand: (_command, _label) => (request: unknown) => {
    fake.calls.push(request);
    return new Promise(() => {});
  },
}));

const held = {
  id: Telescope.TelescopeProjectId.make("t-held"),
  workspaceId,
  name: "held",
  mounts: [mount("held")],
  createdAt: AT,
} satisfies Telescope.Project;

describe("TelescopeProjectsPage 接入", () => {
  it("sends one createProject for a double click while the first is in flight", async () => {
    setup({});
    await using _screen = await render(<TelescopeProjectsPage />);
    const connect = page.getByRole("button", { name: "接入 free" });
    await userEvent.dblClick(connect);
    await expect.element(connect).toBeDisabled();
    expect(fake.calls).toHaveLength(1);
  });

  it("does not offer a directory the workspace already mounts", async () => {
    setup({ projects: [held] });
    await using _screen = await render(<TelescopeProjectsPage />);
    await expect.element(page.getByRole("button", { name: "接入 free" })).toBeVisible();
    expect(page.getByRole("button", { name: "接入 held" }).query()).toBeNull();
  });

  it("offers nothing to connect until the binding summary has loaded", async () => {
    setup({ summary: null });
    await using _screen = await render(<TelescopeProjectsPage />);
    await expect.element(page.getByRole("heading", { name: "项目", level: 2 })).toBeVisible();
    expect(page.getByRole("button", { name: /^接入 / }).query()).toBeNull();
  });
});
