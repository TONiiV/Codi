import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeUsageLimitPause, usageLimitTickIntervalMs } from "./usageLimit.ts";

const NOW = "2026-09-04T12:00:00.000Z";
const pauseAt = (resetsAt: string) => ({
  resetsAt,
  messageId: MessageId.make("message-1"),
  recordedAt: NOW,
});

describe("describeUsageLimitPause", () => {
  it("reads minutes while the wait is under an hour", () => {
    const view = describeUsageLimitPause(pauseAt("2026-09-04T12:45:00.000Z"), { now: NOW });
    expect(view?.countdown).toBe("45m");
    expect(view?.isDue).toBe(false);
  });

  it("reads hours for a typical rolling window", () => {
    expect(
      describeUsageLimitPause(pauseAt("2026-09-04T17:00:00.000Z"), { now: NOW })?.countdown,
    ).toBe("5h");
  });

  it("is due once the reset has passed", () => {
    const view = describeUsageLimitPause(pauseAt("2026-09-04T11:00:00.000Z"), { now: NOW });
    expect(view?.countdown).toBe("now");
    expect(view?.isDue).toBe(true);
  });

  it("has nothing to say without a pause", () => {
    expect(describeUsageLimitPause(null, { now: NOW })).toBe(null);
    expect(describeUsageLimitPause(undefined, { now: NOW })).toBe(null);
    expect(describeUsageLimitPause(pauseAt("not-a-date"), { now: NOW })).toBe(null);
  });
});

describe("usageLimitTickIntervalMs", () => {
  it("ticks by the minute only while the countdown reads in minutes", () => {
    expect(
      usageLimitTickIntervalMs(
        describeUsageLimitPause(pauseAt("2026-09-04T12:45:00.000Z"), { now: NOW }),
      ),
    ).toBe(60_000);
    expect(
      usageLimitTickIntervalMs(
        describeUsageLimitPause(pauseAt("2026-09-04T17:00:00.000Z"), { now: NOW }),
      ),
    ).toBe(3_600_000);
  });

  it("stops ticking once there is nothing left to count down", () => {
    expect(
      usageLimitTickIntervalMs(
        describeUsageLimitPause(pauseAt("2026-09-04T11:00:00.000Z"), { now: NOW }),
      ),
    ).toBe(null);
    expect(usageLimitTickIntervalMs(null)).toBe(null);
  });
});
