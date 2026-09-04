import { describe, expect, it } from "vite-plus/test";

import {
  detectUsageLimitResetAt,
  isUsageLimitErrorMessage,
  MAX_USAGE_LIMIT_WAIT_MS,
  MIN_USAGE_LIMIT_WAIT_MS,
  readRateLimitSnapshot,
  usageLimitResetFromErrorMessage,
  USAGE_LIMIT_SNAPSHOT_TTL_MS,
} from "./usageLimitSignal.ts";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");
const HOUR = 60 * 60 * 1_000;

describe("isUsageLimitErrorMessage", () => {
  it("recognises the phrasings providers actually ship", () => {
    expect(isUsageLimitErrorMessage("Claude AI usage limit reached|1772798400")).toBe(true);
    expect(isUsageLimitErrorMessage("You've hit your usage limit.")).toBe(true);
    expect(isUsageLimitErrorMessage("429 Too Many Requests")).toBe(true);
    expect(isUsageLimitErrorMessage("Rate limit exceeded for this organization")).toBe(true);
  });

  it("leaves ordinary failures alone", () => {
    expect(isUsageLimitErrorMessage("ENOENT: no such file or directory")).toBe(false);
    expect(isUsageLimitErrorMessage("Turn failed")).toBe(false);
    expect(isUsageLimitErrorMessage(undefined)).toBe(false);
  });
});

describe("usageLimitResetFromErrorMessage", () => {
  it("reads Claude's piped epoch stamp", () => {
    const resetsAt = Date.parse("2026-09-04T17:00:00.000Z");
    expect(
      usageLimitResetFromErrorMessage(
        `Claude AI usage limit reached|${Math.floor(resetsAt / 1_000)}`,
        NOW,
      ),
    ).toBe(resetsAt);
  });

  it("reads an explicit ISO timestamp", () => {
    expect(
      usageLimitResetFromErrorMessage(
        "Usage limit reached. Try again after 2026-09-04T18:30:00Z.",
        NOW,
      ),
    ).toBe(Date.parse("2026-09-04T18:30:00Z"));
  });

  it("reads a relative wait", () => {
    expect(
      usageLimitResetFromErrorMessage(
        "You've hit your usage limit. Try again in 4 hours 32 minutes.",
        NOW,
      ),
    ).toBe(NOW + 4 * HOUR + 32 * 60 * 1_000);
  });

  it("ignores numbers that are not framed as a wait", () => {
    expect(usageLimitResetFromErrorMessage("Usage limit reached after 12 files", NOW)).toBe(null);
  });
});

describe("readRateLimitSnapshot", () => {
  it("reads Claude's rate_limit_event", () => {
    expect(
      readRateLimitSnapshot({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          resetsAt: 1_772_798_400,
          rateLimitType: "five_hour",
        },
      }),
    ).toEqual({ limited: true, resetsAtMs: 1_772_798_400_000 });
  });

  it("does not call a warning a limit", () => {
    expect(
      readRateLimitSnapshot({
        rate_limit_info: { status: "allowed_warning", resetsAt: 1_772_798_400 },
      }),
    ).toEqual({ limited: false, resetsAtMs: 1_772_798_400_000 });
  });

  it("reads Codex's snapshot and prefers the exhausted window", () => {
    expect(
      readRateLimitSnapshot({
        rateLimits: {
          rateLimitReachedType: "rate_limit_reached",
          primary: { usedPercent: 100, resetsAt: 1_772_798_400 },
          secondary: { usedPercent: 40, resetsAt: 1_772_712_000 },
        },
      }),
    ).toEqual({ limited: true, resetsAtMs: 1_772_798_400_000 });
  });

  it("returns nothing it can use for unrecognised payloads", () => {
    expect(readRateLimitSnapshot({ somethingElse: true })).toBe(null);
    expect(readRateLimitSnapshot("nope")).toBe(null);
  });
});

describe("detectUsageLimitResetAt", () => {
  const base = {
    snapshot: null,
    snapshotReceivedAtMs: null,
    nowMs: NOW,
  } as const;

  it("returns nothing for an ordinary failure", () => {
    expect(detectUsageLimitResetAt({ ...base, errorMessage: "Turn failed" })).toBe(null);
  });

  it("returns nothing when a limit is named but no reset time is knowable", () => {
    expect(detectUsageLimitResetAt({ ...base, errorMessage: "Usage limit reached." })).toBe(null);
  });

  it("prefers the reset the failing turn itself reported", () => {
    expect(
      detectUsageLimitResetAt({
        ...base,
        errorMessage: `Claude AI usage limit reached|${(NOW + 3 * HOUR) / 1_000}`,
        snapshot: { limited: true, resetsAtMs: NOW + 9 * HOUR },
        snapshotReceivedAtMs: NOW - 1_000,
      }),
    ).toBe(NOW + 3 * HOUR);
  });

  it("falls back to fresh telemetry when the message carries no time", () => {
    expect(
      detectUsageLimitResetAt({
        ...base,
        errorMessage: "You've hit your usage limit.",
        snapshot: { limited: true, resetsAtMs: NOW + 2 * HOUR },
        snapshotReceivedAtMs: NOW - 5_000,
      }),
    ).toBe(NOW + 2 * HOUR);
  });

  it("ignores telemetry that predates the failure by too much", () => {
    expect(
      detectUsageLimitResetAt({
        ...base,
        errorMessage: "You've hit your usage limit.",
        snapshot: { limited: true, resetsAtMs: NOW + 2 * HOUR },
        snapshotReceivedAtMs: NOW - USAGE_LIMIT_SNAPSHOT_TTL_MS - 1,
      }),
    ).toBe(null);
  });

  it("recognises a limit from telemetry alone when the error is unhelpful", () => {
    expect(
      detectUsageLimitResetAt({
        ...base,
        errorMessage: "stream closed unexpectedly",
        snapshot: { limited: true, resetsAtMs: NOW + 90 * 60 * 1_000 },
        snapshotReceivedAtMs: NOW,
      }),
    ).toBe(NOW + 90 * 60 * 1_000);
  });

  it("holds a reset that just passed to the retry floor", () => {
    expect(
      detectUsageLimitResetAt({
        ...base,
        errorMessage: `Claude AI usage limit reached|${(NOW - 30_000) / 1_000}`,
      }),
    ).toBe(NOW + MIN_USAGE_LIMIT_WAIT_MS);
  });

  it("declines a reset too far in the past to be clock skew", () => {
    // A stale timestamp read as "resets now" would retry into the same limit
    // on a loop; leave it as an ordinary failure instead.
    expect(
      detectUsageLimitResetAt({
        ...base,
        errorMessage: `Claude AI usage limit reached|${(NOW - HOUR) / 1_000}`,
      }),
    ).toBe(null);
  });

  it("declines waits too long to be a rolling window", () => {
    expect(
      detectUsageLimitResetAt({
        ...base,
        errorMessage: `Claude AI usage limit reached|${(NOW + MAX_USAGE_LIMIT_WAIT_MS + HOUR) / 1_000}`,
      }),
    ).toBe(null);
  });
});
