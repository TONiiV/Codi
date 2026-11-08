import "../../index.css";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent, type Locator } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { TelescopeModeSwitch } from "./TelescopeModeSwitch";

const running = (element: Element) =>
  element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running");

// The resting icon is the capsule's first svg; the open capsule hides it.
const restingIcon = (capsule: Element) => capsule.querySelector("svg")!;

const ways = {
  pointer: {
    open: (capsule: Locator) => userEvent.hover(capsule),
    close: (capsule: Locator) => userEvent.unhover(capsule),
  },
  keyboard: {
    open: () => userEvent.tab(),
    close: () => userEvent.tab({ shift: true }),
  },
};

it.each(["pointer", "keyboard"] as const)(
  "leaves the resting icon still after a switch made elsewhere while the capsule is open by %s",
  async (way) => {
    await page.viewport(1440, 900);
    await using screen = await render(<TelescopeModeSwitch />, { router: "/telescope" });
    const capsule = screen.getByRole("group");
    await ways[way].open(capsule);
    await act(() => screen.router!.navigate({ href: "/" }));
    await ways[way].close(capsule);
    await vi.waitFor(() => expect(running(restingIcon(capsule.element()))).toEqual([]));
  },
);

it("plays the resting icon once for a switch made elsewhere, not again when the window crosses md", async () => {
  await page.viewport(1440, 900);
  await using screen = await render(<TelescopeModeSwitch />, { router: "/telescope" });
  await act(() => screen.router!.navigate({ href: "/" }));
  const icon = restingIcon(screen.getByRole("group").element());
  // A token row ends while the rest of the run plays on.
  const token = icon.querySelector("rect")!;
  await act(() => token.dispatchEvent(new AnimationEvent("animationend", { bubbles: true })));
  expect(icon.hasAttribute("data-glyph-play")).toBe(true);

  for (const animation of running(icon)) animation.finish();
  await vi.waitFor(() => expect(icon.hasAttribute("data-glyph-play")).toBe(false));
  await page.viewport(400, 900);
  await page.viewport(1440, 900);
  expect(running(icon)).toEqual([]);
});
