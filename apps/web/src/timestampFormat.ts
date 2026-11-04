import { type TimestampFormat } from "@t3tools/contracts/settings";
import type { TFunction } from "i18next";
import { englishT } from "~/i18n/englishT";

function getTimestampFormatOptions(
  timestampFormat: TimestampFormat,
  includeSeconds: boolean,
): Intl.DateTimeFormatOptions {
  const baseOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
  };

  if (timestampFormat === "locale") {
    return baseOptions;
  }

  return {
    ...baseOptions,
    hour12: timestampFormat === "12-hour",
  };
}

function resolveTimestampLocale(systemLocale: string | null | undefined): string | undefined {
  const tag = systemLocale?.trim();
  if (!tag) return undefined;

  try {
    // Reject structurally invalid tags; let ICU fall back for valid tags it lacks data for.
    Intl.DateTimeFormat.supportedLocalesOf([tag]);
    return tag;
  } catch {
    return undefined;
  }
}

function readHostSystemLocale(): string | null {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.getSystemLocale() ?? null;
}

const timestampLocale = resolveTimestampLocale(readHostSystemLocale());

const WEEKDAY_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;
type WeekdayIndex = (typeof WEEKDAY_INDEXES)[number];

type LocaleWithWeekInfo = Intl.Locale & {
  readonly weekInfo?: { readonly firstDay: number };
  getWeekInfo?: () => { readonly firstDay: number };
};

/**
 * First weekday of a locale as a `Date#getDay` index (0 is Sunday), or
 * `undefined` when the runtime has no week data, so callers keep their own
 * default.
 */
function resolveWeekStartsOn(locale: string | undefined): WeekdayIndex | undefined {
  try {
    const resolved: LocaleWithWeekInfo = new Intl.Locale(
      locale ?? Intl.DateTimeFormat().resolvedOptions().locale,
    );
    // Week info counts Monday as 1 and Sunday as 7.
    const firstDay = resolved.getWeekInfo?.().firstDay ?? resolved.weekInfo?.firstDay;
    return firstDay === undefined ? undefined : WEEKDAY_INDEXES[firstDay % 7];
  } catch {
    return undefined;
  }
}

export const weekStartsOn = resolveWeekStartsOn(timestampLocale);

const timestampFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getTimestampFormatter(
  timestampFormat: TimestampFormat,
  includeSeconds: boolean,
): Intl.DateTimeFormat {
  const cacheKey = `${timestampFormat}:${includeSeconds ? "seconds" : "minutes"}`;
  const cachedFormatter = timestampFormatterCache.get(cacheKey);
  if (cachedFormatter) {
    return cachedFormatter;
  }

  const formatter = new Intl.DateTimeFormat(
    timestampLocale,
    getTimestampFormatOptions(timestampFormat, includeSeconds),
  );
  timestampFormatterCache.set(cacheKey, formatter);
  return formatter;
}

export function resolveHour12(timestampFormat: TimestampFormat): boolean {
  return getTimestampFormatter(timestampFormat, false).resolvedOptions().hour12 ?? false;
}

export function parseTimestampDate(isoDate: string): Date | null {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Deliberately not the host locale: the tooltip's ordinal suffix and
// day-before-month order below are English, so a localized month alone would
// read "4th Juni 2026".
const monthNameFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });

function ordinalSuffix(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function formatChatTimestampTooltip(
  isoDate: string,
  timestampFormat: TimestampFormat,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const time = formatShortTimestamp(isoDate, timestampFormat);
  const day = date.getDate();
  const month = monthNameFormatter.format(date);
  const year = date.getFullYear();
  return `${time}, ${day}${ordinalSuffix(day)} ${month} ${year}`;
}

export function formatShortTimestamp(isoDate: string, timestampFormat: TimestampFormat): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  return getTimestampFormatter(timestampFormat, false).format(date);
}

