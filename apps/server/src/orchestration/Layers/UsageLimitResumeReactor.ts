import { CommandId, type MessageId, type ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ProjectionThreadSessionRepository } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { forkParked } from "../../serverActivation.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  UsageLimitResumeReactor,
  type UsageLimitResumeReactorShape,
} from "../Services/UsageLimitResumeReactor.ts";

/**
 * Providers hand back the top of the reset window, and hitting it to the
 * millisecond just earns a second rejection. A small grace costs nothing
 * against waits measured in hours.
 */
const RESET_GRACE = Duration.seconds(15);

type PendingResume = {
  readonly resetsAt: string;
  readonly messageId: MessageId;
  readonly fiber: Fiber.Fiber<void, never>;
};

/**
 * A pause is identified by the reset it is waiting on plus the message it will
 * resume; anything else about the session can move without disturbing a timer
 * that is already counting down the right window.
 */
const sameResume = (
  pending: PendingResume | undefined,
  next: { readonly resetsAt: string; readonly messageId: MessageId },
): boolean => pending?.resetsAt === next.resetsAt && pending.messageId === next.messageId;

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionThreadSessionRepository = yield* ProjectionThreadSessionRepository;
  const serverSettingsService = yield* ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  const pendingByThread = new Map<ThreadId, PendingResume>();

  const cancel = Effect.fn("cancel")(function* (threadId: ThreadId) {
    const pending = pendingByThread.get(threadId);
    if (pending === undefined) {
      return;
    }
    pendingByThread.delete(threadId);
    yield* Fiber.interrupt(pending.fiber).pipe(Effect.ignore);
  });

  /**
   * Sleep until the wall clock passes `targetMs`.
   *
   * Re-checks after waking instead of trusting one timer: a host that suspends
   * mid-wait resumes with the timer already overdue, and one that fires early
   * would otherwise retry straight back into the limit.
   */
  const sleepUntil = Effect.fn("sleepUntil")(function* (targetMs: number) {
    while (true) {
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      const remaining = targetMs - nowMs;
      if (remaining <= 0) {
        return;
      }
      yield* Effect.sleep(Duration.millis(remaining));
    }
  });

  const resumeNow = Effect.fn("resumeNow")(function* (input: {
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
  }) {
    const settings = yield* serverSettingsService.getSettings;
    if (!settings.autoResumeAfterUsageLimit) {
      // Read at fire time, not schedule time, so turning auto-resume off while
      // a thread is parked actually stops it. The pause itself stays put — the
      // user can still resume by hand.
      yield* Effect.logDebug("usage limit auto-resume disabled; leaving thread parked", {
        threadId: input.threadId,
      });
      return;
    }
    const commandUuid = yield* crypto.randomUUIDv4;
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    yield* orchestrationEngine.dispatch({
      type: "thread.turn.retry",
      commandId: CommandId.make(`server:usage-limit-resume:${commandUuid}`),
      threadId: input.threadId,
      messageId: input.messageId,
      createdAt,
    });
  });

  /**
   * Park a thread's resume until its reset time. Rescheduling the same pause
   * is a no-op so the flurry of session-sets around a failing turn does not
   * restart the countdown.
   */
  const schedule = Effect.fn("schedule")(function* (input: {
    readonly threadId: ThreadId;
    readonly resetsAt: string;
    readonly messageId: MessageId;
  }) {
    if (sameResume(pendingByThread.get(input.threadId), input)) {
      return;
    }
    const targetMs = Date.parse(input.resetsAt);
    if (!Number.isFinite(targetMs)) {
      yield* Effect.logWarning("usage limit resume skipped an unparseable reset time", {
        threadId: input.threadId,
        resetsAt: input.resetsAt,
      });
      return;
    }
    yield* cancel(input.threadId);

    const wait = Effect.gen(function* () {
      yield* sleepUntil(targetMs + Duration.toMillis(RESET_GRACE));
      // The dispatch that follows lands a session-set clearing this pause,
      // which loops back through the subscription as a cancel; dropping the
      // entry first keeps that from interrupting the fiber mid-dispatch.
      pendingByThread.delete(input.threadId);
      yield* resumeNow({ threadId: input.threadId, messageId: input.messageId });
    }).pipe(
      Effect.catchCause((cause) => {
        pendingByThread.delete(input.threadId);
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.void;
        }
        // A thread archived, deleted, or already restarted by hand rejects the
        // retry. That is the pause losing a race it was never meant to win.
        return Effect.logDebug("usage limit auto-resume did not restart the turn", {
          threadId: input.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

    const scope = yield* Effect.scope;
    const fiber = yield* Effect.forkIn(wait, scope);
    pendingByThread.set(input.threadId, {
      resetsAt: input.resetsAt,
      messageId: input.messageId,
      fiber,
    });
  });

  const restoreFromProjection = Effect.fn("restoreFromProjection")(function* () {
    const rows = yield* projectionThreadSessionRepository.listPendingUsageLimits();
    for (const row of rows) {
      if (row.usageLimitResetsAt === null || row.usageLimitMessageId === null) {
        continue;
      }
      yield* schedule({
        threadId: row.threadId,
        resetsAt: row.usageLimitResetsAt,
        messageId: row.usageLimitMessageId,
      });
    }
  });

  const start: UsageLimitResumeReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(
        orchestrationEngine.streamDomainEvents.pipe(
          // Pauses that predate the subscription live in the projection, so
          // adopt them before the live stream starts moving.
          Stream.onStart(
            restoreFromProjection().pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("usage limit resume could not restore pending pauses", {
                  cause: Cause.pretty(cause),
                }),
              ),
            ),
          ),
        ),
        (event) => {
          if (event.type === "thread.deleted") {
            return cancel(event.payload.threadId);
          }
          if (event.type !== "thread.session-set") {
            return Effect.void;
          }
          const usageLimit = event.payload.session.usageLimit;
          return usageLimit == null
            ? cancel(event.payload.threadId)
            : schedule({
                threadId: event.payload.threadId,
                resetsAt: usageLimit.resetsAt,
                messageId: usageLimit.messageId,
              });
        },
      ),
    );
  });

  return {
    start,
  } satisfies UsageLimitResumeReactorShape;
});

export const UsageLimitResumeReactorLive = Layer.effect(UsageLimitResumeReactor, make);
