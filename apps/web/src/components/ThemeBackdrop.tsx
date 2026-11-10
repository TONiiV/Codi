import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

import {
  backdropRenderSize,
  isSoftwareRenderer,
  resolveBackdropColors,
  setThemeBackdropUnavailable,
  shouldRenderFrame,
  THEME_BACKDROP_FRAME_INTERVAL_MS,
  useThemeBackdropEnabled,
  useThemeBackdropStyle,
  useThemeBackdropUnavailable,
  type ThemeBackdropStyle,
} from "../themeBackdrop";
import { getStandardPaintedThemeColors, getThemeColorVariable } from "../themePalette";

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FLUID_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec3 uNight; uniform vec3 uBlue; uniform vec3 uGlow;
out vec4 fragColor;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; ++i) { s += a * noise(p); p *= 2.0; a *= 0.5; }
  return s;
}
void main(){
  vec2 p = gl_FragCoord.xy / uRes.y * 3.0;
  float t = uTime;
  vec2 q = vec2(fbm(p + 0.15 * t), fbm(p + 5.2 - 0.12 * t));
  vec2 p1 = p + 4.0 * q;
  vec2 r = vec2(fbm(p1 + 1.7), fbm(p1 + 9.2));
  float v = fbm(p1 + 4.0 * r + 0.5 * t);
  vec3 col = mix(uNight, uBlue, v);
  col = mix(col, uGlow, smoothstep(0.55, 1.05, length(q)));
  fragColor = vec4(col, 1.0);
}`;

// A monochrome glyph atlas (a "character texture") sampled per cell. Characters run from blank
// (space, the darkest cells) to dense (@, the brightest), like a terminal luminance ramp.
const GLYPHS = " .:-=+*#%@";
const GLYPH_ATLAS_SIZE = 16;

const ASCII_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec3 uNight; uniform vec3 uBlue; uniform vec3 uGlow;
uniform sampler2D uGlyphs; uniform float uGlyphCount;
out vec4 fragColor;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; ++i) { s += a * noise(p); p *= 2.0; a *= 0.5; }
  return s;
}
void main(){
  float cell = max(4.0, uRes.y / 56.0);
  vec2 id = floor(gl_FragCoord.xy / cell);
  vec2 uv = fract(gl_FragCoord.xy / cell);
  float t = uTime;
  vec2 p = id / 48.0;
  float v = fbm(p + vec2(0.12 * t, -0.08 * t));
  v = fbm(p + 4.0 * v + 0.05 * t);
  float glyph = texture(uGlyphs, vec2((floor(v * uGlyphCount) + uv.x) / uGlyphCount, uv.y)).r;
  // Faint characters over the theme canvas keep the content on top readable.
  vec3 col = mix(uNight, mix(uBlue, uGlow, v), glyph * 0.3);
  fragColor = vec4(col, 1.0);
}`;