const numericDateFormatter = new Intl.DateTimeFormat(timestampLocale, {
  month: "numeric",
  day: "numeric",
});
const numericDateWithYearFormatter = new Intl.DateTimeFormat(timestampLocale, {
  month: "numeric",
  day: "numeric",
  year: "numeric",
});

export function formatDayAwareTimestamp(
  isoDate: string,
  timestampFormat: TimestampFormat,
  nowMs: number = Date.now(),
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const time = getTimestampFormatter(timestampFormat, false).format(date);

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Round so DST-shifted 23/25 hour days still count as whole days.
  const dayDiff = Math.round((startOfToday - startOfMessageDay) / 86_400_000);

  if (dayDiff <= 0) return time;
  if (dayDiff === 1) return `yesterday at ${time}`;
  const dateFormatter =
    date.getFullYear() === now.getFullYear() ? numericDateFormatter : numericDateWithYearFormatter;
  return `${dateFormatter.format(date)} ${time}`;
}

export function formatUpcomingTimestamp(
  isoDate: string,
  timestampFormat: TimestampFormat,
  nowMs: number = Date.now(),
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const time = getTimestampFormatter(timestampFormat, false).format(date);

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTargetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfTargetDay - startOfToday) / 86_400_000);

  if (dayDiff < 0) return formatDayAwareTimestamp(isoDate, timestampFormat, nowMs);
  if (dayDiff === 0) return time;
  if (dayDiff === 1) return `tomorrow at ${time}`;
  const dateFormatter =
    date.getFullYear() === now.getFullYear() ? numericDateFormatter : numericDateWithYearFormatter;
  return `${dateFormatter.format(date)} ${time}`;
}

type RelativeTimeParts = { value: string; suffix: string | null };
export type RelativeTimeState =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "relative"; value: string; suffix: string | null };

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function relativeTimeUnitMs(elapsedMs: number): number {
  if (elapsedMs < HOUR_MS) return MINUTE_MS;
  if (elapsedMs < DAY_MS) return HOUR_MS;
  return DAY_MS;
}

/** Elapsed time floored to formatRelativeTime precision; equal labels yield equal values. */
export function relativeTimeElapsedMs(isoDate: string, nowMs: number = Date.now()): number | null {
  const date = parseTimestampDate(isoDate);
  if (!date) return null;
  const elapsedMs = Math.max(0, nowMs - date.getTime());
  const unitMs = relativeTimeUnitMs(elapsedMs);
  return Math.floor(elapsedMs / unitMs) * unitMs;
}

export function msUntilRelativeTimeChange(
  isoDate: string,
  nowMs: number = Date.now(),
): number | null {
  const date = parseTimestampDate(isoDate);
  if (!date) return null;
  const elapsedMs = Math.max(0, nowMs - date.getTime());
  const unitMs = relativeTimeUnitMs(elapsedMs);
  const nextChangeMs = date.getTime() + (Math.floor(elapsedMs / unitMs) + 1) * unitMs;
  // Delays above 2^31-1 fire immediately; cap safely and let callers reschedule.
  return Math.min(nextChangeMs - nowMs, DAY_MS);
}

const DURATION_UNIT_SUFFIX = { seconds: "s", minutes: "m", hours: "h", days: "d" } as const;
type DurationUnit = keyof typeof DURATION_UNIT_SUFFIX;

