import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import { Atom, AsyncResult, AtomRegistry } from "effect/reactivity";
import { useSyncExternalStore } from "react";
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
  settle: [] as Array<(result: unknown) => void>,
  role: "admin" as Telescope.Member["role"],
  agents: [] as ReadonlyArray<Telescope.Agent>,
  environments: [] as ReadonlyArray<{ environmentId: EnvironmentId; label: string }>,
  version: 0,
  listeners: new Set<() => void>(),
  code: [] as ReadonlyArray<string>,
  projects: [] as ReadonlyArray<unknown>,
  summary: null as unknown,
}));

// The page reads through hooks, so new data has to arrive the way it does in the app: by notifying.
function publish(next: {
  projects?: ReadonlyArray<Telescope.Project>;
  code?: ReadonlyArray<string>;
}) {
  Object.assign(fake, next);
  fake.version += 1;
  fake.listeners.forEach((listener) => listener());
}

function setup(options: {
  role?: Telescope.Member["role"];
  agents?: ReadonlyArray<Telescope.Agent>;
  environments?: ReadonlyArray<{ environmentId: EnvironmentId; label: string }>;
  projects?: ReadonlyArray<Telescope.Project>;
  summary?: { projects: ReadonlyArray<Telescope.ProjectBindingSummary> } | null;
}) {
  fake.calls = [];
  fake.settle = [];
  fake.role = options.role ?? "admin";
  fake.agents = options.agents ?? [];
  fake.environments = options.environments ?? [];
  fake.version = 0;
  fake.listeners.clear();
  fake.code = ["free", "held"];
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
    useSyncExternalStore(
      (listener) => (fake.listeners.add(listener), () => void fake.listeners.delete(listener)),
      () => fake.version,
    );
    const data =
      atom?.key === "get"
        ? { workspace, self: { ...self, role: fake.role } }
        : atom?.key === "mine"
          ? { agents: fake.agents }
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
  useEnvironmentIdentities: () => fake.environments,
}));

vi.mock(import("../settings/useSettingsProjectGroups"), () => ({
  useSettingsProjectGroups: () =>
    buildSidebarProjectSnapshots({
      projects: fake.code.map(codeProject),
      settings: { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} },
      primaryEnvironmentId: environmentId,
      resolveEnvironmentLabel: () => null,
    }),
}));

vi.mock(import("../../state/use-atom-command"), () => ({
  // Stays pending until the test settles the call, so it picks the moment the page sees the result.
  useAtomCommand: (_command, _label) => (request: unknown) => {
    fake.calls.push(request);
    return new Promise((resolve) => fake.settle.push(resolve as never));
  },
}));

const held = {
  id: Telescope.TelescopeProjectId.make("t-held"),
  workspaceId,
  name: "held",
  mounts: [mount("held")],
  createdAt: AT,
} satisfies Telescope.Project;

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
    mergePRs: false,
  },
  exposure: "hidden",
  syncWithBoard: true,
  dispatchMode: "inbox",
  channels: [],
  createdAt: AT,
  updatedAt: AT,
});

// The sent directories live in a session atom, so each test gets a registry of its own.
const projectsPage = (registry = AtomRegistry.make()) => (
  <RegistryContext.Provider value={registry}>
    <TelescopeProjectsPage />
  </RegistryContext.Provider>
);

