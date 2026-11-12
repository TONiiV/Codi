import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { useSyncExternalStore, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import { NoWorkspace } from "./TasksParts";
import { FirstRunGate } from "./TelescopeFirstRun";
import { INVITE_CLOSED_KEY, firstRunHeldAtom } from "./firstRunSteps";

const AT = "2026-11-08T00:00:00.000Z";
const environmentId = EnvironmentId.make("local");
const workspaceId = Telescope.WorkspaceId.make("ws");
const workspace: Telescope.Workspace = {
  id: workspaceId,
  kind: "enterprise",
  name: "Gripper Lab",
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
const mounted = {
  id: Telescope.TelescopeProjectId.make("t-free"),
  workspaceId,
  name: "free",
  mounts: [{ environmentId, projectId: ProjectId.make("free") }],
  createdAt: AT,
} satisfies Telescope.Project;

const allowed = Atom.make(true);
const refused = Atom.make(false);

const fake = vi.hoisted(() => ({
  calls: [] as unknown[],
  settle: [] as Array<(result: unknown) => void>,
  role: "admin" as Telescope.Member["role"],
  mayInvite: true,
  version: 0,
  listeners: new Set<() => void>(),
  projects: [] as ReadonlyArray<unknown>,
  workspaces: [] as ReadonlyArray<unknown> | null,
  current: null as unknown,
  listFailed: false,
}));

// The page reads through hooks, so new data has to arrive the way it does in the app: by notifying.
function publish(projects: ReadonlyArray<Telescope.Project>) {
  fake.projects = projects;
  fake.version += 1;
  fake.listeners.forEach((listener) => listener());
}

function setup(options: {
  projects?: ReadonlyArray<Telescope.Project>;
  role?: Telescope.Member["role"];
  mayInvite?: boolean;
  workspaces?: ReadonlyArray<Telescope.Workspace> | null;
  listFailed?: boolean;
}) {
  fake.calls = [];
  fake.settle = [];
  fake.projects = options.projects ?? [];
  fake.role = options.role ?? "admin";
  fake.mayInvite = options.mayInvite ?? true;
  fake.workspaces = options.workspaces === undefined ? [workspace] : options.workspaces;
  fake.current = fake.workspaces?.[0] ?? null;
  fake.listFailed = options.listFailed ?? false;
  localStorage.removeItem(INVITE_CLOSED_KEY);
}

vi.mock(import("./telescopeState"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useTelescopeWorkspaces: () => ({ environmentId, current: fake.current, bindings: [] }),
    telescope: {
      ...actual.telescope,
      list: () => ({ key: "list" }),
      get: () => ({ key: "get" }),
      projects: () => ({ key: "projects" }),
      bindingSummary: () => ({ key: "summary" }),
      createProject: { ...actual.telescope.createProject, permissionAtom: () => allowed },
      invite: {
        ...actual.telescope.invite,
        permissionAtom: () => (fake.mayInvite ? allowed : refused),
      },
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
      atom?.key === "list"
        ? fake.workspaces === null
          ? null
          : { workspaces: fake.workspaces }
        : atom?.key === "get"
          ? {
              workspace,
              self: { workspaceId, subjectId: "me", displayName: "Me", role: fake.role },
            }
          : atom?.key === "projects"
            ? { projects: fake.projects }
            : { projects: [] };
    return {
      data,
      dataUpdatedAt: 0,
      error: data === null && fake.listFailed ? "offline" : null,
      failure: null,
      isPending: false,
      isSuccess: data !== null,
      refresh: () => {},
    };
  }) as never,
}));

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: () => environmentId,
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
  // Stays pending until the test settles the call, so it picks the moment the page sees the result.
  useAtomCommand: (_command, _label) => (request: unknown) => {
    fake.calls.push(request);
    return new Promise((resolve) => fake.settle.push(resolve as never));
  },
}));

function held(ui: ReactNode) {
  const registry = AtomRegistry.make();
  registry.set(firstRunHeldAtom, true);
  return <RegistryContext.Provider value={registry}>{ui}</RegistryContext.Provider>;
}

