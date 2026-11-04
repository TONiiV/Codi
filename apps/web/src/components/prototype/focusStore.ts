// PROTOTYPE, wipe me. Focus mode: one project, one task, a timer, and total focus time toward the
// 1h / 10h / 50h / 100h achievements. Session state is in memory; the total survives a reload.
import { useSyncExternalStore } from "react";

import { PROJECTS, type LighthouseTask } from "./lighthouseData";

export const FIVE_MINUTES = 5 * 60_000;
export const ACHIEVEMENTS = [1, 10, 50, 100].map((hours) => ({
  hours,
  ms: hours * 3_600_000,
  label: `专注 ${hours} 小时`,
}));

const TOTAL_KEY = "lighthouse-focus-total";
const SEEN_KEY = "lighthouse-focus-seen";
// A fresh prototype starts just under the first achievement so it is reachable in a demo.
const SEED_TOTAL = 52 * 60_000;

type Phase = "idle" | "pick" | "focus" | "next";

interface FocusState {
  phase: Phase;
  project: string | null;
  task: string | null;
  startedAt: number;
  /** Demo only: time added with 快进 5 分钟. */
  skipped: number;
  finished: string | null;
  /** Focus time of every ended session. */
  total: number;
  /** Achievements already celebrated, by hours. */
  seen: ReadonlyArray<number>;
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : Number(raw) || 0;
  } catch {
    return fallback;
  }
}

function readSeen(): ReadonlyArray<number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as Array<number>) : [];
  } catch {
    return [];
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: keep the in-memory value.
  }
}

let state: FocusState = {
  phase: "idle",
  project: null,
  task: null,
  startedAt: 0,
  skipped: 0,
  finished: null,
  total: readNumber(TOTAL_KEY, SEED_TOTAL),
  seen: readSeen(),
};
const listeners = new Set<() => void>();

function commit(patch: Partial<FocusState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useFocus(): FocusState {
  return useSyncExternalStore(subscribe, () => state);
}

export const sessionElapsed = (s: FocusState, now: number) =>
  s.phase === "focus" ? Math.max(0, now - s.startedAt) + s.skipped : 0;

function endSession(): number {
  const total = state.total + sessionElapsed(state, Date.now());
  write(TOTAL_KEY, String(total));
  return total;
}

export function openFocusPicker() {
  if (state.phase === "focus") return;
  commit({ phase: "pick" });
}

export function startFocus(project: string, task: string) {
  const total = state.phase === "focus" ? endSession() : state.total;
  commit({ phase: "focus", project, task, startedAt: Date.now(), skipped: 0, total });
}

export function finishFocusTask() {
  commit({ phase: "next", finished: state.task, total: endSession(), skipped: 0 });
}

export function leaveFocus() {
  commit({ phase: "idle", total: endSession(), skipped: 0, finished: null });
}

export function skipFiveMinutes() {
  commit({ skipped: state.skipped + FIVE_MINUTES });
}

export function markAchievementSeen(hours: number) {
  const seen = [...state.seen, hours];
  write(SEEN_KEY, JSON.stringify(seen));
  commit({ seen });
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

export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h > 0
    ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
    : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
