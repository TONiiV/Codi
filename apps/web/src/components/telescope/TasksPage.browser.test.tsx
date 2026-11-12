import { EnvironmentId, Telescope } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { TasksPage } from "./TasksPage";

const mocks = vi.hoisted(() => ({
  role: "member" as Telescope.WorkspaceRole,
  write: (() => Promise.resolve(true)) as (...args: unknown[]) => Promise<boolean>,
  create: (() => Promise.resolve(true)) as (...args: unknown[]) => Promise<boolean>,
}));

const ENV = EnvironmentId.make("env");
const W = Telescope.WorkspaceId.make("w");
const P = Telescope.TelescopeProjectId.make("p1");
const ME = Telescope.SubjectId.make("me");

const task = (id: string, title: string, owner: Partial<Telescope.Task> = {}): Telescope.Task => ({
  kind: "task",
  id: Telescope.TaskId.make(id),
  workspaceId: W,
  projectId: P,
  title,
  status: "todo",
  threads: [],
  goalChain: [],
  freeText: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  version: 1,
  ...owner,
});
const TASKS = [
  task("t-mine", "我负责的", { ownerSubjectId: ME }),
  task("t-agent", "我的 agent 负责的", { ownerAgentId: Telescope.AgentId.make("a-mine") }),
  task("t-other", "别人的", {
    ownerSubjectId: Telescope.SubjectId.make("other"),
    ownerAgentId: Telescope.AgentId.make("a-other"),
  }),
];

vi.mock(import("./telescopeState"), async (original) => {
  const real = await original();
  const allowed = { permissionAtom: () => Atom.make(true) };
  return {
    ...real,
    telescope: { ...real.telescope, get: () => ({ kind: "self" }) as never },
    telescopeBoard: {
      ...real.telescopeBoard,
      tasks: () => ({ kind: "tasks" }) as never,
      agents: () => ({ kind: "agents" }) as never,
      updateTask: allowed as never,
      createTask: allowed as never,
    },
  };
});
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((query: { kind?: string } | null) => ({
    data:
      query?.kind === "tasks"
        ? { tasks: TASKS }
        : query?.kind === "agents"
          ? { agents: [{ id: "a-mine" }] }
          : query?.kind === "self"
            ? { self: { subjectId: ME, role: mocks.role } }
            : null,
    error: null,
    failure: null,
    isPending: false,
    refresh: () => {},
  })) as never,
}));
vi.mock(import("./TasksParts"), async (original) => ({
  ...(await original()),
  useBoardTarget: () => ({ environmentId: ENV, workspaceId: W }),
  useBoardPeople: () => ({
    members: [{ subjectId: ME, displayName: "我" }] as never,
    agents: [],
    name: () => undefined,
  }),
  useTaskWrite: () => mocks.write,
  useBoardCommand: (() => mocks.create) as never,
}));
vi.mock(import("./TasksSidebar"), () => ({
  useTasksProject: () => ({ list: [{ id: P, name: "Alpha" }], selected: P, projects: {} }) as never,
}));
vi.mock(import("./TelescopeShell"), () => ({ TelescopeEmptyState: () => <p>empty</p> }) as never);
vi.mock(import("./DecisionsPage"), () => ({ DecisionsBody: () => null }) as never);

function setup(role: Telescope.WorkspaceRole = "member") {
  mocks.role = role;
  mocks.write = vi.fn(() => Promise.resolve(true));
  mocks.create = vi.fn(() => Promise.resolve(true));
  return mocks;
}

describe("TasksPage", () => {
  it("我的 lists the caller's and its agents' tasks and adds new ones as the caller's", async () => {
    const { create } = setup();
    await using screen = await render(<TasksPage />, {
      router: "/telescope?view=tasks&layout=mine&project=p1",
    });
    await expect.element(screen.getByText("我负责的")).toBeVisible();
    await expect.element(screen.getByText("我的 agent 负责的")).toBeVisible();
    await expect.element(screen.getByText("别人的")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "新任务" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "新任务标题" }), "周一发");
    await userEvent.keyboard("{Enter}");
    expect(create).toHaveBeenCalledWith({
      environmentId: ENV,
      input: { workspaceId: W, projectId: P, ownerSubjectId: ME, title: "周一发" },
    });
    // OPEN keeps the view and the project the list is filtered to.
    const open = screen.getByRole("link", { name: "打开" }).first();
    await expect
      .element(open)
      .toHaveAttribute("href", "/telescope?view=tasks&layout=mine&task=t-mine&project=p1");
  });

  it("edits a cell through the task write with only that field", async () => {
    const { write } = setup();
    await using screen = await render(<TasksPage />, { router: "/telescope?view=tasks" });
    await userEvent.click(screen.getByRole("button", { name: "状态" }).first());
    await userEvent.click(page.getByRole("menuitemradio", { name: "完成" }));
    expect(write).toHaveBeenLastCalledWith(TASKS[0], { set: { status: "done" } });

    await userEvent.click(screen.getByRole("button", { name: "优先级" }).first());
    await userEvent.click(page.getByRole("menuitemradio", { name: "高" }));
    expect(write).toHaveBeenLastCalledWith(TASKS[0], { set: { priority: "high" } });

    await userEvent.click(screen.getByRole("button", { name: "截止日期" }).first());
    await userEvent.fill(screen.getByRole("textbox", { name: "截止日期" }), "2026-11-20");
    await userEvent.click(screen.getByText("名称"));
    expect(write).toHaveBeenLastCalledWith(TASKS[0], { set: { dueDate: "2026-11-20" } });

    await userEvent.click(screen.getByRole("button", { name: "负责人" }).nth(2));
    await userEvent.click(page.getByRole("menuitemradio", { name: "我" }));
    expect(write).toHaveBeenLastCalledWith(TASKS[2], { set: { ownerSubjectId: ME } });
    // Escape cancels the edit.
    await userEvent.click(screen.getByRole("button", { name: "改标题：我负责的" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "任务标题" }), "改了又不要");
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("button", { name: "改标题：我负责的" })).toBeVisible();
    expect(write).toHaveBeenCalledTimes(4);
  });

  it("shows a 只读 member the tasks with no edit controls", async () => {
    setup("viewer");
    await using screen = await render(<TasksPage />, { router: "/telescope?view=tasks" });
    await expect.element(screen.getByText("别人的")).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "打开" }).first()).toBeInTheDocument();
    for (const name of ["状态", "负责人", "截止日期", "优先级", "新任务", "改标题：别人的"])
      await expect.element(screen.getByRole("button", { name })).not.toBeInTheDocument();
  });
});
