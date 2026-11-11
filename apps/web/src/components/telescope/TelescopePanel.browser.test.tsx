import { EnvironmentId, Telescope } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  selectThreadRightPanelState,
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
});
