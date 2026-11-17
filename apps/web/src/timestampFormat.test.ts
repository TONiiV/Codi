import type { TFunction } from "i18next";
import { describe, expect, it } from "vite-plus/test";

import {
  formatChatTimestampTooltip,
  formatDayAwareTimestamp,
  formatElapsedDurationLabel,
  formatExpiresInLabel,
  formatRelativeTimeLabel,
  formatUpcomingTimestamp,
} from "./timestampFormat";

const NOW = Date.UTC(2026, 0, 2, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const fromNow = (ms: number) => new Date(NOW + ms).toISOString();

const ZH_COPY: Record<string, string> = {
  "settings.parallelShared.justNow": "刚刚",
  "settings.parallelShared.relativeAgo": "前",
  "settings.parallelShared.relativeMinutes": "{{value}} 分钟",
  "settings.parallelShared.relativeHours": "{{value}} 小时",
  "settings.parallelShared.relativeDays": "{{value}} 天",
  "settings.parallelShared.durationSeconds": "{{value}} 秒",
  "settings.parallelShared.durationMinutes": "{{value}} 分钟",
  "settings.parallelShared.durationHours": "{{value}} 小时",
  "settings.parallelShared.durationDays": "{{value}} 天",
  "settings.parallelShared.expiresExpired": "已过期",
  "settings.parallelShared.expiresMoment": "即将过期",
  "settings.parallelShared.expiresIn": "{{duration}}后过期",
  "settings.parallelShared.relativeAgoPlacement": "attached",
};

const zh: TFunction = ((key: string, options?: Record<string, unknown>) => {
  const template = ZH_COPY[key] ?? String(options?.["defaultValue"] ?? key);
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    String(options?.[name] ?? ""),
  );
}) as unknown as TFunction;

describe("timestampFormat translations", () => {
  it("keeps the English labels when no translator is given", () => {
    expect(formatRelativeTimeLabel(ago(5 * 60_000), NOW)).toBe("5m ago");
    expect(formatElapsedDurationLabel(ago(30_000), NOW)).toBe("30s");
    expect(formatElapsedDurationLabel(ago(2_000), NOW)).toBe("just now");
    expect(formatExpiresInLabel(fromNow(90_000), NOW)).toBe("Expires in 1m 30s");
    expect(formatExpiresInLabel(fromNow(1_000), NOW)).toBe("Expires in a moment");
    expect(formatExpiresInLabel(ago(1_000), NOW)).toBe("Expired");
  });

  it("formats relative and elapsed labels through the current translator", () => {
    expect(formatRelativeTimeLabel(ago(5 * 60_000), NOW, zh)).toBe("5 分钟前");
    expect(formatRelativeTimeLabel(ago(20_000), NOW, zh)).toBe("刚刚");
    expect(formatElapsedDurationLabel(ago(30_000), NOW, zh)).toBe("30 秒");
    expect(formatElapsedDurationLabel(ago(2 * 3_600_000), NOW, zh)).toBe("2 小时");
  });

  it("formats expiry labels through the current translator", () => {
    expect(formatExpiresInLabel(fromNow(90_000), NOW, zh)).toBe("1 分钟 30 秒后过期");
    expect(formatExpiresInLabel(fromNow(1_000), NOW, zh)).toBe("即将过期");
    expect(formatExpiresInLabel(ago(1_000), NOW, zh)).toBe("已过期");
  });
});

// Node re-resolves the default zone when TZ is assigned, like a renderer after the OS zone changes.
function useTimeZone(timeZone: string): Disposable {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  return {
    [Symbol.dispose]: () => {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    },
  };
}

describe("timestamps in an explicit time zone", () => {
  // 23:00 UTC on July 1 is 7 PM on July 1 in New York, whatever the host zone.
  const now = Date.parse("2026-07-01T23:00:00.000Z");
  const zone = "America/New_York";

  it("picks relative days from the calendar in that zone", () => {
    expect(formatUpcomingTimestamp("2026-07-02T00:30:00.000Z", "12-hour", now, zone)).not.toMatch(
      /tomorrow/,
    );
    expect(formatUpcomingTimestamp("2026-07-02T05:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^tomorrow at /,
    );
    expect(formatDayAwareTimestamp("2026-07-01T03:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^yesterday at /,
    );
  });
});

describe("timestamps after the system time zone changes", () => {
  // Built fresh with an explicit zone, so expectations follow the host locale but not a stale zone.
  const timeIn = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(new Date(iso));
  const dayIn = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", timeZone }).format(
      new Date(iso),
    );

  it("renders the gutter label in the new zone", () => {
    const sameDay = "2026-11-07T04:45:43.877Z";
    const earlierInWeek = "2026-11-04T20:00:00.000Z";
    const now = Date.parse(sameDay);
    using _zone = useTimeZone("America/New_York");
    expect([
      formatDayAwareTimestamp(sameDay, "12-hour", now),
      formatDayAwareTimestamp(earlierInWeek, "12-hour", now),
    ]).toEqual([
      timeIn(sameDay, "America/New_York"),
      `${dayIn(earlierInWeek, "America/New_York")} ${timeIn(earlierInWeek, "America/New_York")}`,
    ]);

    process.env.TZ = "Asia/Bangkok";
    expect([
      formatDayAwareTimestamp(sameDay, "12-hour", now),
      formatDayAwareTimestamp(earlierInWeek, "12-hour", now),
    ]).toEqual([
      timeIn(sameDay, "Asia/Bangkok"),
      `${dayIn(earlierInWeek, "Asia/Bangkok")} ${timeIn(earlierInWeek, "Asia/Bangkok")}`,
    ]);
  });

  it("renders the tooltip in the new zone", () => {
    const monthEnd = "2026-10-31T20:00:00.000Z";
    using _zone = useTimeZone("America/New_York");
    expect(formatChatTimestampTooltip(monthEnd, "12-hour")).toBe(
      `${timeIn(monthEnd, "America/New_York")}, 31st October 2026`,
    );

    process.env.TZ = "Asia/Bangkok";
    expect(formatChatTimestampTooltip(monthEnd, "12-hour")).toBe(
      `${timeIn(monthEnd, "Asia/Bangkok")}, 1st November 2026`,
    );
  });
});
