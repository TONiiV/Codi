import "../index.css";
import { parse } from "culori/fn";
import { StrictMode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { syncBrowserChromeTheme } from "../hooks/useTheme";
import { setThemeBackdropUnavailable } from "../themeBackdrop";
import { ThemeBackdrop } from "./ThemeBackdrop";

const STORAGE_KEY = "t3code.themeBackdrop";

function setup(): Disposable {
  setThemeBackdropUnavailable(false);
  localStorage.setItem(STORAGE_KEY, "true");
  return { [Symbol.dispose]: () => localStorage.removeItem(STORAGE_KEY) };
}

const backdropActive = () => document.documentElement.hasAttribute("data-theme-backdrop");

function contextOf(container: HTMLElement) {
  const context = container.querySelector("canvas")?.getContext("webgl2");
  if (!context) throw new Error("backdrop canvas has no WebGL2 context");
  return context;
}

it("keeps a live context through a StrictMode effect replay", async () => {
  using _setup = setup();
  await using screen = await render(
    <StrictMode>
      <ThemeBackdrop />
    </StrictMode>,
    { router: false },
  );
  await vi.waitFor(() => expect(backdropActive()).toBe(true));
  expect(contextOf(screen.container).isContextLost()).toBe(false);
});

it("comes back when the browser restores a lost context", async () => {
  using _setup = setup();
  await using screen = await render(<ThemeBackdrop />, { router: false });
  await vi.waitFor(() => expect(backdropActive()).toBe(true));
  const loseContext = contextOf(screen.container).getExtension("WEBGL_lose_context");
  if (!loseContext) throw new Error("WEBGL_lose_context is unavailable");

  loseContext.loseContext();
  await vi.waitFor(() => expect(backdropActive()).toBe(false));
  loseContext.restoreContext();
  await vi.waitFor(() => expect(backdropActive()).toBe(true));
});

it("gives the browser chrome an opaque color while the backdrop veils the main surface", async () => {
  using _setup = setup();
  const main = document.createElement("main");
  main.dataset.slot = "sidebar-inset";
  document.body.append(main);
  using _main = { [Symbol.dispose]: () => main.remove() };
  await using _screen = await render(<ThemeBackdrop />, { router: false });
  await vi.waitFor(() => expect(backdropActive()).toBe(true));

  syncBrowserChromeTheme();

  const chromeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;
  expect(parse(chromeColor ?? "")?.alpha ?? 1).toBe(1);
});
