// PROTOTYPE, wipe me. ADHD mode: one project, one task, one thread. The session clock runs here,
// not on screen: every 5 minutes it queues a short-lived popup, and it unlocks two achievement
// tracks, total time (1h / 10h / 50h / 100h) and one unbroken session (25 / 45 / 60 / 90 min).
import { useSyncExternalStore } from "react";

import { PROJECTS, type LighthouseTask } from "./lighthouseData";

const FIVE_MINUTES = 5 * 60_000;
export const TOTAL_ACHIEVEMENTS = [1, 10, 50, 100].map((hours) => ({
  key: `total-${hours}`,
  ms: hours * 3_600_000,
  short: `${hours}h`,
  caption: `${hours} 小时`,
  label: `累计 ${hours} 小时`,
}));
export const SESSION_ACHIEVEMENTS = [25, 45, 60, 90].map((minutes) => ({
  key: `session-${minutes}`,
  ms: minutes * 60_000,
  short: `${minutes}′`,
  caption: `${minutes} 分钟`,
  label: `连续 ${minutes} 分钟`,
}));

export type AdhdVariant = "a" | "b" | "c";
export const ADHD_VARIANTS: ReadonlyArray<{ id: AdhdVariant; name: string }> = [
  { id: "a", name: "安静单栏" },
  { id: "b", name: "边缘进度" },
  { id: "c", name: "任务收进标题" },
];

export type AdhdToast =
  | { id: number; kind: "milestone"; minutes: number }
  | { id: number; kind: "session"; minutes: number; label: string }
  | { id: number; kind: "total"; hours: number; label: string };

const TOTAL_KEY = "lighthouse-adhd-total";
const SEEN_KEY = "lighthouse-adhd-seen";
const BEST_KEY = "lighthouse-adhd-best";
const VARIANT_KEY = "lighthouse-adhd-variant";
// A fresh prototype starts just under the first total achievement so it is reachable in a demo.
const SEED_TOTAL = 52 * 60_000;
const TOAST_MS = 4000;
const SPECIAL_TOAST_MS = 5200;

type Phase = "idle" | "pick" | "adhd" | "next";

interface AdhdState {
  phase: Phase;
  project: string | null;
  task: string | null;
  startedAt: number;
  /** Demo only: time added with 快进 5 分钟. */
  skipped: number;
  /** Session time at the last tick, so each crossing fires once. */
  elapsed: number;
  finished: string | null;
  /** Time of every ended session. */
  total: number;
  /** Longest single session ever. */
  best: number;
  /** Total-time achievements already celebrated, by hours. */
  seen: ReadonlyArray<number>;
  toasts: ReadonlyArray<AdhdToast>;
  variant: AdhdVariant;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: keep the in-memory value.
  }
}

function readNumber(key: string, fallback: number): number {
  const raw = read(key);
  return raw === null ? fallback : Number(raw) || 0;
}

function readSeen(): ReadonlyArray<number> {
  try {
    return JSON.parse(read(SEEN_KEY) ?? "[]") as Array<number>;
  } catch {
    return [];
  }
}

function readVariant(): AdhdVariant {
  const wanted =
    typeof window === "undefined"
      ? null
      : (new URLSearchParams(window.location.search).get("adhd") ?? read(VARIANT_KEY));
  return ADHD_VARIANTS.find((v) => v.id === wanted)?.id ?? "a";
}

let state: AdhdState = {
  phase: "idle",
  project: null,
  task: null,
  startedAt: 0,
  skipped: 0,
  elapsed: 0,
  finished: null,
  total: readNumber(TOTAL_KEY, SEED_TOTAL),
  best: readNumber(BEST_KEY, 0),
  seen: readSeen(),
  toasts: [],
  variant: readVariant(),
};
const listeners = new Set<() => void>();
let ticker: number | undefined;
let toastSeq = 0;

