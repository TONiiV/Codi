import {
  asciiBackdropRenderSize,
  backdropRenderSize,
  isSoftwareRenderer,
  resolveBackdropColors,
  setThemeBackdropUnavailable,
  shouldRenderFrame,
  THEME_BACKDROP_FRAME_INTERVAL_MS,
  type ThemeBackdropStyle,
} from "../../themeBackdrop";
import { getStandardPaintedThemeColors, getThemeColorVariable } from "../../themePalette";
import ASCII_FRAGMENT_SHADER from "./ascii-grass.frag.glsl?raw";
import FLUID_FRAGMENT_SHADER from "./fluid.frag.glsl?raw";
import VERTEX_SHADER from "./fullscreen.vert.glsl?raw";

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_COUNT = 33;

/** A compact 5×7 atlas of eight headings in four weights, plus a shadow dot. */
function createGlyphAtlas(gl: WebGL2RenderingContext): WebGLTexture | null {
  const width = GLYPH_COUNT * GLYPH_WIDTH;
  const pixels = new Uint8Array(width * GLYPH_HEIGHT);
  pixels[3 * width + 2] = 180;
  for (let weight = 0; weight < 4; weight += 1) {
    for (let bin = 0; bin < 8; bin += 1) {
      const angle = (bin * Math.PI) / 8;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const glyph = 1 + weight * 8 + bin;
      for (let y = 1; y < GLYPH_HEIGHT - 1; y += 1) {
        for (let x = 1; x < GLYPH_WIDTH - 1; x += 1) {
          let covered = 0;
          for (let sy = 0; sy < 4; sy += 1) {
            for (let sx = 0; sx < 4; sx += 1) {
              const px = x + (sx + 0.5) / 4 - 2.5;
              const py = y + (sy + 0.5) / 4 - 3.5;
              const along = px * dx + py * dy;
              const across = Math.abs(-px * dy + py * dx);
              if (Math.abs(along) < 1.1 + weight * 0.6 && across < 0.35 + weight * 0.16)
                covered += 1;
            }
          }
          pixels[y * width + glyph * GLYPH_WIDTH + x] = Math.round((covered / 16) * 255);
        }
      }
    }
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, GLYPH_HEIGHT, 0, gl.RED, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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
export function startThemeBackdrop(
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
  const uGrid = gl.getUniformLocation(program, "uGrid");
  const uTime = gl.getUniformLocation(program, "uTime");
  const uNight = gl.getUniformLocation(program, "uNight");
  const uBlue = gl.getUniformLocation(program, "uBlue");
  const uGlow = gl.getUniformLocation(program, "uGlow");
  let glyphTexture: WebGLTexture | null = null;
  let imageTexture: WebGLTexture | null = null;
  let image: HTMLImageElement | null = null;
  if (style === "ascii") {
    glyphTexture = createGlyphAtlas(gl);
    imageTexture = gl.createTexture();
    if (!glyphTexture || !imageTexture) return null;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glyphTexture);
    gl.uniform1i(gl.getUniformLocation(program, "uGlyphs"), 0);
    gl.uniform1f(gl.getUniformLocation(program, "uGlyphCount"), GLYPH_COUNT);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([16, 24, 12, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, "uImage"), 1);
    image = new Image();
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
  let gridWidth = 0;
  let gridHeight = 0;
  const resize = () => {
    const { width, height } =
      style === "ascii"
        ? asciiBackdropRenderSize(window.innerWidth, window.innerHeight)
        : backdropRenderSize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    const nextGridWidth = Math.max(1, Math.ceil(width / GLYPH_WIDTH));
    const nextGridHeight = Math.max(1, Math.ceil(height / GLYPH_HEIGHT));
    if (
      renderWidth === width &&
      renderHeight === height &&
      (style !== "ascii" || (gridWidth === nextGridWidth && gridHeight === nextGridHeight))
    )
      return;
    renderWidth = width;
    renderHeight = height;
    gridWidth = nextGridWidth;
    gridHeight = nextGridHeight;
    // Resizing clears the drawing buffer, so repaint now rather than flash the clear color.
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(uRes, width, height);
    if (style === "ascii") {
      gl.uniform2f(uGrid, gridWidth, gridHeight);
    }
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
  if (image && imageTexture) {
    const texture = imageTexture;
    const source = image;
    source.onload = () => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      drawIfStill();
    };
    source.onerror = () => setThemeBackdropUnavailable(true);
    source.src = "/backdrops/living-ascii-grass.jpg";
  }
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
    if (image) {
      image.onload = null;
      image.onerror = null;
    }
    root.removeAttribute(ACTIVE_ATTRIBUTE);
    themeObserver.disconnect();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", schedule);
    window.removeEventListener("focus", schedule);
    window.removeEventListener("blur", schedule);
    reducedMotion.removeEventListener("change", schedule);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    gl.deleteTexture(glyphTexture);
    gl.deleteTexture(imageTexture);
    gl.deleteProgram(program);
    // A lost context stays on the canvas, so a StrictMode replay on the same element would get a dead one.
    if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
