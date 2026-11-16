import { EnvironmentId, Telescope } from "@t3tools/contracts";
import { Atom, AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { LeaseField, TaskDetail } from "./TaskPanel";
import { TaskPage } from "./TaskPage";

const detail = vi.hoisted(() => ({ role: "member" }));
const setup = (role: string) => {
  detail.role = role;
};

vi.mock(import("./telescopeState"), async (original) => {
  const real = await original();
  const agent = { id: "a1", name: "构建 agent" };
  const agents = (list: ReadonlyArray<typeof agent>) => () =>
    Atom.make(AsyncResult.success({ agents: list }));
  const allowed = { permissionAtom: () => Atom.make(true) };
  return {
    ...real,
    telescope: {
      ...real.telescope,
      get: () => "self" as never,
      members: (() => Atom.make(AsyncResult.success({ members: [] }))) as never,
    },
    telescopeBoard: {
      ...real.telescopeBoard,
      task: () => "task" as never,
      lease: () => "lease" as never,
      // listCompany also returns the viewer's own agents the owner made visible.
      agents: agents([agent]) as never,
      companyAgents: agents([agent, { id: "a2", name: "评审 agent" }]) as never,
      updateTask: { ...real.telescopeBoard.updateTask, ...allowed },
      unlinkThread: { ...real.telescopeBoard.unlinkThread, ...allowed },
    },
  };
});
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((query: string | null) => ({
    data:
      query === "task"
        ? task
        : query === "lease"
          ? {}
          : query === "self"
            ? { self: { role: detail.role, displayName: "小王" } }
            : null,
    error: null,
    isPending: false,
    dataUpdatedAt: 0,
    refresh: () => {},
  })) as never,
}));
vi.mock(import("./TasksParts"), async (original) => ({
  ...(await original()),
  useTaskWrite: (() => async () => true) as never,
}));
vi.mock(import("../chat/useSideChat"), async (original) => ({
  ...(await original()),
  useSideChat: (() => ({ open: async () => false })) as never,
}));

describe("LeaseField", () => {
  it("keeps the last lease read on screen and shows that a re-read failed", async () => {
    const lease: Telescope.Lease = {
      id: Telescope.LeaseId.make("l1"),
      workspaceId: Telescope.WorkspaceId.make("w1"),
      taskId: Telescope.TaskId.make("t1"),
      holderAgentId: Telescope.AgentId.make("a1"),
      holderSubjectId: Telescope.SubjectId.make("s1"),
      acquiredAt: "2026-11-01T00:00:00.000Z",
      heartbeatAt: "2026-11-01T00:00:00.000Z",
      expiresAt: "2026-11-01T00:15:00.000Z",
    };
    const query = { data: { lease }, error: "offline", refresh: () => {} };
    await using screen = await render(
      <LeaseField lease={lease} holder="构建 agent" query={query} />,
    );
    await expect.element(screen.getByRole("paragraph")).toMatchTextContent(/^构建 agent 在做/);
    await expect.element(screen.getByRole("alert")).toHaveTextContent("没有读到最新的租约重试");
  });
});

const task: Telescope.Task = {
  kind: "task",
  id: Telescope.TaskId.make("t1"),
  workspaceId: Telescope.WorkspaceId.make("w1"),
  title: "发布 1.2",
  status: "todo",
  body: "## 子任务\n\n- [ ] 写更新日志\n- [x] 打标签",
  threads: [],
  goalChain: [],
  freeText: [{ authorId: "s1", text: "先别发周五", at: "2026-11-01T00:00:00.000Z" }],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  version: 3,
};
const names = (id: string) => (id === "s1" ? "小王" : undefined);
const taskPage = (current: Telescope.Task, write: (...args: never[]) => Promise<boolean>) => (
  <TaskPage task={current} write={write as never} names={names} agents={[]} selfName="小王" />
);

