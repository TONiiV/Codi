import "../index.css";
import { parse } from "culori/fn";
import { StrictMode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { syncBrowserChromeTheme } from "../hooks/useTheme";
import { setThemeBackdropUnavailable } from "../themeBackdrop";
import { getThemeColorVariable } from "../themePalette";
import { ThemeBackdrop } from "./ThemeBackdrop";

const STORAGE_KEY = "t3code.themeBackdrop";
const STYLE_STORAGE_KEY = "t3code.themeBackdropStyle";

function setup(style: "fluid" | "ascii" = "fluid"): Disposable {
  setThemeBackdropUnavailable(false);
  localStorage.setItem(STORAGE_KEY, "true");
  localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(style));
  return {
    [Symbol.dispose]: () => {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STYLE_STORAGE_KEY);
    },
  };
}

const backdropActive = () => document.documentElement.hasAttribute("data-theme-backdrop");

function contextOf(container: HTMLElement) {
  const context = container.querySelector("canvas")?.getContext("webgl2");
  if (!context) throw new Error("backdrop canvas has no WebGL2 context");
  return context;
}

it.each(["fluid", "ascii"] as const)(
  "keeps a live %s context through a StrictMode effect replay",
  async (style) => {
    using _setup = setup(style);
    await using screen = await render(
      <StrictMode>
        <ThemeBackdrop />
      </StrictMode>,
      { router: false }, // no routes involved
    );
    await vi.waitFor(() => expect(backdropActive()).toBe(true));
    expect(contextOf(screen.container).isContextLost()).toBe(false);
  },
);

it("comes back when the browser restores a lost context", async () => {
  using _setup = setup();
  await using screen = await render(<ThemeBackdrop />, { router: false }); // no routes involved
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
  await using _screen = await render(<ThemeBackdrop />, { router: false }); // no routes involved
  await vi.waitFor(() => expect(backdropActive()).toBe(true));

  syncBrowserChromeTheme();

  const chromeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;
  expect(parse(chromeColor ?? "")?.alpha ?? 1).toBe(1);
});

it("colors the ASCII image with the current theme accent", async () => {
  using _setup = setup("ascii");
  const root = document.documentElement;
  const canvasColor = getThemeColorVariable("canvas");
  const accentColor = getThemeColorVariable("accent");
  const previousCanvas = root.style.getPropertyValue(canvasColor);
  const previousAccent = root.style.getPropertyValue(accentColor);
  root.style.setProperty(canvasColor, "#000000");
  root.style.setProperty(accentColor, "#ff0000");
  using _colors = {
    [Symbol.dispose]: () => {
      root.style.setProperty(canvasColor, previousCanvas);
      root.style.setProperty(accentColor, previousAccent);
    },
  };
  await using screen = await render(<ThemeBackdrop />, { router: false }); // no routes involved
  const canvas = screen.container.querySelector("canvas");
  if (!canvas) throw new Error("missing backdrop canvas");
  const gl = contextOf(screen.container);
  const pixel = new Uint8Array(4);
  const samples = () => {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return [0.2, 0.5, 0.8].flatMap((x) =>
      [0.2, 0.5, 0.8].map((y) => {
        gl.readPixels(
          Math.floor(canvas.width * x),
          Math.floor(canvas.height * y),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        return [pixel[0]!, pixel[1]!, pixel[2]!] as const;
      }),
    );
  };
  await vi.waitFor(() => {
    const colors = samples();
    const reds = colors.map((color) => color[0]);
    expect(Math.max(...reds) - Math.min(...reds)).toBeGreaterThan(25);
    expect(colors.every((color) => color[1] === 0 && color[2] === 0)).toBe(true);
  });

  root.style.setProperty(accentColor, "#0000ff");
  await vi.waitFor(() => {
    const colors = samples();
    expect(colors.some((color) => color[2] > 25)).toBe(true);
    expect(colors.every((color) => color[0] === 0 && color[1] === 0)).toBe(true);
  });
});
