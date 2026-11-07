import { Telescope } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { LeaseField } from "./TaskDrawer";

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