function capitalize(value: string): string {
  return `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function formatDurationUnit(value: number, unit: DurationUnit, t: TFunction): string {
  return t(`settings.parallelShared.duration${capitalize(unit)}`, {
    defaultValue: `{{value}}${DURATION_UNIT_SUFFIX[unit]}`,
    value,
  });
}

function formatRelativeUnit(
  value: number,
  unit: Exclude<DurationUnit, "seconds">,
  t: TFunction,
): string {
  return t(`settings.parallelShared.relative${capitalize(unit)}`, {
    defaultValue: `{{value}}${DURATION_UNIT_SUFFIX[unit]}`,
    value,
  });
}

function justNowLabel(t: TFunction): string {
  return t("settings.parallelShared.justNow", { defaultValue: "just now" });
}

export function formatRelativeElapsed(
  elapsedMs: number,
  t: TFunction = englishT,
): RelativeTimeParts {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return { value: justNowLabel(t), suffix: null };
  const ago = t("settings.parallelShared.relativeAgo", { defaultValue: "ago" });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { value: formatRelativeUnit(minutes, "minutes", t), suffix: ago };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: formatRelativeUnit(hours, "hours", t), suffix: ago };
  const days = Math.floor(hours / 24);
  return { value: formatRelativeUnit(days, "days", t), suffix: ago };
}

export function formatRelativeTime(
  isoDate: string,
  nowMs: number = Date.now(),
  t: TFunction = englishT,
): RelativeTimeParts | null {
  const elapsedMs = relativeTimeElapsedMs(isoDate, nowMs);
  return elapsedMs === null ? null : formatRelativeElapsed(elapsedMs, t);
}

export function formatRelativeTimeLabel(
  isoDate: string,
  nowMs: number = Date.now(),
  t: TFunction = englishT,
) {
  const relative = formatRelativeTime(isoDate, nowMs, t);
  if (!relative) return "";
  return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
}

export function formatElapsedDurationLabel(
  isoDate: string,
  nowMs: number = Date.now(),
  t: TFunction = englishT,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const diffMs = nowMs - date.getTime();
  if (diffMs <= 0) return justNowLabel(t);

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return justNowLabel(t);
  if (seconds < 60) return formatDurationUnit(seconds, "seconds", t);

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatDurationUnit(minutes, "minutes", t);

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatDurationUnit(hours, "hours", t);

  const days = Math.floor(hours / 24);
  return formatDurationUnit(days, "days", t);
}

/** Pass nowMs to match a parent-driven render tick. */
export function formatExpiresInLabel(
  isoDate: string,
  nowMs: number = Date.now(),
  t: TFunction = englishT,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const diffMs = date.getTime() - nowMs;
  if (diffMs <= 0) return t("settings.parallelShared.expiresExpired", { defaultValue: "Expired" });

  const expiresIn = (duration: string) =>
    t("settings.parallelShared.expiresIn", {
      defaultValue: "Expires in {{duration}}",
      duration,
    });

  const totalSeconds = Math.floor(diffMs / 1000);
  if (totalSeconds < 5)
    return t("settings.parallelShared.expiresMoment", { defaultValue: "Expires in a moment" });
  if (totalSeconds < 60) return expiresIn(formatDurationUnit(totalSeconds, "seconds", t));

  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const parts = [formatDurationUnit(minutes, "minutes", t)];
    if (seconds > 0) parts.push(formatDurationUnit(seconds, "seconds", t));
    return expiresIn(parts.join(" "));
  }

  if (totalSeconds < 86_400) {
    const hours = Math.floor(totalSeconds / 3600);
    const rem = totalSeconds % 3600;
    const minutes = Math.floor(rem / 60);
    const seconds = rem % 60;
    const parts = [formatDurationUnit(hours, "hours", t)];
    if (minutes > 0) parts.push(formatDurationUnit(minutes, "minutes", t));
    if (seconds > 0) parts.push(formatDurationUnit(seconds, "seconds", t));
    return expiresIn(parts.join(" "));
  }

  const days = Math.floor(totalSeconds / 86_400);
  const remAfterDays = totalSeconds % 86_400;
  const parts = [formatDurationUnit(days, "days", t)];
  if (remAfterDays > 0) {
    const hours = Math.floor(remAfterDays / 3600);
    const rem = remAfterDays % 3600;
    const minutes = Math.floor(rem / 60);
    const seconds = rem % 60;
    if (hours > 0) parts.push(formatDurationUnit(hours, "hours", t));
    if (minutes > 0) parts.push(formatDurationUnit(minutes, "minutes", t));
    if (seconds > 0) parts.push(formatDurationUnit(seconds, "seconds", t));
  }
  return expiresIn(parts.join(" "));
}
