import { EnvironmentId, Telescope } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { Sidebar, SidebarContent, SidebarProvider, useSidebarVisibility } from "../ui/sidebar";
import { TelescopeChatPage } from "./TelescopeChatPage";

const mocks = vi.hoisted(() => ({ agentId: "a" as string | null }));
const agents = ["a", "b"].map((id) => ({ id, name: id }) as unknown as Telescope.Agent);

vi.mock("./telescopeViews", () => ({ useChatAgentId: () => mocks.agentId }));
vi.mock("./telescopeState", () => ({
  telescope: { get: () => null },
  useTelescopeWorkspaces: () => ({
    environmentId: EnvironmentId.make("env"),
    current: { id: "w", kind: "personal" },
  }),
}));
vi.mock("./myTeamsShared", () => ({
  agentDisplayName: (agent: Telescope.Agent) => agent.name,
  telescopeAgents: {
    listMine: () => null,
    openThread: { permissionAtom: () => Atom.make(false) },
  },
}));
// The agent list answers every read; with no `self` the chat itself stays loading.
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: { agents }, error: null }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => () => undefined }));
vi.mock("../../state/entities", () => ({ useQuietThreadShell: () => null }));
vi.mock("../../state/shell", () => ({ useEnvironmentShellStatus: () => null }));
vi.mock("../../threadRoutes", () => ({ isThreadRouteSnapshotAuthoritative: () => true }));
vi.mock("../ChatView", () => ({ default: () => null }));
vi.mock("./TelescopeAccountDialogs", () => ({ ErrorNote: () => null }));
vi.mock("./TelescopeNeedsYou", () => ({
  TelescopeNeedsYou: ({ agent }: { agent: Telescope.Agent }) => <section>strip {agent.id}</section>,
}));

// Like the Telescope sidebar, the list renders only while the sidebar is open.
function AgentList() {
  return useSidebarVisibility() ? (
    <SidebarContent>
      <button type="button">我的 Agents</button>
    </SidebarContent>
  ) : null;
}

function setup(agentId: string | null = "a") {
  mocks.agentId = agentId;
}

describe("TelescopeChatPage", () => {
  it("shows only the selected agent's 需要你定 and 委派 after switching agents", async () => {
    setup();
    await using screen = await render(<TelescopeChatPage />);
    await expect.element(screen.getByText("strip a")).toBeInTheDocument();

    mocks.agentId = "b";
    await screen.rerender(<TelescopeChatPage />);
    await expect.element(screen.getByText("strip b")).toBeInTheDocument();
    const strips = [...screen.container.querySelectorAll("section")].map((at) => at.textContent);
    expect(strips).toEqual(["strip b"]);
  });

  it("offers to open the agent list when no agent is chosen and the sidebar hides it", async () => {
    setup(null);
    await page.viewport(1280, 800);
    await using screen = await render(
      <SidebarProvider defaultOpen={false}>
        <TelescopeChatPage />
      </SidebarProvider>,
    );
    const openList = screen.getByRole("button", { name: "打开 agent 列表" });
    await expect.element(openList).toBeVisible();

    await userEvent.click(openList);
    await expect.element(openList).not.toBeInTheDocument();
  });

  it("moves keyboard focus into the agent list it opens", async () => {
    setup(null);
    await page.viewport(1280, 800);
    await using screen = await render(
      <SidebarProvider defaultOpen={false}>
        <Sidebar>
          <AgentList />
        </Sidebar>
        <TelescopeChatPage />
      </SidebarProvider>,
    );
    screen.getByRole("button", { name: "打开 agent 列表" }).element().focus();

    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByRole("button", { name: "我的 Agents" })).toHaveFocus();
  });

  it("leaves focus out of the agent list when a pointer opens it", async () => {
    setup(null);
    await page.viewport(1280, 800);
    await using screen = await render(
      <SidebarProvider defaultOpen={false}>
        <Sidebar>
          <AgentList />
        </Sidebar>
        <TelescopeChatPage />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "打开 agent 列表" }));
    await expect.element(screen.getByRole("button", { name: "我的 Agents" })).toBeVisible();
    expect(document.activeElement).toBe(document.body);
  });
});
