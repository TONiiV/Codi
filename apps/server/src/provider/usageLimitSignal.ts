/**
 * usageLimitSignal - Recognising "you are out of usage for now" across providers.
 *
 * Providers say the same thing five different ways: Claude ships a structured
 * `rate_limit_event`, Codex ships a rate-limit snapshot, and every one of them
 * can also just hand back an error string. This module turns any of those into
 * the one fact the orchestration layer needs — the instant the window reopens —
 * and stays pure so the rules are testable without a provider attached.
 *
 * @module usageLimitSignal
 */

/**
 * A limit further out than this is not a rolling window we should wait on
 * (monthly caps, disabled accounts). Auto-resuming a day later would surprise
 * the user far more than leaving the thread parked.
 */
export const MAX_USAGE_LIMIT_WAIT_MS = 24 * 60 * 60 * 1_000;

/**
 * Providers stamp the reset at the top of the window, so a reset a moment away
 * (or a moment past) usually means the clocks disagree, not that the quota is
 * back. Wait out the floor rather than retrying into the limit.
 */
export const MIN_USAGE_LIMIT_WAIT_MS = 60 * 1_000;

/**
 * How far into the past a reset may sit and still be read as clock skew.
 * Beyond this the timestamp is stale — a leftover error message being echoed
 * back, most likely — and treating it as "resets now" would retry into the
 * same limit on a loop.
 */
export const MAX_USAGE_LIMIT_CLOCK_SKEW_MS = 5 * 60 * 1_000;

/**
 * How stale a rate-limit snapshot may be and still explain a turn failure.
 * Providers push these as utilisation moves, so the one that matters lands in
 * the same breath as the rejection.
 */
export const USAGE_LIMIT_SNAPSHOT_TTL_MS = 10 * 60 * 1_000;

const USAGE_LIMIT_PHRASES = [
  "usage limit",
  "rate limit",
  "rate-limit",
  "rate_limit",
  "ratelimit",
  "limit reached",
  "reached your limit",
  "too many requests",
  "quota exceeded",
  "exceeded your quota",
  "http 429",
  "status 429",
  "error 429",
];

/**
 * Whether a provider error message is the provider saying "come back later"
 * rather than a real failure. Deliberately phrase-based: every provider CLI
 * writes its own prose, and none of them tag the condition on the wire.
 */
export function isUsageLimitErrorMessage(message: string | undefined): boolean {
  if (message === undefined) {
    return false;
  }
  const text = message.toLowerCase();
  return USAGE_LIMIT_PHRASES.some((phrase) => text.includes(phrase));
}

/**
 * Normalise a provider epoch stamp to milliseconds. Claude and Codex both
 * report seconds; a value already past the year-2001 millisecond threshold is
 * taken as milliseconds so a future provider switching units is not read as a
 * date in 1970.
 */
function epochToMillis(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value >= 1e12 ? value : value * 1_000;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

const ISO_TIMESTAMP_PATTERN =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/i;

/**
 * `<n> hours <n> minutes`, `45m`, `90 seconds` — the relative form Codex and
 * plain HTTP 429 bodies use. Only read when the surrounding text frames it as
 * a wait ("try again in", "retry after", "resets in").
 */
const RELATIVE_WAIT_PATTERN =
  /(?:try again in|retry after|retry in|resets? in|available again in|wait)\s+(?<body>[0-9][0-9a-z .,]*?)(?=[.;)\n]|$)/i;

const DURATION_PART_PATTERN =
  /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/g;

function parseRelativeWaitMs(text: string): number | null {
  const framed = RELATIVE_WAIT_PATTERN.exec(text);
  const body = framed?.groups?.body;
  if (body === undefined) {
    return null;
  }
  let total = 0;
  for (const [, amount, unit] of body.matchAll(DURATION_PART_PATTERN)) {
    const value = Number(amount);
    if (!Number.isFinite(value) || unit === undefined) {
      continue;
    }
    const normalizedUnit = unit.toLowerCase();
    if (normalizedUnit.startsWith("h")) {
      total += value * 60 * 60 * 1_000;
    } else if (normalizedUnit.startsWith("m")) {
      total += value * 60 * 1_000;
    } else {
      total += value * 1_000;
    }
  }
  return total > 0 ? total : null;
}

/**
 * The reset instant a provider embedded in its own error text, in epoch
 * milliseconds. Handles the three shapes seen in the wild: Claude's
 * `...usage limit reached|<epoch seconds>`, an explicit ISO timestamp, and a
 * relative "try again in 4 hours 32 minutes".
 */
