import { EnvironmentId, Telescope } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { TelescopeChatPage } from "./TelescopeChatPage";

const mocks = vi.hoisted(() => ({ agentId: "a" }));
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
vi.mock("./AgentAvatar", () => ({ AgentAvatar: () => null }));
vi.mock("./TelescopeNeedsYou", () => ({
  TelescopeNeedsYou: ({ agent }: { agent: Telescope.Agent }) => <section>strip {agent.id}</section>,
}));

function setup() {
  mocks.agentId = "a";
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
});
