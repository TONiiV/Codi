import { useEffect, useRef, useState } from "react";

import {
  backdropRenderSize,
  isSoftwareRenderer,
  resolveBackdropColors,
  shouldRenderFrame,
  THEME_BACKDROP_FRAME_INTERVAL_MS,
  useThemeBackdropEnabled,
} from "../themeBackdrop";
import { getStandardPaintedThemeColors, getThemeColorVariable } from "../themePalette";

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
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

const TIME_SCALE = 0.15;
const ACTIVE_ATTRIBUTE = "data-theme-backdrop";

function compileProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX_SHADER],
    [gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
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
function startThemeBackdrop(canvas: HTMLCanvasElement, onLost: () => void): (() => void) | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  const program = gl ? compileProgram(gl) : null;
  if (!gl || !program) return null;
  gl.useProgram(program);
  const uRes = gl.getUniformLocation(program, "uRes");
  const uTime = gl.getUniformLocation(program, "uTime");
  const uNight = gl.getUniformLocation(program, "uNight");
  const uBlue = gl.getUniformLocation(program, "uBlue");
  const uGlow = gl.getUniformLocation(program, "uGlow");

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
    if (document.hidden) return;
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
  const onContextLost = () => {
    cancelAnimationFrame(frame);
    root.removeAttribute(ACTIVE_ATTRIBUTE);
    onLost();
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
    // A lost context stays on the canvas, so a StrictMode replay on the same element would get a dead one.
    if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}

/** Animated fluid canvas behind the app shell, tinted by the active theme. Off by default. */
export function ThemeBackdrop() {
  const [enabled] = useThemeBackdropEnabled();
  const [unavailable, setUnavailable] = useState(false);
  // Turning the setting off and on again retries after a lost or missing WebGL context.
  if (!enabled && unavailable) setUnavailable(false);
  if (!enabled || unavailable) return null;
  return <ThemeBackdropCanvas onUnavailable={setUnavailable} />;
}

function ThemeBackdropCanvas({ onUnavailable }: { onUnavailable: (unavailable: true) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Owns the WebGL context, its rAF loop, and the window/theme listeners; torn down on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    const stop = canvas ? startThemeBackdrop(canvas, () => onUnavailable(true)) : null;
    if (!stop) onUnavailable(true);
    return stop ?? undefined;
  }, [onUnavailable]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 size-full select-none"
    />
  );
}