describe("FirstRunGate", () => {
  it("holds 接入 for a directory from the click until the data shows it mounted", async () => {
    setup({});
    await using _screen = await render(held(<FirstRunGate>board</FirstRunGate>));
    const connect = page.getByRole("button", { name: "接入 free" });
    await userEvent.click(connect);
    await expect.element(connect).toBeDisabled();
    fake.settle[0]?.(AsyncResult.success(undefined));
    await userEvent.click(connect, { force: true });
    expect(fake.calls).toHaveLength(1);
    // A different directory is not held back by the first.
    await userEvent.click(page.getByRole("button", { name: "接入 held" }));
    expect(fake.calls).toHaveLength(2);
    publish([mounted]);
    await expect.element(page.getByRole("button", { name: "生成邀请码" })).toBeVisible();
  });

  it("lets the admin retry a directory whose call failed", async () => {
    setup({});
    await using _screen = await render(held(<FirstRunGate>board</FirstRunGate>));
    const connect = page.getByRole("button", { name: "接入 free" });
    await userEvent.click(connect);
    fake.settle[0]?.(AsyncResult.fail(new Error("offline")));
    await expect.element(connect).toBeEnabled();
    await userEvent.click(connect);
    expect(fake.calls).toHaveLength(2);
  });

  it("keeps a skipped invite step skipped for this browser", async () => {
    setup({ projects: [mounted] });
    await using screen = await render(held(<FirstRunGate>board</FirstRunGate>));
    await expect.element(page.getByRole("button", { name: "生成邀请码" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "跳过" }));
    await expect.element(screen.getByText("board")).toBeVisible();
    await screen.unmount();
    await using _again = await render(held(<FirstRunGate>board</FirstRunGate>));
    await expect.element(page.getByText("board")).toBeVisible();
    expect(page.getByRole("button", { name: "生成邀请码" }).query()).toBeNull();
  });

  it.each([
    ["a member", { role: "member" }],
    ["an admin without the invite permission", { mayInvite: false }],
  ] as const)("shows %s the board, not the invite step", async (_name, options) => {
    setup({ projects: [mounted], ...options });
    await using _screen = await render(held(<FirstRunGate>board</FirstRunGate>));
    await expect.element(page.getByText("board")).toBeVisible();
    expect(page.getByRole("button", { name: "生成邀请码" }).query()).toBeNull();
  });

  it("is not in the way when nothing started the first run", async () => {
    setup({});
    await using _screen = await render(<FirstRunGate>board</FirstRunGate>);
    await expect.element(page.getByText("board")).toBeVisible();
  });
});

describe("NoWorkspace", () => {
  it("shows the three steps once the list has loaded empty", async () => {
    setup({ workspaces: [] });
    await using _screen = await render(<NoWorkspace />);
    await expect.element(page.getByRole("heading", { name: "开始使用 Telescope" })).toBeVisible();
    await expect.element(page.getByLabelText("名字")).toBeVisible();
    expect(page.getByText("还没有工作区").query()).toBeNull();
  });

  it("keeps the first run on screen after a workspace is made, and only then", async () => {
    setup({ workspaces: [] });
    const registry = AtomRegistry.make();
    await using _screen = await render(
      <RegistryContext.Provider value={registry}>
        <NoWorkspace />
      </RegistryContext.Provider>,
    );
    await userEvent.fill(page.getByLabelText("名字"), "Gripper Lab");
    await userEvent.fill(page.getByLabelText("你在工作区里的名字"), "Me");
    await userEvent.click(page.getByRole("button", { name: "新建" }));
    fake.settle[0]?.(AsyncResult.fail(new Error("offline")));
    await expect.element(page.getByRole("alert")).toBeVisible();
    expect(registry.get(firstRunHeldAtom)).toBe(false);
    await userEvent.click(page.getByRole("button", { name: "新建" }));
    fake.settle[1]?.(AsyncResult.success(workspace));
    await vi.waitFor(() => expect(registry.get(firstRunHeldAtom)).toBe(true));
  });

  it.each([
    ["loading", { workspaces: null }, "正在加载…"],
    ["load-failed", { workspaces: null, listFailed: true }, "工作区加载失败"],
  ] as const)("keeps the %s state", async (_name, options, text) => {
    setup(options);
    await using _screen = await render(<NoWorkspace />);
    await expect.element(page.getByText(text)).toBeVisible();
    expect(page.getByRole("heading", { name: "开始使用 Telescope" }).query()).toBeNull();
  });
});
