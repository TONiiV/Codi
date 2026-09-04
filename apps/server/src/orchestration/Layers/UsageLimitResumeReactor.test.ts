import {
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationSession,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import {
  ProjectionThreadSessionRepository,
  type ProjectionThreadSession,
  type ProjectionThreadSessionRepositoryShape,
} from "../../persistence/Services/ProjectionThreadSessions.ts";
import { layerTest as serverSettingsLayerTest } from "../../serverSettings.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { UsageLimitResumeReactor } from "../Services/UsageLimitResumeReactor.ts";
import { UsageLimitResumeReactorLive } from "./UsageLimitResumeReactor.ts";

// The Effect test clock starts at the epoch, so "later today" is 1970.
const NOW = "1970-01-01T00:00:00.000Z";
const RESETS_AT = "1970-01-01T05:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");
const MESSAGE_ID = MessageId.make("message-1");

const parkedRow: ProjectionThreadSession = {
  threadId: THREAD_ID,
  status: "error",
  providerName: "claude",
  providerInstanceId: null,
  runtimeMode: "full-access",
  activeTurnId: null,
  lastError: "Claude AI usage limit reached",
  usageLimitResetsAt: RESETS_AT,
  usageLimitMessageId: MESSAGE_ID,
  usageLimitRecordedAt: NOW,
  updatedAt: NOW,
};

function sessionSetEvent(input: {
  readonly sequence: number;
  readonly usageLimit: OrchestrationSession["usageLimit"];
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`evt-${input.sequence}`),
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    type: "thread.session-set",
    occurredAt: NOW,
    commandId: CommandId.make(`cmd-${input.sequence}`),
    causationEventId: null,
    correlationId: CorrelationId.make(`cmd-${input.sequence}`),
    metadata: {},
    payload: {
      threadId: THREAD_ID,
      session: {
        threadId: THREAD_ID,
        status: "error",
        providerName: "claude",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: "Claude AI usage limit reached",
        usageLimit: input.usageLimit,
        updatedAt: NOW,
      },
    },
  };
}

const makeHarness = Effect.fn("makeHarness")(function* (input: {
  readonly rows: ReadonlyArray<ProjectionThreadSession>;
}) {
  const dispatched = yield* Ref.make<Array<OrchestrationCommand>>([]);
  const events = yield* PubSub.unbounded<OrchestrationEvent>();
  const engine = {
    latestSequence: Effect.succeed(0),
    streamDomainEvents: Stream.fromPubSub(events),
    dispatch: (command: OrchestrationCommand) => Ref.update(dispatched, (all) => [...all, command]),
  } as unknown as OrchestrationEngineShape;
  const sessions = {
    listPendingUsageLimits: () => Effect.succeed(input.rows),
  } as unknown as ProjectionThreadSessionRepositoryShape;
  return { dispatched, events, engine, sessions };
});

const layerFor = (input: {
  readonly engine: OrchestrationEngineShape;
  readonly sessions: ProjectionThreadSessionRepositoryShape;
  readonly autoResume?: boolean;
}) =>
  UsageLimitResumeReactorLive.pipe(
    Layer.provide(Layer.succeed(OrchestrationEngineService, input.engine)),
    Layer.provide(Layer.succeed(ProjectionThreadSessionRepository, input.sessions)),
    Layer.provide(serverSettingsLayerTest({ autoResumeAfterUsageLimit: input.autoResume ?? true })),
    Layer.provide(NodeServices.layer),
  );

describe("UsageLimitResumeReactor", () => {
  effectIt.effect("resumes a parked turn once the reset time passes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ rows: [parkedRow] });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* UsageLimitResumeReactor;
          yield* reactor.start();

          yield* TestClock.adjust(Duration.hours(4));
          expect(yield* Ref.get(harness.dispatched)).toEqual([]);

          // The reset itself is not the moment to retry: the reactor waits out
          // a short grace so it does not knock on the door as it opens.
          yield* TestClock.adjust(Duration.hours(1));
          expect(yield* Ref.get(harness.dispatched)).toEqual([]);

          yield* TestClock.adjust(Duration.minutes(1));
          const commands = yield* Ref.get(harness.dispatched);
          expect(commands).toHaveLength(1);
          expect(commands[0]?.type).toBe("thread.turn.retry");
          if (commands[0]?.type === "thread.turn.retry") {
            expect(commands[0].threadId).toBe(THREAD_ID);
            expect(commands[0].messageId).toBe(MESSAGE_ID);
          }
        }),
      ).pipe(Effect.provide(layerFor(harness)));
    }).pipe(Effect.provide(TestClock.layer())),
  );

  effectIt.effect("a session-set that drops the pause cancels the resume", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ rows: [parkedRow] });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* UsageLimitResumeReactor;
          yield* reactor.start();
          yield* TestClock.adjust(Duration.minutes(1));

          yield* PubSub.publish(harness.events, sessionSetEvent({ sequence: 1, usageLimit: null }));
          yield* TestClock.adjust(Duration.hours(6));

          expect(yield* Ref.get(harness.dispatched)).toEqual([]);
        }),
      ).pipe(Effect.provide(layerFor(harness)));
    }).pipe(Effect.provide(TestClock.layer())),
  );

  effectIt.effect("a pause recorded on the live stream schedules a resume", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ rows: [] });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* UsageLimitResumeReactor;
          yield* reactor.start();
          yield* TestClock.adjust(Duration.minutes(1));

          yield* PubSub.publish(
            harness.events,
            sessionSetEvent({
              sequence: 1,
              usageLimit: { resetsAt: RESETS_AT, messageId: MESSAGE_ID, recordedAt: NOW },
            }),
          );
          yield* TestClock.adjust(Duration.hours(6));

          const commands = yield* Ref.get(harness.dispatched);
          expect(commands).toHaveLength(1);
          expect(commands[0]?.type).toBe("thread.turn.retry");
        }),
      ).pipe(Effect.provide(layerFor(harness)));
    }).pipe(Effect.provide(TestClock.layer())),
  );

  effectIt.effect("leaves the thread parked when auto-resume is turned off", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ rows: [parkedRow] });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const reactor = yield* UsageLimitResumeReactor;
          yield* reactor.start();
          yield* TestClock.adjust(Duration.hours(6));

          expect(yield* Ref.get(harness.dispatched)).toEqual([]);
        }),
      ).pipe(Effect.provide(layerFor({ ...harness, autoResume: false })));
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
