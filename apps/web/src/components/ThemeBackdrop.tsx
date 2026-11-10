import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

import {
  setThemeBackdropUnavailable,
  useThemeBackdropEnabled,
  useThemeBackdropStyle,
  useThemeBackdropUnavailable,
  type ThemeBackdropStyle,
} from "../themeBackdrop";
import { startThemeBackdrop } from "./theme-backdrop/renderer";

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
      style={{ imageRendering: style === "ascii" ? "pixelated" : undefined }}
    />
  );
}