function commit(patch: Partial<AdhdState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useAdhd(): AdhdState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Whole session minutes: views that show progress re-render once a minute, not every second. */
export function useSessionMinutes(): number {
  return useSyncExternalStore(subscribe, () => Math.floor(state.elapsed / 60_000));
}

const elapsedAt = (now: number) =>
  state.phase === "adhd" ? Math.max(0, now - state.startedAt) + state.skipped : 0;

function dismissToast(id: number) {
  commit({ toasts: state.toasts.filter((t) => t.id !== id) });
}

/** Turns crossings since the last tick into popups. Only special ones show when both land. */
function tick() {
  if (state.phase !== "adhd") return;
  const before = state.elapsed;
  const after = elapsedAt(Date.now());
  const crossed = (from: number, to: number, at: number) => from < at && at <= to;
  const fresh: Array<AdhdToast> = [];
  for (const a of SESSION_ACHIEVEMENTS) {
    if (crossed(before, after, a.ms))
      fresh.push({ id: ++toastSeq, kind: "session", minutes: a.ms / 60_000, label: a.label });
  }
  const seen = [...state.seen];
  for (const a of TOTAL_ACHIEVEMENTS) {
    const hours = a.ms / 3_600_000;
    if (!seen.includes(hours) && state.total + after >= a.ms) {
      seen.push(hours);
      fresh.push({ id: ++toastSeq, kind: "total", hours, label: a.label });
    }
  }
  const block = Math.floor(after / FIVE_MINUTES);
  if (fresh.length === 0 && block > Math.floor(before / FIVE_MINUTES))
    fresh.push({ id: ++toastSeq, kind: "milestone", minutes: block * 5 });
  if (seen.length !== state.seen.length) write(SEEN_KEY, JSON.stringify(seen));
  for (const t of fresh)
    window.setTimeout(
      () => dismissToast(t.id),
      t.kind === "milestone" ? TOAST_MS : SPECIAL_TOAST_MS,
    );
  if (fresh.length === 0 && Math.floor(after / 60_000) === Math.floor(before / 60_000)) {
    state = { ...state, elapsed: after };
    return;
  }
  commit({ elapsed: after, seen, toasts: [...state.toasts, ...fresh] });
}

function endSession(): Pick<AdhdState, "total" | "best"> {
  const elapsed = elapsedAt(Date.now());
  const total = state.total + elapsed;
  const best = Math.max(state.best, elapsed);
  write(TOTAL_KEY, String(total));
  write(BEST_KEY, String(best));
  window.clearInterval(ticker);
  return { total, best };
}

export function openAdhdPicker() {
  if (state.phase === "adhd") return;
  commit({ phase: "pick" });
}

export function startAdhd(project: string, task: string) {
  const ended = state.phase === "adhd" ? endSession() : {};
  commit({
    ...ended,
    phase: "adhd",
    project,
    task,
    startedAt: Date.now(),
    skipped: 0,
    elapsed: 0,
    toasts: [],
  });
  ticker = window.setInterval(tick, 1000);
}

export function finishAdhdTask() {
  commit({ ...endSession(), phase: "next", finished: state.task, skipped: 0, elapsed: 0 });
}

export function leaveAdhd() {
  const ended = state.phase === "adhd" ? endSession() : {};
  commit({ ...ended, phase: "idle", skipped: 0, elapsed: 0, finished: null, toasts: [] });
}

export function skipFiveMinutes() {
  state = { ...state, skipped: state.skipped + FIVE_MINUTES };
  tick();
}

export function setAdhdVariant(variant: AdhdVariant) {
  write(VARIANT_KEY, variant);
  commit({ variant });
}

/** What the achievements popover shows: total time and best session, both counting this one. */
export function achievementProgress(s: AdhdState) {
  return { total: s.total + s.elapsed, best: Math.max(s.best, s.elapsed), session: s.elapsed };
}

const PRIORITY = { high: 30, medium: 20, low: 10 } as const;
const STATUS = { doing: 6, todo: 4, review: 1, done: -100 } as const;

/** Open tasks, best first: priority, then work already under way, then the nearest due date. */
export function recommend(
  tasks: ReadonlyArray<LighthouseTask>,
  projects: ReadonlyArray<string>,
  skip: ReadonlyArray<string> = [],
): ReadonlyArray<LighthouseTask> {
  const score = (t: LighthouseTask) =>
    PRIORITY[t.priority ?? "low"] +
    STATUS[t.status] -
    (t.due ? Math.max(0, (Date.parse(t.due) - Date.parse("2026-11-04")) / 86_400_000) : 7);
  return tasks
    .filter((t) => projects.includes(t.project) && t.status !== "done" && !skip.includes(t.id))
    .sort((a, b) => score(b) - score(a));
}

export const projectName = (id: string | null) => (id ? (PROJECTS[id]?.name ?? id) : "");

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} 小时 ${minutes % 60} 分` : `${minutes} 分`;
}
