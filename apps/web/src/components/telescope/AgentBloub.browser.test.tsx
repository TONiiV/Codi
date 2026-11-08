import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers, render } from "../../../test/render";
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
    await using screen = await render(
      <div style={{ display: "flex" }}>
        <div style={{ position: "fixed", top: "200vh" }}>
          <AgentBloub seed="off-screen" activity="working" size={32} />
        </div>
        {ids.map((id) => (
          <AgentBloub key={id} seed={id} activity="working" size={32} />
        ))}
      </div>,
    );
    const canvases = [...screen.container.querySelectorAll("canvas")];
    const first = canvases.map((canvas) => canvas.toDataURL());
    const moved = () => canvases.filter((canvas, i) => canvas.toDataURL() !== first[i]).length;
    // Every awake avatar draws in the same frame, so an uncapped one would move with the six.
    await vi.waitFor(() => expect(moved()).toBeGreaterThanOrEqual(LOOP_CAP));
    expect(moved()).toBe(LOOP_CAP);
    expect(canvases[0]?.toDataURL()).toBe(first[0]);
  });

  it("plays a look once under a parked pointer and keeps working loops at 12 fps", async () => {
    await using screen = await render(
      <div style={{ display: "flex" }}>
        <AgentBloub seed="idle-agent" activity="idle" size={32} />
        <AgentBloub seed="agent-1" activity="working" size={32} />
        <AgentBloub seed="agent-2" activity="working" size={32} />
      </div>,
    );
    using _frames = fakeTimers();
    using clears = vi.spyOn(CanvasRenderingContext2D.prototype, "clearRect");
    const [idle, ...working] = [...screen.container.querySelectorAll("canvas")];
    const draws = (canvas: HTMLCanvasElement | undefined) =>
      clears.mock.contexts.filter((ctx) => ctx === canvas?.getContext("2d")).length;
    // The loop is on the fake frame clock once it waits on a fake timer.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));

    const box = idle!.getBoundingClientRect();
    idle!.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
        clientX: box.left + box.width / 2,
        clientY: box.top,
      }),
    );
    clears.mockClear();
    vi.advanceTimersByTime(1000);
    expect(draws(idle)).toBeGreaterThan(12);
    for (const canvas of working) expect(draws(canvas)).toBeLessThanOrEqual(12);

    vi.advanceTimersByTime(1500);
    clears.mockClear();
    vi.advanceTimersByTime(3000);
    expect(draws(idle)).toBe(0);
    for (const canvas of working) expect(draws(canvas)).toBeGreaterThan(24);
    for (const canvas of working) expect(draws(canvas)).toBeLessThanOrEqual(36);
  });
});

describe("agent bloub label", () => {
  it.each([
    { activity: "working", name: "运行中" },
    { activity: "waiting", name: "等你决定" },
    { activity: "blocked", name: "已急停" },
  ] as const)("names the $activity state for screen readers", async ({ activity, name }) => {
    await using screen = await render(<AgentBloub seed="agent" activity={activity} size={32} />);
    await expect.element(screen.getByRole("img", { name })).toBeInTheDocument();
  });
});