export function usageLimitResetFromErrorMessage(
  message: string | undefined,
  nowMs: number,
): number | null {
  if (message === undefined) {
    return null;
  }

  // Claude CLI: "Claude AI usage limit reached|1712345678".
  const piped = /limit reached\|(\d{9,16})/i.exec(message);
  if (piped?.[1] !== undefined) {
    const parsed = epochToMillis(Number(piped[1]));
    if (parsed !== null) {
      return parsed;
    }
  }

  const iso = ISO_TIMESTAMP_PATTERN.exec(message);
  if (iso?.[0] !== undefined) {
    const parsed = Date.parse(iso[0].replace(" ", "T"));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const relative = parseRelativeWaitMs(message);
  return relative === null ? null : nowMs + relative;
}

/**
 * A provider's rate-limit telemetry, reduced to the two things that matter:
 * whether the account is currently over a limit, and when the tightest window
 * that is over reopens.
 */
export type RateLimitSnapshot = {
  readonly limited: boolean;
  readonly resetsAtMs: number | null;
};

/**
 * Read `account.rate-limits.updated` telemetry from any provider.
 *
 * Claude sends `SDKRateLimitEvent` (`rate_limit_info.status === "rejected"`
 * plus `resetsAt`); Codex sends a `RateLimitSnapshot` with `primary`/
 * `secondary` windows and a `rateLimitReachedType`. Anything unrecognised
 * reads as "no information", never as "limited".
 */
export function readRateLimitSnapshot(payload: unknown): RateLimitSnapshot | null {
  const root = asRecord(payload);
  if (root === null) {
    return null;
  }

  // Claude: the adapter forwards the whole SDK message.
  const claudeInfo = asRecord(root.rate_limit_info);
  if (claudeInfo !== null) {
    const status = claudeInfo.status;
    const resetsAtMs =
      typeof claudeInfo.resetsAt === "number" ? epochToMillis(claudeInfo.resetsAt) : null;
    return { limited: status === "rejected", resetsAtMs };
  }

  // Codex: `{ rateLimits: { primary, secondary, rateLimitReachedType } }`, or
  // the snapshot itself when a caller has already unwrapped it.
  const snapshot = asRecord(root.rateLimits) ?? root;
  const windows = [asRecord(snapshot.primary), asRecord(snapshot.secondary)].filter(
    (window): window is Record<string, unknown> => window !== null,
  );
  if (windows.length === 0) {
    return null;
  }
  const limited =
    typeof snapshot.rateLimitReachedType === "string" ||
    windows.some((window) => typeof window.usedPercent === "number" && window.usedPercent >= 100);
  // The window that is actually exhausted decides the wait; when none is,
  // the soonest reset is the best guess available.
  const exhausted = windows.filter(
    (window) => typeof window.usedPercent === "number" && window.usedPercent >= 100,
  );
  const resets = (exhausted.length > 0 ? exhausted : windows)
    .map((window) => (typeof window.resetsAt === "number" ? epochToMillis(window.resetsAt) : null))
    .filter((value): value is number => value !== null);
  return {
    limited,
    resetsAtMs: resets.length === 0 ? null : Math.min(...resets),
  };
}

export type UsageLimitDetectionInput = {
  /** The provider's own words for why the turn stopped. */
  readonly errorMessage: string | undefined;
  /** Most recent rate-limit telemetry for the thread, if any. */
  readonly snapshot: RateLimitSnapshot | null;
  /** When that telemetry arrived, so a stale snapshot cannot explain a fresh failure. */
  readonly snapshotReceivedAtMs: number | null;
  readonly nowMs: number;
};

/**
 * Decide whether a failed turn was stopped by a usage limit, and when to pick
 * it back up.
 *
 * Returns epoch milliseconds clamped into `[now + MIN, now + MAX]`, or `null`
 * when this is an ordinary failure or the wait is too long to be a rolling
 * window worth waiting on.
 */
export function detectUsageLimitResetAt(input: UsageLimitDetectionInput): number | null {
  const snapshotIsFresh =
    input.snapshot !== null &&
    input.snapshotReceivedAtMs !== null &&
    input.nowMs - input.snapshotReceivedAtMs <= USAGE_LIMIT_SNAPSHOT_TTL_MS;
  const snapshotSaysLimited = snapshotIsFresh && input.snapshot?.limited === true;

  if (!isUsageLimitErrorMessage(input.errorMessage) && !snapshotSaysLimited) {
    return null;
  }

  // The error text is the provider talking about this failure; the snapshot is
  // account-wide telemetry that may predate it, so it only fills the gap.
  const fromMessage = usageLimitResetFromErrorMessage(input.errorMessage, input.nowMs);
  const fromSnapshot = snapshotIsFresh ? (input.snapshot?.resetsAtMs ?? null) : null;
  const resetsAtMs = fromMessage ?? fromSnapshot;
  if (resetsAtMs === null) {
    return null;
  }

  const waitMs = resetsAtMs - input.nowMs;
  if (waitMs > MAX_USAGE_LIMIT_WAIT_MS || waitMs < -MAX_USAGE_LIMIT_CLOCK_SKEW_MS) {
    return null;
  }
  return Math.max(resetsAtMs, input.nowMs + MIN_USAGE_LIMIT_WAIT_MS);
}
