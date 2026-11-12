import { Telescope } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { LeaseField } from "./TaskPanel";
import { TaskPage } from "./TaskPage";

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
    expect(screen.container.querySelectorAll("button, textarea")).toHaveLength(0);
    for (const box of screen.container.querySelectorAll("input[type=checkbox]"))
      expect((box as HTMLInputElement).readOnly || (box as HTMLInputElement).disabled).toBe(true);
  });

  it("writes each edit through the task write with the field it changed", async () => {
    const write = vi.fn(async () => true);
    await using screen = await render(
      <TaskPage task={task} write={write} names={names} agents={[]} selfName="小王" />,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "Toggle task" }).first());
    expect(write).toHaveBeenLastCalledWith(task, {
      set: { body: "## 子任务\n\n- [x] 写更新日志\n- [x] 打标签" },
    });

    await userEvent.fill(screen.getByRole("textbox", { name: "添加评论" }), "周一发");
    await userEvent.click(screen.getByRole("button", { name: "发送评论" }));
    expect(write).toHaveBeenLastCalledWith(task, { note: "周一发" });

    await userEvent.fill(screen.getByLabelText("截止日期"), "2026-11-30");
    expect(write).toHaveBeenLastCalledWith(task, { set: { dueDate: "2026-11-30" } });

    await userEvent.click(screen.getByRole("combobox", { name: "优先级" }));
    await userEvent.click(page.getByRole("option", { name: "高" }));
    expect(write).toHaveBeenLastCalledWith(task, { set: { priority: "high" } });

    const title = screen.getByRole("textbox", { name: "任务标题" });
    await userEvent.fill(title, "发布 1.3");
    await userEvent.keyboard("{Enter}");
    expect(write).toHaveBeenLastCalledWith(task, { set: { title: "发布 1.3" } });
  });
});
