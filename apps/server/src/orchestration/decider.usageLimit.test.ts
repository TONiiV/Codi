import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const RESETS_AT = "2026-01-01T05:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");
const MESSAGE_ID = MessageId.make("message-1");

const userMessage: OrchestrationThread["messages"][number] = {
  id: MESSAGE_ID,
  role: "user",
  text: "ship it",
  attachments: [],
  turnId: null,
  streaming: false,
  createdAt: NOW,
  updatedAt: NOW,
};

function makeReadModel(input: {
  readonly sessionStatus?: OrchestrationSession["status"];
  readonly usageLimit?: OrchestrationSession["usageLimit"];
  readonly messages?: OrchestrationThread["messages"];
  readonly archivedAt?: string | null;
}): OrchestrationReadModel {
  const status = input.sessionStatus ?? "error";
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: THREAD_ID,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "opus" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: input.archivedAt ?? null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: input.messages ?? [userMessage],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status,
          providerName: "claude",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: "Claude AI usage limit reached",
          usageLimit:
            input.usageLimit === undefined
              ? { resetsAt: RESETS_AT, messageId: MESSAGE_ID, recordedAt: NOW }
              : input.usageLimit,
          updatedAt: NOW,
        },
      },
    ],
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("usage-limit decider", (it) => {
  it.effect("retrying clears the pause before it asks for the turn", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.retry",
          commandId: CommandId.make("cmd-retry"),
          threadId: THREAD_ID,
          messageId: MESSAGE_ID,
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      // Order matters: a session-set landing after the request would delete the
      // pending turn start it just created.
      expect(events.map((event) => event.type)).toEqual([
        "thread.session-set",
        "thread.turn-start-requested",
      ]);
      const sessionSet = events[0];
      if (sessionSet?.type === "thread.session-set") {
        expect(sessionSet.payload.session.usageLimit).toBe(null);
        expect(sessionSet.payload.session.status).toBe("error");
      }
      const turnStart = events[1];
      if (turnStart?.type === "thread.turn-start-requested") {
        expect(turnStart.payload.messageId).toBe(MESSAGE_ID);
      }
    }),
  );

  it.effect("retrying a thread with no pause just asks for the turn", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.retry",
          commandId: CommandId.make("cmd-retry-clean"),
          threadId: THREAD_ID,
          messageId: MESSAGE_ID,
          createdAt: NOW,
        },
        readModel: makeReadModel({ usageLimit: null }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual(["thread.turn-start-requested"]);
    }),
  );

  it.effect("refuses to retry a turn that is already running", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.retry",
          commandId: CommandId.make("cmd-retry-running"),
          threadId: THREAD_ID,
          messageId: MESSAGE_ID,
          createdAt: NOW,
        },
        readModel: makeReadModel({ sessionStatus: "running" }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("refuses to retry a message the thread does not have", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.retry",
          commandId: CommandId.make("cmd-retry-missing"),
          threadId: THREAD_ID,
          messageId: MessageId.make("message-gone"),
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("refuses to retry a prompt the user has already moved past", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.retry",
          commandId: CommandId.make("cmd-retry-stale"),
          threadId: THREAD_ID,
          messageId: MESSAGE_ID,
          createdAt: NOW,
        },
        readModel: makeReadModel({
          messages: [
            userMessage,
            {
              ...userMessage,
              id: MessageId.make("message-2"),
              text: "actually, do this instead",
            },
          ],
        }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("dismissing drops the pause and nothing else", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.usage-limit.dismiss",
          commandId: CommandId.make("cmd-dismiss"),
          threadId: THREAD_ID,
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events).toHaveLength(1);
      const sessionSet = events[0];
      expect(sessionSet?.type).toBe("thread.session-set");
      if (sessionSet?.type === "thread.session-set") {
        expect(sessionSet.payload.session.usageLimit).toBe(null);
        expect(sessionSet.payload.session.lastError).toBe("Claude AI usage limit reached");
      }
    }),
  );

  it.effect("dismissing a thread with no pause is a no-op", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.usage-limit.dismiss",
          commandId: CommandId.make("cmd-dismiss-clean"),
          threadId: THREAD_ID,
          createdAt: NOW,
        },
        readModel: makeReadModel({ usageLimit: null }),
      });
      expect(Array.isArray(decided) ? decided : [decided]).toEqual([]);
    }),
  );
});