describe("TaskPage", () => {
  it("saves the Markdown source against the version it was opened on, and an unchanged one not at all", async () => {
    const write = vi.fn(async () => true);
    const v4 = { ...task, version: 4, body: `${task.body}\n- [ ] 对方新加的一项` };
    await using screen = await render(taskPage(task, write));

    await userEvent.click(screen.getByRole("button", { name: "编辑 Markdown" }));
    await screen.rerender(taskPage(v4, write));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await expect
      .element(screen.getByRole("textbox", { name: "正文 Markdown" }))
      .not.toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "编辑 Markdown" }));
    await screen.rerender(taskPage({ ...v4, version: 5, body: "对方又改了" }, write));
    await userEvent.fill(screen.getByRole("textbox", { name: "正文 Markdown" }), "我的正文");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(write).toHaveBeenCalledExactlyOnceWith(v4, { set: { body: "我的正文" } });
  });

  it("sends one comment for a double click while the first is in flight", async () => {
    const write = vi.fn(() => new Promise<boolean>(() => {}));
    await using screen = await render(taskPage(task, write));
    await userEvent.fill(screen.getByRole("textbox", { name: "添加评论" }), "周一发");
    await userEvent.dblClick(screen.getByRole("button", { name: "发送评论" }));
    expect(write).toHaveBeenCalledExactlyOnceWith(task, { note: "周一发" });
  });

  it("keeps what was typed while a comment was sending, and clears only the sent text", async () => {
    let settle = (_sent: boolean) => {};
    const write = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    await using screen = await render(taskPage(task, write));
    const box = screen.getByRole("textbox", { name: "添加评论" });
    await userEvent.fill(box, "第一条");
    await userEvent.keyboard("{Enter}");
    await userEvent.fill(box, "第一条第二条还没发");
    settle(true);
    await expect.element(box).toHaveValue("第二条还没发");
    expect(write).toHaveBeenCalledExactlyOnceWith(task, { note: "第一条" });
  });

  it("keeps the typed title when its write fails", async () => {
    const write = vi.fn(async () => false);
    await using screen = await render(taskPage(task, write));
    const title = screen.getByRole("textbox", { name: "任务标题" });
    await userEvent.fill(title, "我的新标题");
    await userEvent.keyboard("{Enter}");
    await write.mock.results[0]?.value;
    expect(title.element().textContent).toBe("我的新标题");
  });

  it("shows a status it sent until the task's next version arrives", async () => {
    const write = vi.fn(async () => true);
    await using screen = await render(taskPage(task, write));
    await userEvent.click(screen.getByRole("combobox", { name: "状态" }));
    await userEvent.click(page.getByRole("option", { name: "等你确认" }));
    expect(write).toHaveBeenCalledExactlyOnceWith(task, { set: { status: "in_review" } });
    await expect
      .element(screen.getByRole("combobox", { name: "状态" }))
      .toHaveTextContent("等你确认");
    await screen.rerender(taskPage({ ...task, version: 4, status: "done" }, write));
    await expect.element(screen.getByRole("combobox", { name: "状态" })).toHaveTextContent("完成");
  });

  it("writes a typed due date once, on leaving the field, and only a whole one", async () => {
    const write = vi.fn(async () => true);
    await using screen = await render(taskPage(task, write));
    const due = screen.getByLabelText("截止日期");
    const input = due.element() as HTMLInputElement;
    const leave = () => userEvent.click(screen.getByRole("heading", { name: "评论" }));

    // Focus lands on the month segment (en-US): a month alone, then a year with a fifth digit.
    input.focus();
    await userEvent.keyboard("12");
    await leave();
    expect(input.validity.badInput).toBe(false);
    input.focus();
    await userEvent.keyboard("120520271");
    await leave();
    expect(write).not.toHaveBeenCalled();
    const dated = { ...task, version: 4, dueDate: "2026-11-20" };
    await screen.rerender(taskPage(dated, write));
    await expect.element(due).toHaveValue("2026-11-20");

    input.focus();
    await userEvent.keyboard("12052027");
    expect(write).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(write).toHaveBeenCalledExactlyOnceWith(dated, { set: { dueDate: "2027-12-05" } });
    await expect.element(due).toHaveValue("2027-12-05");

    input.focus();
    await userEvent.keyboard("{Backspace}");
    await leave();
    expect(write).toHaveBeenCalledOnce();
    await expect.element(due).toHaveValue("2027-12-05");

    input.focus();
    await userEvent.keyboard("{Backspace}{Tab}{Backspace}{Tab}{Backspace}");
    await leave();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(dated, { set: { dueDate: null } });
  });

  it("keeps what the member is typing in the title when someone else renames the task", async () => {
    const write = vi.fn(async () => true);
    await using screen = await render(taskPage(task, write));
    const title = screen.getByRole("textbox", { name: "任务标题" });

    await userEvent.fill(title, "发布 1.3");
    await screen.rerender(taskPage({ ...task, version: 4, title: "对方改的标题" }, write));
    await expect.element(title).toHaveTextContent("发布 1.3");
    expect(document.activeElement).toBe(title.element());

    await userEvent.keyboard("{Enter}");
    expect(write).toHaveBeenCalledExactlyOnceWith(task, { set: { title: "发布 1.3" } });
    await screen.rerender(taskPage({ ...task, version: 5, title: "又改了" }, write));
    await expect
      .element(screen.getByRole("textbox", { name: "任务标题" }))
      .toHaveTextContent("又改了");
  });
});

describe("TaskDetail", () => {
  const target = {
    environmentId: EnvironmentId.make("env"),
    workspaceId: Telescope.WorkspaceId.make("w1"),
  };

  it("gives a viewer the task without edit controls", async () => {
    setup("viewer");
    await using screen = await render(<TaskDetail target={target} taskId={task.id} />);
    await expect.element(screen.getByRole("heading", { name: "发布 1.2" })).toBeVisible();
    await expect.element(screen.getByText("先别发周五")).toBeVisible();
    expect(
      screen.container.querySelector("[contenteditable], input:not([type=checkbox]), textarea"),
    ).toBe(null);
    expect(screen.container.querySelectorAll("[role=combobox]")).toHaveLength(0);
    expect(
      [...screen.container.querySelectorAll("button:not([aria-expanded])")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["加到 side chat"]);
    for (const box of screen.container.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))
      expect(box.readOnly || box.disabled).toBe(true);
  });

  it("lists an agent once when it is both the member's own and visible to the company", async () => {
    setup("member");
    await using screen = await render(<TaskDetail target={target} taskId={task.id} />);
    await userEvent.click(screen.getByRole("combobox", { name: "负责" }));
    await expect.element(page.getByRole("option", { name: "评审 agent" })).toBeVisible();
    expect(
      page
        .getByRole("option")
        .elements()
        .map((option) => option.textContent),
    ).toEqual(["无", "构建 agent", "评审 agent"]);
  });
});
