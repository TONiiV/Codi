import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, Telescope, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  hostRightPanel,
  selectThreadRightPanelState,
  TELESCOPE_SIDE_CHAT,
  telescopePanelRef,
  useRightPanelStore,
} from "../../rightPanelStore";
import { TelescopePanel } from "./TelescopePanel";

const ENV = EnvironmentId.make("env");
const assistant = { id: "pa", name: "助理", kind: "chief_of_staff" } as unknown as Telescope.Agent;

vi.mock(import("./telescopeState"), async (original) => ({
  ...(await original()),
  useTelescopeWorkspaces: () =>
    ({ environmentId: ENV, current: { id: "w", kind: "personal" } }) as never,
}));
vi.mock(import("./telescopeViews"), async (original) => ({
  ...(await original()),
  useTaskDrawerId: () => null,
}));
vi.mock(import("./myTeamsShared"), async (original) => ({
  ...(await original()),
  agentDisplayName: (agent: Telescope.Agent) => agent.name,
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: () => ({ data: { agents: [assistant] }, error: null }) as never,
}));
vi.mock(import("./TelescopeChatPage"), () => ({ AgentChat: () => <p>side chat body</p> }) as never);

const panelRef = telescopePanelRef(ENV);
const panelKinds = () =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, panelRef).surfaces.map(
    (surface) => surface.kind,
  );

async function setup() {
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
  // Below 981 px the panel is a sheet in a portal.
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1400, 900);
  return { [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height) };
}

describe("TelescopePanel", () => {
  it("keeps the side chat when a hosted chat opens a file or a pull request", async () => {
    await using _viewport = await setup();
    const agentThread = scopeThreadRef(ENV, ThreadId.make("agent-thread"));
    using _host = { [Symbol.dispose]: hostRightPanel(agentThread, panelRef) };
    const store = useRightPanelStore.getState();
    store.openSideChat(panelRef, TELESCOPE_SIDE_CHAT);
    await using screen = await render(<TelescopePanel panelRef={panelRef} layoutElement={null} />);
    await expect.element(screen.getByText("side chat body")).toBeVisible();

    store.openFile(agentThread, "src/app.ts");
    store.openPullRequest(agentThread, { projectId: "p", repository: "o/r", number: 7 });
    await expect.element(screen.getByText("side chat body")).toBeVisible();
    expect(screen.getByLabelText("Open a surface").query()).toBeNull();
    expect(panelKinds()).toEqual(["side-chat"]);
  });

  it("drops stored tabs Telescope does not offer", async () => {
    await using _viewport = await setup();
    const { storage, name } = useRightPanelStore.persist.getOptions();
    const sideChat = `side-chat:${TELESCOPE_SIDE_CHAT}`;
    await storage!.setItem(name!, {
      // Builds that saved this let hosted chats add tabs Telescope does not offer.
      version: 14,
      state: {
        byThreadKey: {
          [scopedThreadKey(panelRef)]: {
            isOpen: true,
            activeSurfaceId: "file:src/app.ts",
            surfaces: [
              { id: sideChat, kind: "side-chat", threadId: TELESCOPE_SIDE_CHAT },
              {
                id: "file:src/app.ts",
                kind: "file",
                relativePath: "src/app.ts",
                revealLine: null,
                revealRequestId: 1,
              },
            ],
          },
        },
      },
    });
    await useRightPanelStore.persist.rehydrate();
    await using screen = await render(<TelescopePanel panelRef={panelRef} layoutElement={null} />);
    await expect.element(screen.getByText("side chat body")).toBeVisible();
    expect(panelKinds()).toEqual(["side-chat"]);
  });
});
