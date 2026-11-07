import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import AgentBloub, { agentSkin, LOOP_CAP } from "./AgentBloub";

describe("agent bloub seed", () => {
  it.each([
    { id: "agent-chief-of-staff", shape: "galet", ink: "#2fbfa0" },
    { id: "01J0000000000000000000HR", shape: "capsule", ink: "#f0b429" },
    { id: "f3b1c2d4-0000-4000-8000-000000000001", shape: "cercle", ink: "#a3a3a3" },
  ])("gives $id the same shape and colour every time", ({ id, shape, ink }) => {
    expect([agentSkin(id).shape.id, agentSkin(id).ink]).toEqual([shape, ink]);
    expect(agentSkin(id)).toEqual(agentSkin(id));
  });

  it("spreads different agents over every shape and colour", () => {
    const skins = Array.from({ length: 200 }, (_, i) => agentSkin(`agent-${i}`));
    expect(new Set(skins.map((skin) => skin.shape.id)).size).toBe(8);
    expect(new Set(skins.map((skin) => skin.ink)).size).toBe(11);
  });
});

describe("agent bloub loop", () => {
  it(`keeps an off-screen avatar and one past the first ${LOOP_CAP} on their still frames`, async () => {
    const ids = Array.from({ length: LOOP_CAP + 1 }, (_, i) => `agent-${i}`);
    // Inline sizes: browser tests load no stylesheet.
    await using screen = await render(
      <div style={{ display: "flex" }}>
        <div style={{ position: "fixed", top: "200vh", width: 32, height: 32 }}>
          <AgentBloub seed="off-screen" activity="working" />
        </div>
        {ids.map((id) => (
          <div key={id} style={{ width: 32, height: 32 }}>
            <AgentBloub seed={id} activity="working" />
          </div>
        ))}
      </div>,
    );
    const svgs = [...screen.container.querySelectorAll("svg")];
    const first = svgs.map((svg) => svg.innerHTML);
    const moved = () => svgs.filter((svg, i) => svg.innerHTML !== first[i]).length;
    // Every awake avatar draws in the same frame, so an uncapped one would move with the six.
    await vi.waitFor(() => expect(moved()).toBeGreaterThanOrEqual(LOOP_CAP));
    expect(moved()).toBe(LOOP_CAP);
    expect(svgs[0]?.innerHTML).toBe(first[0]);
  });
});
