import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  EventId,
  NodeId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderTurn,
  ProviderThreadId,
  ProviderTurnId,
  Telescope,
  ThreadId,
  type TurnTokenUsage,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as ThreadTurnTokens from "./ThreadTurnTokens.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(RunRecordService.layer, WorkspaceService.layer).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env-elsewhere")),
    }),
  ),
);

const alice: WorkspaceService.Caller = {
  sessionId: AuthSessionId.make("session-alice"),
  subject: "one-time-token",
};
const threadId = ThreadId.make("thread-1");
const otherThreadId = ThreadId.make("thread-2");
const at = DateTime.makeUnsafe(0);
const noTokens = { input: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
const snapshot = {
  promptVersion: "prompt@1",
  skillsVersions: {},
  powersVersion: "powers@1",
  model: "model-a",
  contextManifest: [],
};

const usage = (input: number, output: number, cachedInput = 0): TurnTokenUsage => ({
  usageScope: "main_agent",
  usageStatus: "complete",
  hasSubagents: false,
  inputTokens: input,
  outputTokens: output,
  cachedInputTokens: cachedInput,
});
const turn = (
  id: string,
  status: OrchestrationV2ProviderTurn["status"],
  turnTokenUsage: TurnTokenUsage,
  onThread = threadId,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event-${id}-${status}`),
  type: "provider-turn.updated",
  threadId: onThread,
  occurredAt: at,
  payload: {
    id: ProviderTurnId.make(id),
    providerThreadId: ProviderThreadId.make("provider-thread"),
    nodeId: NodeId.make("node"),
    runAttemptId: null,
    nativeTurnRef: null,
    ordinal: 1,
    status,
    startedAt: at,
    completedAt: status === "running" ? null : at,
    turnTokenUsage,
  },
});

it.layer(layer)("ThreadTurnTokens", (it) => {
  it.effect("adds each finished turn's tokens, subagents too, once to its thread's open runs", () =>
    Effect.gen(function* () {
      const workspaces = yield* WorkspaceService.WorkspaceService;
      const runs = yield* RunRecordService.RunRecordService;
      const { id: workspaceId } = yield* workspaces.create(alice, {
        kind: "enterprise",
        name: "Acme",
        displayName: "Alice",
      });
      const start = runs.start(alice, workspaceId, {
        agentId: Telescope.AgentId.make("agent-pm"),
        inputSnapshot: snapshot,
        threadId,
      });
      const finished = yield* start;
      yield* runs.finish(
        { workspaceId, runId: finished.id },
        { outputSummary: "done", tokens: noTokens, resultLabels: [] },
      );
      const open = yield* start;

      const events = [
        turn("a", "running", usage(50, 10)),
        turn("a", "completed", usage(100, 20, 6)),
        turn("a", "completed", usage(100, 20, 6)),
        turn("b", "failed", { ...usage(10, 2), otherUsage: { inputTokens: 3, outputTokens: 4 } }),
        turn("c", "completed", { ...usage(1000, 1000), localCommand: true }),
        turn("d", "completed", {
          usageScope: "main_agent",
          usageStatus: "unavailable",
          hasSubagents: false,
        }),
        turn("e", "completed", usage(7, 7), otherThreadId),
      ];
      const recorded: Array<readonly [ThreadId, number]> = [];
      const done = yield* Deferred.make<void>();
      const recordingRuns = Layer.succeed(RunRecordService.RunRecordService)({
        ...runs,
        recordThreadTurn: (onThread, tokens) =>
          Effect.sync(() => recorded.push([onThread, tokens.input])).pipe(
            Effect.andThen(runs.recordThreadTurn(onThread, tokens)),
          ),
      });
      const orchestrator = Layer.mock(Orchestrator.OrchestratorV2)({
        streamDomainEvents: Stream.fromIterable(events).pipe(
          Stream.ensuring(Deferred.succeed(done, undefined)),
        ),
      });
      yield* Effect.scoped(
        Layer.build(
          ThreadTurnTokens.layer.pipe(Layer.provide(Layer.merge(recordingRuns, orchestrator))),
        ).pipe(Effect.andThen(Deferred.await(done))),
      );

      assert.deepStrictEqual(recorded, [
        [threadId, 100],
        [threadId, 13],
        [otherThreadId, 7],
      ]);
      const tokens = (runId: Telescope.AgentRunId) =>
        runs.get(alice, { workspaceId, runId }).pipe(Effect.map((run) => run.tokens));
      assert.deepStrictEqual(yield* tokens(open.id), {
        input: 113,
        cachedInput: 6,
        cacheCreation: 0,
        output: 26,
      });
      assert.deepStrictEqual(yield* tokens(finished.id), noTokens);
    }),
  );
});
