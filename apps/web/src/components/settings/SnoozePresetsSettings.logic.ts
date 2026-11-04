import type { TFunction } from "i18next";
import type { SnoozePresetSetting } from "@t3tools/contracts/settings";
import { resolveSnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import * as Equal from "effect/Equal";

/**
 * Reads a server value against the editor's writes still in flight. Matching one acknowledges
 * it and every earlier write; anything else came from elsewhere and replaces the draft.
 */
export function reconcileSnoozeDraft<T>(
  pending: ReadonlyArray<T>,
  saved: T,
): { readonly adopt: true } | { readonly adopt: false; readonly pending: ReadonlyArray<T> } {
  const acknowledged = pending.findIndex((snapshot) => Equal.equals(snapshot, saved));
  return acknowledged === -1
    ? { adopt: true }
    : { adopt: false, pending: pending.slice(acknowledged + 1) };
}

/**
 * Orders editor rows the way the menu lists them: soonest wake first, with options that
 * have no wake right now (a passed "Today") last. Ties keep their current order.
 */
export function sortSnoozeRows<K>(
  presets: ReadonlyArray<SnoozePresetSetting>,
  keys: ReadonlyArray<K>,
  now: Date,
): { readonly presets: ReadonlyArray<SnoozePresetSetting>; readonly keys: ReadonlyArray<K> } {
  const order = presets
    .map((preset, index) => ({
      index,
      wake: resolveSnoozePreset(preset, now)?.snoozedUntil ?? null,
    }))
    .toSorted((a, b) =>
      a.wake === b.wake ? 0 : a.wake === null ? 1 : b.wake === null ? -1 : a.wake < b.wake ? -1 : 1,
    );
  return {
    presets: order.map(({ index }) => presets[index]!),
    keys: order.map(({ index }) => keys[index]!),
  };
}

const SNOOZE_DAY_KEYS: Readonly<Record<string, string>> = {
  Today: "settings.parallelA.snoozeToday",
  Tomorrow: "settings.parallelA.snoozeTomorrow",
  Monday: "settings.parallelA.snoozeMonday",
  Tuesday: "settings.parallelA.snoozeTuesday",
  Wednesday: "settings.parallelA.snoozeWednesday",
  Thursday: "settings.parallelA.snoozeThursday",
  Friday: "settings.parallelA.snoozeFriday",
  Saturday: "settings.parallelA.snoozeSaturday",
  Sunday: "settings.parallelA.snoozeSunday",
};

const SNOOZE_FIXED_LABEL_KEYS: Readonly<Record<string, string>> = {
  ...SNOOZE_DAY_KEYS,
  "This morning": "settings.parallelA.snoozeThisMorning",
  "This afternoon": "settings.parallelA.snoozeThisAfternoon",
  "This evening": "settings.parallelA.snoozeThisEvening",
  "Next week": "settings.parallelA.snoozeNextWeek",
};

const SNOOZE_DURATION_KEYS = {
  minute: ["snoozeInMinute1", "snoozeInMinutes"],
  hour: ["snoozeInHour1", "snoozeInHours"],
  day: ["snoozeInDay1", "snoozeInDays"],
} as const;

/** The shared resolver prefixes a wake day in the browser's locale; use the app language instead. */
export function localizeSnoozeWhen(
  preset: { readonly whenLabel: string; readonly snoozedUntil: string },
  formatTime: (date: Date) => string,
  language: string,
): string {
  const wake = new Date(preset.snoozedUntil);
  const time = formatTime(wake);
  return preset.whenLabel === time
    ? time
    : `${wake.toLocaleDateString(language, { weekday: "short" })} ${time}`;
}

/**
 * Translates the English label `resolveSnoozePreset` builds ("In 3 hours", "Next Monday",
 * "This evening"), which is shared with mobile. An unrecognised label is returned unchanged.
 */
export function localizeSnoozeLabel(label: string, t: TFunction): string {
  const fixed = SNOOZE_FIXED_LABEL_KEYS[label];
  if (fixed) return t(fixed);
  const duration = /^In (\d+) (minute|hour|day)s?$/.exec(label);
  if (duration) {
    const count = Number(duration[1]);
    const [one, many] = SNOOZE_DURATION_KEYS[duration[2] as keyof typeof SNOOZE_DURATION_KEYS];
    return t(`settings.parallelA.${count === 1 ? one : many}`, { count });
  }
  const next = /^Next (\w+)$/.exec(label);
  const dayKey = next ? SNOOZE_DAY_KEYS[next[1]!] : undefined;
  return dayKey ? t("settings.parallelA.snoozeNextDay", { day: t(dayKey) }) : label;
}
