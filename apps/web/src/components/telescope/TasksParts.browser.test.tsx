import { EnvironmentId, Telescope } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { useBoardPeople } from "./TasksParts";

const DATA = vi.hoisted(() => ({
  members: {
    members: [
      { subjectId: "me", displayName: "我" },
      { subjectId: "gone", displayName: "老王", revokedAt: "2026-11-02T00:00:00.000Z" },
    ],
  },
  agents: { agents: [{ id: "a-mine", name: "我的 agent" }] },
  // The server's company list keeps the caller's own agent when it is not hidden.
  companyAgents: {
    agents: [
      { id: "a-mine", name: "我的 agent" },
      { id: "a-other", name: "别人的 agent" },
    ],
  },
}));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: ((atom: { kind: keyof typeof DATA }) =>
    AsyncResult.success(DATA[atom.kind])) as never,
}));
vi.mock(import("./telescopeState"), async (original) => ({
  ...(await original()),
  telescope: { members: () => ({ kind: "members" }) } as never,
  telescopeBoard: {
    agents: () => ({ kind: "agents" }),
    companyAgents: () => ({ kind: "companyAgents" }),
  } as never,
}));

function People() {
  const people = useBoardPeople({
    environmentId: EnvironmentId.make("env"),
    workspaceId: Telescope.WorkspaceId.make("w"),
  });
  return (
    <p>
      {`pick ${people.members.map((member) => member.displayName).join()}`}
      {` agents ${people.agents.map((agent) => agent.id).join()}`}
      {` gone ${people.name("gone")}`}
    </p>
  );
}

describe("useBoardPeople", () => {
  it("keeps a removed member's name but offers only current members and each agent once", async () => {
    await using screen = await render(<People />, { router: false }); // no routes: a bare hook probe
    await expect
      .element(screen.getByRole("paragraph"))
      .toHaveTextContent("pick 我 agents a-mine,a-other gone 老王");
  });
});
