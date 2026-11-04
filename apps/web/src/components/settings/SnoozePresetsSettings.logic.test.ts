import { describe, expect, it } from "vite-plus/test";

import type { TFunction } from "i18next";
import {
  localizeSnoozeLabel,
  localizeSnoozeWhen,
  reconcileSnoozeDraft,
  sortSnoozeRows,
} from "./SnoozePresetsSettings.logic";

describe("reconcileSnoozeDraft", () => {
  it("keeps the draft while our own writes echo back in order", () => {
    expect(reconcileSnoozeDraft(["a", "b"], "a")).toEqual({ adopt: false, pending: ["b"] });
    expect(reconcileSnoozeDraft(["b"], "b")).toEqual({ adopt: false, pending: [] });
  });

  it("adopts a value from elsewhere, even one this editor wrote earlier", () => {
    expect(reconcileSnoozeDraft(["b"], "c")).toEqual({ adopt: true });
    // "a" was written and acknowledged before; seeing it again means someone restored it.
    expect(reconcileSnoozeDraft([], "a")).toEqual({ adopt: true });
  });

  it("acknowledges every earlier write when a later one echoes", () => {
    expect(reconcileSnoozeDraft(["a", "b", "a"], "b")).toEqual({ adopt: false, pending: ["a"] });
  });
});

describe("sortSnoozeRows", () => {
  it("orders rows by wake time and puts a passed today option last", () => {
    // 16:00 local, so 20 hours wakes tomorrow and today 09:00 has passed.
    const now = new Date(2026, 9, 28, 16, 0);
    const sorted = sortSnoozeRows(
      [
        { kind: "after", minutes: 20 * 60 },
        { kind: "at", day: "today", time: "09:00" },
        { kind: "at", day: "today", time: "18:00" },
        { kind: "after", minutes: 60 },
      ],
      ["20h", "passed", "evening", "1h"],
      now,
    );
    expect(sorted.keys).toEqual(["1h", "evening", "20h", "passed"]);
  });
});

describe("localizeSnoozeLabel", () => {
  // Echoes the key and its values, so the test sees which translation was picked.
  const t = ((key: string, values?: Record<string, unknown>) =>
    values
      ? `${key.split(".").pop()}:${JSON.stringify(values)}`
      : key.split(".").pop()) as TFunction;

  it("maps every label the shared resolver builds", () => {
    expect(localizeSnoozeLabel("This evening", t)).toBe("snoozeThisEvening");
    expect(localizeSnoozeLabel("Tomorrow", t)).toBe("snoozeTomorrow");
    expect(localizeSnoozeLabel("Next week", t)).toBe("snoozeNextWeek");
    expect(localizeSnoozeLabel("Friday", t)).toBe("snoozeFriday");
    expect(localizeSnoozeLabel("In 1 hour", t)).toBe('snoozeInHour1:{"count":1}');
    expect(localizeSnoozeLabel("In 90 minutes", t)).toBe('snoozeInMinutes:{"count":90}');
    expect(localizeSnoozeLabel("Next Monday", t)).toBe('snoozeNextDay:{"day":"snoozeMonday"}');
  });

  it("leaves an unknown label alone", () => {
    expect(localizeSnoozeLabel("Someday", t)).toBe("Someday");
  });
});

describe("localizeSnoozeWhen", () => {
  const formatTime = () => "9:00";
  const monday = new Date(2026, 10, 9, 9, 0).toISOString();

  it("shows only the time for a same-day wake", () => {
    expect(
      localizeSnoozeWhen({ whenLabel: "9:00", snoozedUntil: monday }, formatTime, "zh-CN"),
    ).toBe("9:00");
  });

  it("prefixes the weekday in the app language, not the shared resolver's", () => {
    const preset = { whenLabel: "Mon 9:00", snoozedUntil: monday };
    expect(localizeSnoozeWhen(preset, formatTime, "zh-CN")).toBe("周一 9:00");
    expect(localizeSnoozeWhen(preset, formatTime, "en")).toBe("Mon 9:00");
  });
});
