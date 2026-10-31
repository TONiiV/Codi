import { describe, expect, it } from "vite-plus/test";

import {
  backdropRenderSize,
  isSoftwareRenderer,
  shouldRenderFrame,
  THEME_BACKDROP_FRAME_INTERVAL_MS,
} from "./themeBackdrop";

describe("backdropRenderSize", () => {
  it.each([
    { css: [1440, 900], dpr: 2, expected: { width: 720, height: 450 } },
    { css: [1440, 900], dpr: 1, expected: { width: 360, height: 225 } },
    { css: [1001, 3], dpr: 1.5, expected: { width: 375, height: 1 } },
    { css: [0, 0], dpr: 2, expected: { width: 1, height: 1 } },
  ])("renders $css at dpr $dpr as $expected.width x $expected.height", ({ css, dpr, expected }) => {
    expect(backdropRenderSize(css[0]!, css[1]!, dpr)).toEqual(expected);
  });
});

describe("isSoftwareRenderer", () => {
  it.each([
    ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", true],
    ["llvmpipe (LLVM 15.0.7, 256 bits)", true],
    ["ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)", true],
    ["ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)", false],
    ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", false],
    ["", false],
  ])("%s -> %s", (renderer, expected) => {
    expect(isSoftwareRenderer(renderer)).toBe(expected);
  });
});

describe("shouldRenderFrame", () => {
  const frameRate = (refreshHz: number, ticks: number) => {
    let last = Number.NEGATIVE_INFINITY;
    let rendered = 0;
    for (let tick = 0; tick < ticks; tick += 1) {
      const now = (tick * 1000) / refreshHz;
      if (!shouldRenderFrame(now, last, THEME_BACKDROP_FRAME_INTERVAL_MS)) continue;
      last = now;
      rendered += 1;
    }
    return (rendered * refreshHz) / ticks;
  };

  it.each([
    [30, 30],
    [60, 30],
    [90, 30],
    [120, 30],
    [144, 28.8],
  ])("caps a %dHz display at %dfps", (refreshHz, expectedFps) => {
    expect(frameRate(refreshHz, refreshHz * 10)).toBeCloseTo(expectedFps, 0);
  });

  it("keeps 30fps when 60Hz timestamps arrive slightly early", () => {
    expect(shouldRenderFrame(1000 + 32.9, 1000, THEME_BACKDROP_FRAME_INTERVAL_MS)).toBe(true);
    expect(shouldRenderFrame(1000 + 16.7, 1000, THEME_BACKDROP_FRAME_INTERVAL_MS)).toBe(false);
  });
});
