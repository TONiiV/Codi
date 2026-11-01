import "culori/css";
import { converter, parse, type Color } from "culori/fn";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "./hooks/useLocalStorage";

const THEME_BACKDROP_STORAGE_KEY = "t3code.themeBackdrop";

/** Per-device, like the theme itself: each browser and desktop install opts in separately. */
export function useThemeBackdropEnabled() {
  return useLocalStorage(THEME_BACKDROP_STORAGE_KEY, false, Schema.Boolean);
}

// Measured: cost is linear in pixels, so a quarter per axis (1/16 the pixels) keeps the shader
// under 1ms a frame on integrated GPUs, and the soft noise field hides the upscale.
const RESOLUTION_SCALE = 0.25;
export const THEME_BACKDROP_FRAME_INTERVAL_MS = 1000 / 30;

export function backdropRenderSize(cssWidth: number, cssHeight: number, devicePixelRatio: number) {
  const scale = devicePixelRatio * RESOLUTION_SCALE;
  return {
    width: Math.max(1, Math.round(cssWidth * scale)),
    height: Math.max(1, Math.round(cssHeight * scale)),
  };
}

export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|microsoft basic render/i.test(renderer);
}

/** rAF frame skipping; the slack keeps 60Hz at 30fps when frame timestamps jitter. */
export function shouldRenderFrame(now: number, lastFrameAt: number, intervalMs: number): boolean {
  return now - lastFrameAt >= intervalMs * 0.9;
}

export type BackdropRgb = readonly [number, number, number];
export type BackdropColors = Readonly<{ night: BackdropRgb; blue: BackdropRgb; glow: BackdropRgb }>;

const toRgb = converter("rgb");
const toOklch = converter("oklch");

function rgbTuple(color: Color): BackdropRgb {
  const { r, g, b } = toRgb(color);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [clamp(r), clamp(g), clamp(b)];
}

/** Glow is the accent turned 60° in OKLCH hue and lifted in lightness. */
export function resolveBackdropColors(canvas: string, accent: string): BackdropColors | null {
  const night = parse(canvas);
  const blue = parse(accent);
  if (!night || !blue) return null;
  const { l, c, h } = toOklch(blue);
  const glow = { mode: "oklch" as const, l: Math.min(0.95, l + 0.15), c, h: ((h ?? 0) + 60) % 360 };
  return { night: rgbTuple(night), blue: rgbTuple(blue), glow: rgbTuple(glow) };
}
