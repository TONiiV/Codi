import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
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
const OTHER_MACHINE = EnvironmentId.make("other");
const assistant = { id: "pa", name: "助理", kind: "chief_of_staff" } as unknown as Telescope.Agent;
const mount = (environmentId: EnvironmentId, id: string) => ({
  environmentId,
  projectId: ProjectId.make(id),
});
const PROJECTS = [
  { id: "p-app", mounts: [mount(OTHER_MACHINE, "app"), mount(ENV, "app")] },
  { id: "p-docs", mounts: [mount(ENV, "docs")] },
  { id: "p-api", mounts: [mount(ENV, "api")] },
  { id: "p-remote", mounts: [mount(OTHER_MACHINE, "app")] },
  { id: "p-empty", mounts: [] },
];
const TASK_PROJECT: Record<string, string> = { t1: "p-app", t2: "p-docs" };
const CODI_PROJECTS = ["app", "docs", "api"].map((id) => ({
  environmentId: ENV,
  id: ProjectId.make(id),
  title: id,
  workspaceRoot: `/work/${id}`,
}));

vi.mock(import("./telescopeState"), async (original) => {
  const real = await original();
  return {
    ...real,
    useTelescopeWorkspaces: () =>
      ({ environmentId: ENV, current: { id: "w", kind: "personal" } }) as never,
    telescope: { ...real.telescope, projects: () => ({ projects: true }) as never },
    telescopeBoard: {
      ...real.telescopeBoard,
      task: ({ input }: { input: { taskId: string } }) => ({ taskId: input.taskId }) as never,
    },
  };
});
vi.mock("../files/FilePreviewPanel", () => ({
  default: (props: {
    cwd: string;
    relativePath: string | null;
    attachment?: { name: string };
    onOpenFile: (relativePath: string) => void;
    onNavigateFolder: (relativePath: string, folderTrail: string) => void;
  }) =>
    props.attachment ? (
      <p>attachment {props.attachment.name}</p>
    ) : (
      <div>
        <p>
          files of {props.cwd}
          {props.relativePath === null ? "" : ` at ${props.relativePath}`}
        </p>
        <button type="button" onClick={() => props.onOpenFile("src/app.ts")}>
          open app.ts
        </button>
        <button type="button" onClick={() => props.onNavigateFolder("", props.relativePath ?? "")}>
          go to root
        </button>
      </div>
    ),
}));
const codiProject = (ref: { environmentId: EnvironmentId; projectId: ProjectId } | null) =>
  CODI_PROJECTS.find(
    (entry) => entry.environmentId === ref?.environmentId && entry.id === ref.projectId,
  ) ?? null;
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => CODI_PROJECTS) as never,
  useProject: ((ref: Parameters<typeof codiProject>[0]) => codiProject(ref)) as never,
  readProject: ((ref: Parameters<typeof codiProject>[0]) => codiProject(ref)) as never,
}));
vi.mock(import("~/localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: (() => ({ contextMenu: { show: async () => "copy-path" } })) as never,
}));
vi.mock("./TaskPanel", () => ({
  TaskDetail: (props: { taskId: string }) => <p>task body {props.taskId}</p>,
}));
vi.mock(import("./myTeamsShared"), async (original) => ({
  ...(await original()),
  agentDisplayName: (agent: Telescope.Agent) => agent.name,
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((query: { taskId?: string; projects?: true } | null) => ({
    data: query?.projects
      ? { projects: PROJECTS }
      : query?.taskId
        ? { title: `任务 ${query.taskId}`, projectId: TASK_PROJECT[query.taskId] }
        : { agents: [assistant] },
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
  describe("Files", () => {
    const launcher = () => page.getByLabelText("Open a surface");
    const remoteNames = () => page.getByText("另一台机器上（这里打不开）：app");

    const addFiles = async () => {
      await userEvent.click(page.getByRole("button", { name: "Add panel surface" }));
      await userEvent.click(page.getByRole("menuitem", { name: /^Files/ }));
    };

    it("is greyed out with no project in context, and still shows an attachment tab", async () => {
      await using _viewport = await setup();
      await using _screen = await render(
        <TelescopePanel panelRef={panelRef} layoutElement={null} />,
        { router: "/telescope?view=tasks" },
      );
      useRightPanelStore.getState().show(panelRef);
      await expect.element(launcher().getByText("Side chat")).toBeVisible();
      // A disabled entry is a tooltip trigger, not a button.
      await vi.waitFor(() =>
        expect(launcher().getByText("Files").element().closest("[aria-disabled]")).not.toBeNull(),
      );
      useRightPanelStore.getState().openAttachment(panelRef, {
        type: "file",
        id: "att1",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 3,
      });
      await expect.element(page.getByText("attachment notes.md")).toBeVisible();
    });

    it("opens the first mount on this machine of the selected project and lists the others on each of its tabs", async () => {
      await using _viewport = await setup();
      await using _screen = await render(
        <TelescopePanel panelRef={panelRef} layoutElement={null} />,
        { router: "/telescope?view=tasks&project=p-app" },
      );
      useRightPanelStore.getState().show(panelRef);
      await userEvent.click(launcher().getByRole("button", { name: /^Files/ }));
      await expect.element(page.getByText("files of /work/app")).toBeVisible();
      await expect.element(remoteNames()).toBeVisible();
      expect(panelState().surfaces.map((surface) => surface.kind)).toEqual(["files"]);
      await userEvent.click(page.getByRole("button", { name: "open app.ts" }));
      await expect.element(page.getByText("files of /work/app at src/app.ts")).toBeVisible();
      await expect.element(remoteNames()).toBeVisible();
    });

    it("follows the open task's project over the selected one, and an open tab keeps its own mount", async () => {
      await using _viewport = await setup();
      await using screen = await render(
        <TelescopePanel panelRef={panelRef} layoutElement={null} />,
        { router: "/telescope?view=tasks&project=p-api&task=t2" },
      );
      await expect.element(page.getByText("task body t2")).toBeVisible();
      await addFiles();
      await expect.element(page.getByText("files of /work/docs")).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "open app.ts" }));
      await expect.element(page.getByText("files of /work/docs at src/app.ts")).toBeVisible();

      await screen.router!.navigate({
        to: "/telescope",
        search: { view: "tasks", project: Telescope.TelescopeProjectId.make("p-app") },
      });
      await addFiles();
      await expect.element(page.getByText("files of /work/app")).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "app.ts", exact: true }));
      await expect.element(page.getByText("files of /work/docs at src/app.ts")).toBeVisible();

      using writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
      await userEvent.click(page.getByRole("button", { name: "app.ts", exact: true }), {
        button: "right",
      });
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("src/app.ts"));

      // Its root is docs' explorer, beside app's, never app's in its place.
      await userEvent.click(page.getByRole("button", { name: "go to root" }));
      await expect.element(page.getByText("files of /work/docs")).toBeVisible();
      expect(panelState().surfaces.map((surface) => surface.id)).toEqual([
        "task:t2",
        "files:docs",
        "files:app",
      ]);
    });
  });
});