describe("TelescopeProjectsPage 项目行", () => {
  it("offers 设定 only to members who can save the agent", async () => {
    const options = { projects: [held], agents: [chief("held")] };
    setup({ ...options, role: "viewer" });
    await using viewer = await render(projectsPage());
    await expect.element(page.getByRole("cell", { name: "held" }).first()).toBeVisible();
    expect(page.getByRole("button", { name: /^设定/ }).query()).toBeNull();
    await viewer.unmount();
    setup({ ...options, role: "member" });
    await using _member = await render(projectsPage());
    await expect.element(page.getByRole("button", { name: /^设定/ })).toBeVisible();
  });

  it("says a mount this client has no environment for is on another machine", async () => {
    const bobs = {
      environmentId: EnvironmentId.make("env-bob"),
      projectId: ProjectId.make("bobs"),
    };
    setup({ projects: [{ ...held, mounts: [bobs] }] });
    await using _screen = await render(projectsPage());
    await expect.element(page.getByText("在另一台机器上")).toBeVisible();
    await expect.element(page.getByRole("cell", { name: "另一台机器", exact: true })).toBeVisible();
    expect(page.getByText("项目未加载").query()).toBeNull();
    expect(page.getByText("env-bob").query()).toBeNull();
  });

  it("shows the machine's name when this client knows it", async () => {
    const bobs = {
      environmentId: EnvironmentId.make("env-bob"),
      projectId: ProjectId.make("bobs"),
    };
    setup({
      projects: [{ ...held, mounts: [bobs] }],
      environments: [{ environmentId: bobs.environmentId, label: "Bob 的笔记本" }],
    });
    await using _screen = await render(projectsPage());
    await expect.element(page.getByText("Bob 的笔记本")).toBeVisible();
  });
});

describe("TelescopeProjectsPage 接入", () => {
  it("sends one createProject for a double click, and after leaving and coming back, while the first is in flight", async () => {
    setup({});
    const registry = AtomRegistry.make();
    await using screen = await render(projectsPage(registry));
    const connect = page.getByRole("button", { name: "接入 free" });
    await userEvent.dblClick(connect);
    await expect.element(connect).toBeDisabled();
    expect(fake.calls).toHaveLength(1);
    await screen.unmount();
    await using _again = await render(projectsPage(registry));
    await expect.element(connect).toBeDisabled();
    await userEvent.click(connect, { force: true });
    expect(fake.calls).toHaveLength(1);
  });

  it("does not send a directory again after the call returned but the data has not caught up", async () => {
    setup({});
    const registry = AtomRegistry.make();
    await using screen = await render(projectsPage(registry));
    const connect = page.getByRole("button", { name: "接入 free" });
    await userEvent.click(connect);
    fake.settle[0]?.(AsyncResult.success(undefined));
    await userEvent.click(connect, { force: true });
    expect(fake.calls).toHaveLength(1);
    // Code losing the directory for a moment is not the data listing it as mounted.
    publish({ code: ["held"] });
    await expect.element(connect).not.toBeInTheDocument();
    publish({ code: ["free", "held"] });
    await expect.element(connect).toBeDisabled();
    await screen.unmount();
    await using _again = await render(projectsPage(registry));
    await expect.element(connect).toBeDisabled();
    await userEvent.click(connect, { force: true });
    expect(fake.calls).toHaveLength(1);
    // A different directory is not held back by the first.
    await userEvent.click(page.getByRole("button", { name: "接入 held" }));
    expect(fake.calls).toHaveLength(2);
  });

  it.each([
    ["", false],
    [" while the page was left", true],
  ] as const)("lets the admin retry a directory whose call failed%s", async (_name, leave) => {
    setup({});
    const registry = AtomRegistry.make();
    await using screen = await render(projectsPage(registry));
    const connect = page.getByRole("button", { name: "接入 free" });
    await userEvent.click(connect);
    if (leave) await screen.unmount();
    fake.settle[0]?.(AsyncResult.fail(new Error("offline")));
    await using _again = leave ? await render(projectsPage(registry)) : undefined;
    await expect.element(connect).toBeEnabled();
    await userEvent.click(connect);
    expect(fake.calls).toHaveLength(2);
  });

  it("offers a directory again if the data showed it mounted and later lost it", async () => {
    setup({});
    await using _screen = await render(projectsPage());
    const connect = page.getByRole("button", { name: "接入 free" });
    await userEvent.click(connect);
    fake.settle[0]?.(AsyncResult.success(undefined));
    publish({ projects: [{ ...held, mounts: [mount("free")] }] });
    await expect.element(connect).not.toBeInTheDocument();
    publish({ projects: [] });
    await expect.element(connect).toBeEnabled();
  });

  it("offers nothing to connect until the binding summary has loaded", async () => {
    setup({ summary: null });
    await using _screen = await render(projectsPage());
    await expect.element(page.getByRole("heading", { name: "项目", level: 2 })).toBeVisible();
    expect(page.getByRole("button", { name: /^接入 / }).query()).toBeNull();
  });
});
