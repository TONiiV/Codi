/**
 * How a usage-limit pause reads on a thread.
 *
 * Shared by web and mobile so the same reset time never reads differently
 * depending on which client is looking at it.
 *
 * @module state/usageLimit
 */
import type { OrchestrationSession } from "@t3tools/contracts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type UsageLimitPauseView = {
  /** Compact time remaining: "45m", "3h", "2d". Mirrors the snooze label. */
  readonly countdown: string;
  /** The clock time the provider named, in the viewer's locale. */
  readonly clockLabel: string;
  /** The reset has arrived, so the resume is due rather than pending. */
  readonly isDue: boolean;
};

/**
 * Describe a thread's pending usage-limit pause, or `null` when there is none.
 *
 * Takes `now` explicitly so the caller owns the tick rate — nothing here
 * repaints on its own.
 */
export function describeUsageLimitPause(
  usageLimit: OrchestrationSession["usageLimit"],
  options: { readonly now: string },
): UsageLimitPauseView | null {
  if (usageLimit == null) {
    return null;
  }
  const resetsAtMs = Date.parse(usageLimit.resetsAt);
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(resetsAtMs)) {
    return null;
  }
  const clockLabel = new Date(resetsAtMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const remainingMs = Number.isNaN(nowMs) ? 0 : resetsAtMs - nowMs;
  if (remainingMs <= 0) {
    return { countdown: "now", clockLabel, isDue: true };
  }
  const countdown =
    remainingMs < HOUR_MS
      ? `${Math.max(1, Math.ceil(remainingMs / MINUTE_MS))}m`
      : remainingMs < DAY_MS
        ? `${Math.ceil(remainingMs / HOUR_MS)}h`
        : `${Math.ceil(remainingMs / DAY_MS)}d`;
  return { countdown, clockLabel, isDue: false };
}

/**
 * How often a countdown for this pause needs to repaint to stay honest:
 * once a minute while it reads in minutes, once an hour above that, and
 * never once the reset has passed. Keeps a parked thread from costing a
 * timer tick per second on every open client.
 */
export function usageLimitTickIntervalMs(view: UsageLimitPauseView | null): number | null {
  if (view === null || view.isDue) {
    return null;
  }
  return view.countdown.endsWith("m") ? MINUTE_MS : HOUR_MS;
}
