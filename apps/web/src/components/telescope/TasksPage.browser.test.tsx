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
  tasks: [] as ReadonlyArray<Telescope.Task>,
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
const TASKS: ReadonlyArray<Telescope.Task> = [
  task("t-mine", "我负责的", { ownerSubjectId: ME }),
  task("t-agent", "我的 agent 负责的", {
    ownerAgentId: Telescope.AgentId.make("a-mine"),
    // The contract checks only the shape, so a day that does not exist can be stored.
    dueDate: "2026-02-31",
  }),
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
        ? { tasks: mocks.tasks }
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
  mocks.tasks = TASKS;
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

  it("edits a cell with only that field and writes nothing for a no-op", async () => {
    const { write } = setup();
    await using screen = await render(<TasksPage />, { router: "/telescope?view=tasks" });
    await userEvent.click(screen.getByRole("button", { name: "状态" }).first());
    await userEvent.click(page.getByRole("menuitemradio", { name: "未开始" }));
    await userEvent.click(screen.getByRole("button", { name: "状态" }).first());
    await userEvent.click(page.getByRole("menuitemradio", { name: "完成" }));

    await userEvent.click(screen.getByRole("button", { name: "优先级" }).first());
    await userEvent.click(page.getByRole("menuitemradio", { name: "高" }));

    await userEvent.click(screen.getByRole("button", { name: "截止日期" }).first());
    await userEvent.fill(screen.getByRole("textbox", { name: "截止日期" }), "2026-11-20");
    await userEvent.click(screen.getByText("名称"));

    // A stored day the date input cannot show is shown as stored and survives opening the editor.
    await expect.element(screen.getByText("2026/02/31")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "截止日期" }).nth(1));
    await userEvent.click(screen.getByText("名称"));

    await userEvent.click(screen.getByRole("button", { name: "负责人" }).nth(2));
    await userEvent.click(page.getByRole("menuitemradio", { name: "我" }));
    await userEvent.click(screen.getByRole("button", { name: "负责人" }).first());
    await userEvent.click(page.getByRole("menuitemradio", { name: "无" }).first());

    // A rename saves the trimmed title; Enter on the same title and Escape save nothing.
    await userEvent.click(screen.getByRole("button", { name: "改标题：我负责的" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "任务标题" }), " 周一发版 ");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "改标题：我的 agent 负责的" }));
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "改标题：别人的" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "任务标题" }), "改了又不要");
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("button", { name: "改标题：别人的" })).toBeVisible();

    expect(vi.mocked(write).mock.calls).toEqual([
      [TASKS[0], { set: { status: "done" } }],
      [TASKS[0], { set: { priority: "high" } }],
      [TASKS[0], { set: { dueDate: "2026-11-20" } }],
      [TASKS[2], { set: { ownerSubjectId: ME } }],
      [TASKS[0], { set: { ownerSubjectId: null } }],
      [TASKS[0], { set: { title: "周一发版" } }],
    ]);
  });

  it("sends title and due edits against the version the editor opened on", async () => {
    const { write } = setup();
    await using screen = await render(<TasksPage />, { router: "/telescope?view=tasks" });
    await userEvent.click(screen.getByRole("button", { name: "截止日期" }).first());
    mocks.tasks = [{ ...TASKS[0]!, version: 2 }, ...TASKS.slice(1)];
    await screen.rerender(<TasksPage />);
    await userEvent.fill(screen.getByRole("textbox", { name: "截止日期" }), "2026-12-01");
    await userEvent.click(screen.getByText("名称"));
    await userEvent.click(screen.getByRole("button", { name: "改标题：我负责的" }));
    mocks.tasks = [{ ...TASKS[0]!, version: 3 }, ...TASKS.slice(1)];
    await screen.rerender(<TasksPage />);
    await userEvent.fill(screen.getByRole("textbox", { name: "任务标题" }), "新标题");
    await userEvent.keyboard("{Enter}");
    expect(vi.mocked(write).mock.calls).toEqual([
      [TASKS[0], { set: { dueDate: "2026-12-01" } }],
      [{ ...TASKS[0], version: 2 }, { set: { title: "新标题" } }],
    ]);
  });

  it("takes a typed due date and sends only a whole one", async () => {
    const { write } = setup();
    await using screen = await render(<TasksPage />, { router: "/telescope?view=tasks" });
    await userEvent.click(screen.getByRole("button", { name: "截止日期" }).first());
    // The test browser lays the date out as mm/dd/yyyy; each field moves on once it is full.
    await userEvent.keyboard("11202026{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "截止日期" }).nth(2));
    await userEvent.keyboard("112020266{Enter}");
    expect(vi.mocked(write).mock.calls).toEqual([[TASKS[0], { set: { dueDate: "2026-11-20" } }]]);
  });

  /** Creates the test settles by hand, in call order. */
  function pendingCreates() {
    const settle: Array<(created: boolean) => void> = [];
    const create = vi.fn(() => new Promise<boolean>((resolve) => settle.push(resolve)));
    mocks.create = create;
    return { create, settle };
  }

  it("keeps each new task's text until its own create lands", async () => {
    setup();
    const { create, settle } = pendingCreates();
    await using screen = await render(<TasksPage />, { router: "/telescope?view=tasks" });
    await userEvent.click(screen.getByRole("button", { name: "新任务" }));
    const input = screen.getByRole("textbox", { name: "新任务标题" });
    await userEvent.fill(input, "第一个");
    // A second Enter, and Escape while the create is out, neither repeat it nor drop the text.
    await userEvent.keyboard("{Enter}{Enter}{Escape}");
    await expect.element(input).toHaveValue("第一个");
    await userEvent.fill(input, "第二个");
    await userEvent.keyboard("{Enter}");
    expect(create).toHaveBeenCalledTimes(2);
    settle[0]!(true);
    await expect.element(input).toHaveValue("第二个");
    settle[1]!(true);
    await expect.element(input).toHaveValue("");
    await userEvent.click(screen.getByText("名称"));
    await expect.element(screen.getByRole("button", { name: "新任务" })).toBeVisible();

    // Enter then blur: the row closes once the create lands.
    await userEvent.click(screen.getByRole("button", { name: "新任务" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "新任务标题" }), "第三个");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByText("名称"));
    settle[2]!(true);
    await expect.element(screen.getByRole("button", { name: "新任务" })).toBeVisible();

    // Enter then Escape: the same, and Escape alone drops an unsent title.
    await userEvent.click(screen.getByRole("button", { name: "新任务" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "新任务标题" }), "第四个");
    await userEvent.keyboard("{Enter}{Escape}");
    settle[3]!(true);
    await expect.element(screen.getByRole("button", { name: "新任务" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "新任务" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "新任务标题" }), "不要了");
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("button", { name: "新任务" })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("leaves a title whose create failed in its input, with or without focus", async () => {
    setup();
    const { settle } = pendingCreates();
    await using screen = await render(<TasksPage />, { router: "/telescope?view=tasks" });
    await userEvent.click(screen.getByRole("button", { name: "新任务" }));
    const input = screen.getByRole("textbox", { name: "新任务标题" });
    await userEvent.fill(input, "没存上的");
    await userEvent.keyboard("{Enter}");
    settle[0]!(false);
    await expect.element(input).toHaveValue("没存上的");
    await userEvent.click(screen.getByText("名称"));
    settle[1]!(false);
    // A second click is a round trip, so a close the failure caused would have landed by now.
    await userEvent.click(screen.getByText("名称"));
    await expect.element(input).toHaveValue("没存上的");
    await userEvent.click(input);
    await userEvent.keyboard("{Enter}{Escape}");
    settle[2]!(false);
    await userEvent.click(screen.getByText("名称"));
    await expect.element(input).toHaveValue("没存上的");
  });

  it("lets another board group take a new task while one group's create is pending", async () => {
    setup();
    const { create, settle } = pendingCreates();
    await using screen = await render(<TasksPage />, {
      router: "/telescope?view=tasks&layout=board&project=p1",
    });
    const todo = screen.getByRole("region", { name: "未开始" });
    const doing = screen.getByRole("region", { name: "进行中" });
    await userEvent.click(todo.getByRole("button", { name: "新任务" }));
    await userEvent.fill(todo.getByRole("textbox", { name: "新任务标题" }), "A 组的");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "新任务（进行中）" }));
    await userEvent.fill(doing.getByRole("textbox", { name: "新任务标题" }), "B 组的");
    settle[0]!(true);
    await expect.element(todo.getByRole("button", { name: "新任务" })).toBeVisible();
    await userEvent.keyboard("组");
    await expect
      .element(doing.getByRole("textbox", { name: "新任务标题" }))
      .toHaveValue("B 组的组");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("adds a task to a board group from its header and keeps the project out of the 决定 heading", async () => {
    const { create } = setup();
    await using screen = await render(<TasksPage />, {
      router: "/telescope?view=tasks&layout=board&project=p1",
    });
    await expect.element(screen.getByRole("heading", { name: "Alpha" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "新任务（进行中）" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "新任务标题" }), "接着做");
    await userEvent.keyboard("{Enter}");
    expect(create).toHaveBeenCalledWith({
      environmentId: ENV,
      input: { workspaceId: W, projectId: P, status: "in_progress", title: "接着做" },
    });

    await screen.rerender(<TasksPage />);
    await userEvent.click(screen.getByRole("button", { name: "决定" }));
    await expect.element(screen.getByRole("heading", { name: "全部任务" })).toBeVisible();
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