/** Draws each glyph once into an offscreen canvas, uploaded as an R8 mask texture. */
function createGlyphAtlas(gl: WebGL2RenderingContext): WebGLTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = GLYPHS.length * GLYPH_ATLAS_SIZE;
  canvas.height = GLYPH_ATLAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.font = `${GLYPH_ATLAS_SIZE}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < GLYPHS.length; i += 1) {
    ctx.fillText(GLYPHS[i]!, (i + 0.5) * GLYPH_ATLAS_SIZE, GLYPH_ATLAS_SIZE / 2);
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8,
    canvas.width,
    canvas.height,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    canvas,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

const TIME_SCALE = 0.15;
const ACTIVE_ATTRIBUTE = "data-theme-backdrop";

function compileProgram(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX_SHADER],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[ThemeBackdrop] Shader link failed.", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function readRenderer(gl: WebGL2RenderingContext): string {
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer: unknown = gl.getParameter(
    debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
  );
  return typeof renderer === "string" ? renderer : "";
}

// Theme rows and the editor's live preview write these inline on <html>; the standard theme
// leaves them unset and paints from index.css.
function readThemeColors(root: HTMLElement) {
  const standard = getStandardPaintedThemeColors(
    root.classList.contains("dark") ? "dark" : "light",
  );
  const canvas = root.style.getPropertyValue(getThemeColorVariable("canvas")).trim();
  const accent = root.style.getPropertyValue(getThemeColorVariable("accent")).trim();
  return resolveBackdropColors(canvas || standard.canvas, accent || standard.accent);
}

/** Starts rendering into `canvas`; returns its teardown, or null when WebGL2 is unavailable. */
function startThemeBackdrop(
  canvas: HTMLCanvasElement,
  onRestored: () => void,
  style: ThemeBackdropStyle,
): (() => void) | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  const program = gl
    ? compileProgram(gl, style === "ascii" ? ASCII_FRAGMENT_SHADER : FLUID_FRAGMENT_SHADER)
    : null;
  if (!gl || !program) return null;
  gl.useProgram(program);
  const uRes = gl.getUniformLocation(program, "uRes");
  const uTime = gl.getUniformLocation(program, "uTime");
  const uNight = gl.getUniformLocation(program, "uNight");
  const uBlue = gl.getUniformLocation(program, "uBlue");
  const uGlow = gl.getUniformLocation(program, "uGlow");
  if (style === "ascii") {
    const glyphs = createGlyphAtlas(gl);
    if (!glyphs) return null;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glyphs);
    gl.uniform1i(gl.getUniformLocation(program, "uGlyphs"), 0);
    gl.uniform1f(gl.getUniformLocation(program, "uGlyphCount"), GLYPHS.length);
  }

  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const softwareRendered = isSoftwareRenderer(readRenderer(gl));
  let elapsedMs = 0;
  let frame = 0;
  let lastFrameAt = Number.NEGATIVE_INFINITY;
  let colorsKey = "";

  const animated = () => !softwareRendered && !reducedMotion.matches;
  const draw = () => {
    gl.uniform1f(uTime, animated() ? (elapsedMs / 1000) * TIME_SCALE : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const drawIfStill = () => {
    if (!frame && !document.hidden) draw();
  };
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (!shouldRenderFrame(now, lastFrameAt, THEME_BACKDROP_FRAME_INTERVAL_MS)) return;
    // Capped so a resume continues the motion instead of jumping ahead by the paused time.
    elapsedMs += Math.min(now - lastFrameAt, 100);
    lastFrameAt = now;
    draw();
  };
  // Unfocused windows hold a still frame: an all-day window on another monitor would otherwise
  // repaint forever, and desktop preview capture disables throttling, which keeps
  // `document.hidden` false even while minimized.
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (document.hidden || gl.isContextLost()) return;
    draw();
    if (animated() && document.hasFocus()) frame = requestAnimationFrame(tick);
  };
  // Tracked here, not read from the canvas: a StrictMode replay reuses the canvas but builds a
  // new program, whose uRes would otherwise stay 0.
  let renderWidth = 0;
  let renderHeight = 0;
  const resize = () => {
    const { width, height } = backdropRenderSize(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio,
    );
    if (renderWidth === width && renderHeight === height) return;
    renderWidth = width;
    renderHeight = height;
    // Resizing clears the drawing buffer, so repaint now rather than flash the clear color.
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(uRes, width, height);
    if (colorsKey && !document.hidden) draw();
  };
  const syncColors = () => {
    const colors = readThemeColors(root);
    const key = JSON.stringify(colors);
    if (!colors || key === colorsKey) return;
    colorsKey = key;
    gl.uniform3fv(uNight, colors.night);
    gl.uniform3fv(uBlue, colors.blue);
    gl.uniform3fv(uGlow, colors.glow);
    drawIfStill();
  };
  const themeObserver = new MutationObserver(syncColors);
  const onContextLost = (event: Event) => {
    // Without preventDefault the browser never restores the context after a GPU reset.
    event.preventDefault();
    cancelAnimationFrame(frame);
    frame = 0;
    root.removeAttribute(ACTIVE_ATTRIBUTE);
  };

  resize();
  syncColors();
  schedule();
  root.setAttribute(ACTIVE_ATTRIBUTE, "");
  themeObserver.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("focus", schedule);
  window.addEventListener("blur", schedule);
  reducedMotion.addEventListener("change", schedule);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  return () => {
    cancelAnimationFrame(frame);
    root.removeAttribute(ACTIVE_ATTRIBUTE);
    themeObserver.disconnect();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", schedule);
    window.removeEventListener("focus", schedule);
    window.removeEventListener("blur", schedule);
    reducedMotion.removeEventListener("change", schedule);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    // A lost context stays on the canvas, so a StrictMode replay on the same element would get a dead one.
    if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}

/** Animated canvas behind the app shell, tinted by the active theme. Off by default. */
export function ThemeBackdrop() {
  const [enabled] = useThemeBackdropEnabled();
  const [style] = useThemeBackdropStyle();
  const unavailable = useThemeBackdropUnavailable();
  // A restored context remounts the canvas, so the program is rebuilt from scratch.
  const [restoreCount, setRestoreCount] = useState(0);
  if (!enabled || unavailable) return null;
  return <ThemeBackdropCanvas key={restoreCount} onRestored={setRestoreCount} style={style} />;
}

function ThemeBackdropCanvas({
  onRestored,
  style,
}: {
  onRestored: Dispatch<SetStateAction<number>>;
  style: ThemeBackdropStyle;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Owns the WebGL context, its rAF loop, and the window/theme listeners; torn down on unmount or style change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const stop = canvas
      ? startThemeBackdrop(canvas, () => onRestored((count) => count + 1), style)
      : null;
    if (!stop) setThemeBackdropUnavailable(true);
    return stop ?? undefined;
  }, [onRestored, style]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 size-full select-none"
    />
  );
}
