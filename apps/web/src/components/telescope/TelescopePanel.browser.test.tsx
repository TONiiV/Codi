import { EnvironmentId, Telescope } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  selectThreadRightPanelState,
  telescopePanelRef,
  useRightPanelStore,
} from "../../rightPanelStore";
import { TelescopePanel } from "./TelescopePanel";

const ENV = EnvironmentId.make("env");
const assistant = { id: "pa", name: "助理", kind: "chief_of_staff" } as unknown as Telescope.Agent;

vi.mock(import("./telescopeState"), async (original) => {
  const real = await original();
  return {
    ...real,
    useTelescopeWorkspaces: () =>
      ({ environmentId: ENV, current: { id: "w", kind: "personal" } }) as never,
    telescopeBoard: {
      ...real.telescopeBoard,
      task: ({ input }: { input: { taskId: string } }) => ({ taskId: input.taskId }) as never,
    },
  };
});
vi.mock("./TaskPanel", () => ({
  TaskDetail: (props: { taskId: string }) => <p>task body {props.taskId}</p>,
}));
vi.mock(import("./myTeamsShared"), async (original) => ({
  ...(await original()),
  agentDisplayName: (agent: Telescope.Agent) => agent.name,
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((query: { taskId?: string } | null) => ({
    data: query?.taskId ? { title: `任务 ${query.taskId}` } : { agents: [assistant] },
    error: null,
  })) as never,
}));
vi.mock(import("./TelescopeChatPage"), () => ({ AgentChat: () => <p>side chat body</p> }) as never);

const panelRef = telescopePanelRef(ENV);
const panelState = () =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, panelRef);

async function setup() {
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  // Below 981 px the panel is a sheet in a portal.
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1400, 900);
  return { [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height) };
}

describe("TelescopePanel", () => {
  it("toggles and maximizes on the desktop's forwarded menu actions", async () => {
    await using _viewport = await setup();
    let menuAction: ((action: string) => void) | undefined;
    window.desktopBridge = {
      onMenuAction: (listener: (action: string) => void) => {
        menuAction = listener;
        return () => {
          menuAction = undefined;
        };
      },
    } as unknown as NonNullable<typeof window.desktopBridge>;
    using _bridge = { [Symbol.dispose]: () => delete window.desktopBridge };
    await using _screen = await render(<TelescopePanel panelRef={panelRef} layoutElement={null} />);

    menuAction?.("rightPanel.toggle");
    await vi.waitFor(() => expect(panelState().isOpen).toBe(true));
    menuAction?.("rightPanel.toggleMaximized");
    await vi.waitFor(() => expect(panelState().maximized).toBe(true));
    menuAction?.("rightPanel.toggle");
    await vi.waitFor(() => expect(panelState().isOpen).toBe(false));
  });

  describe("task tabs", () => {
    const taskTabs = () =>
      panelState().surfaces.flatMap((surface) => (surface.kind === "task" ? [surface.taskId] : []));
    const searchTask = (screen: Awaited<ReturnType<typeof render>>) =>
      (screen.router!.state.location.search as { task?: string }).task;
    const taskSearch = (id: string) => ({
      view: "tasks" as const,
      task: Telescope.TaskId.make(id),
    });

    function mountRow() {
      const row = document.createElement("div");
      row.style.width = "1000px";
      document.body.append(row);
      return { row, [Symbol.dispose]: () => row.remove() };
    }

    it("opens the task named by the URL at 60% of the row, follows the row, and closing its tab clears the param", async () => {
      await using _viewport = await setup();
      using mount = mountRow();
      await using screen = await render(
        <TelescopePanel panelRef={panelRef} layoutElement={mount.row} />,
        { router: "/telescope?view=tasks&task=t1" },
      );

      await expect.element(page.getByText("task body t1")).toBeVisible();
      expect(taskTabs()).toEqual(["t1"]);
      const host = document.querySelector<HTMLElement>('[style*="--resizable-width"]')!;
      expect(host.style.getPropertyValue("--resizable-width")).toBe("600px");

      mount.row.style.width = "1200px";
      await vi.waitFor(() =>
        expect(host.style.getPropertyValue("--resizable-width")).toBe("720px"),
      );
      expect(searchTask(screen)).toBe("t1");

      await userEvent.click(page.getByRole("button", { name: "Close 任务 t1" }));
      await vi.waitFor(() => expect(taskTabs()).toEqual([]));
      await vi.waitFor(() => expect(searchTask(screen)).toBeUndefined());
    });

    it("opens a second task as a second tab, and choosing the first tab clears the param", async () => {
      await using _viewport = await setup();
      using mount = mountRow();
      await using screen = await render(
        <TelescopePanel panelRef={panelRef} layoutElement={mount.row} />,
        { router: "/telescope?view=tasks&task=t1" },
      );
      await expect.element(page.getByText("task body t1")).toBeVisible();

      await screen.router!.navigate({ to: "/telescope", search: taskSearch("t2") });
      await expect.element(page.getByText("task body t2")).toBeVisible();
      expect(taskTabs()).toEqual(["t1", "t2"]);

      await userEvent.click(page.getByRole("button", { name: "任务 t1", exact: true }));
      await expect.element(page.getByText("task body t1")).toBeVisible();
      await vi.waitFor(() => expect(searchTask(screen)).toBeUndefined());
      expect(taskTabs()).toEqual(["t1", "t2"]);

      await screen.router!.navigate({ to: "/telescope", search: taskSearch("t1") });
      await vi.waitFor(() => expect(searchTask(screen)).toBe("t1"));
      await expect.element(page.getByText("task body t1")).toBeVisible();
    });
  });
});
