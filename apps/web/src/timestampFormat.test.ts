import type { TFunction } from "i18next";
import { describe, expect, it } from "vite-plus/test";

import {
  formatElapsedDurationLabel,
  formatExpiresInLabel,
  formatRelativeTimeLabel,
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
    expect(formatRelativeTimeLabel(ago(5 * 60_000), NOW, zh)).toBe("5 分钟 前");
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
