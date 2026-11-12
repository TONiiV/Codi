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
    telescope: { ...real.telescope, get: () => "self" as never },
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
  useBoardNames: () => names,
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
const page_ = (current: Telescope.Task, write: (...args: never[]) => Promise<boolean>) => (
  <TaskPage task={current} write={write as never} names={names} agents={[]} selfName="小王" />
);

describe("TaskPage", () => {
  it("shows a read-only member the page without edit controls", async () => {
    await using screen = await render(
      <TaskPage task={task} write={null} names={names} agents={[]} selfName="小王" />,
    );
    await expect.element(screen.getByRole("heading", { name: "发布 1.2" })).toBeVisible();
    await expect.element(screen.getByText("先别发周五")).toBeVisible();
    expect(screen.container.querySelector("[contenteditable], input:not([type=checkbox])")).toBe(
      null,
    );
    expect(screen.container.querySelectorAll("button:not([aria-expanded]), textarea")).toHaveLength(
      0,
    );
    for (const box of screen.container.querySelectorAll("input[type=checkbox]"))
      expect((box as HTMLInputElement).readOnly || (box as HTMLInputElement).disabled).toBe(true);
  });

  it("saves the Markdown source against the version it was opened on, and an unchanged one not at all", async () => {
    const write = vi.fn(async () => true);
    const v4 = { ...task, version: 4, body: `${task.body}\n- [ ] 对方新加的一项` };
    await using screen = await render(page_(task, write));

    await userEvent.click(screen.getByRole("button", { name: "编辑 Markdown" }));
    await screen.rerender(page_(v4, write));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await expect
      .element(screen.getByRole("textbox", { name: "正文 Markdown" }))
      .not.toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "编辑 Markdown" }));
    await screen.rerender(page_({ ...v4, version: 5, body: "对方又改了" }, write));
    await userEvent.fill(screen.getByRole("textbox", { name: "正文 Markdown" }), "我的正文");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(write).toHaveBeenCalledExactlyOnceWith(v4, { set: { body: "我的正文" } });
  });

  it("sends one comment for a double click while the first is in flight", async () => {
    const write = vi.fn(() => new Promise<boolean>(() => {}));
    await using screen = await render(page_(task, write));
    await userEvent.fill(screen.getByRole("textbox", { name: "添加评论" }), "周一发");
    await userEvent.dblClick(screen.getByRole("button", { name: "发送评论" }));
    expect(write).toHaveBeenCalledExactlyOnceWith(task, { note: "周一发" });
  });

  it("keeps what the member is typing in the title when someone else renames the task", async () => {
    const write = vi.fn(async () => true);
    await using screen = await render(page_(task, write));
    const title = screen.getByRole("textbox", { name: "任务标题" });

    await userEvent.fill(title, "发布 1.3");
    await screen.rerender(page_({ ...task, version: 4, title: "对方改的标题" }, write));
    await expect.element(title).toHaveTextContent("发布 1.3");
    expect(document.activeElement).toBe(title.element());

    await userEvent.keyboard("{Enter}");
    expect(write).toHaveBeenCalledExactlyOnceWith(task, { set: { title: "发布 1.3" } });
    await screen.rerender(page_({ ...task, version: 5, title: "又改了" }, write));
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
    expect(screen.container.querySelector("[contenteditable], input[type=date], textarea")).toBe(
      null,
    );
    expect(screen.container.querySelectorAll("[role=combobox]")).toHaveLength(0);
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
