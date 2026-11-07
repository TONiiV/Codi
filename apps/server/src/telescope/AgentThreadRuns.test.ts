import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  EventId,
  MessageId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  ProviderInstanceId,
  RunId,
  Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AgentThreadRuns from "./AgentThreadRuns.ts";
import * as DelegationService from "./DelegationService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(
  TelescopeDb.layer,
  RunRecordService.layer,
  WorkspaceService.layer,
  DelegationService.layer,
  Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
).pipe(
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
const resident = ThreadId.make("thread-resident");
const at = DateTime.makeUnsafe(0);
const snapshot = {
  promptVersion: "prompt@1",
  skillsVersions: {},
  powersVersion: "powers@1",
  model: "model-a",
  contextManifest: [],
};

const event = (
  type: "run.created" | "run.updated",
  id: string,
  status: OrchestrationV2Run["status"],
  threadId = resident,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event-${id}-${status}-${type}`),
  type,
  threadId,
  occurredAt: at,
  payload: {
    id: RunId.make(id),
    threadId,
    ordinal: 1,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "model-a" },
    providerThreadId: null,
    userMessageId: MessageId.make(`message-${id}`),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: at,
    startedAt: null,
    completedAt: null,
    checkpointId: null,
    contextHandoffId: null,
  },
});

it.layer(layer)("AgentThreadRuns", (it) => {
  it.effect(
    "a Codi run on an agent thread opens its own Telescope run when it starts and finishes only it once",
    () =>
      Effect.gen(function* () {
        const db = yield* TelescopeDb.TelescopeDb;
        const runs = yield* RunRecordService.RunRecordService;
        const workspace = yield* (yield* WorkspaceService.WorkspaceService).create(alice, {
          kind: "personal",
          name: "Acme",
          displayName: "Alice",
        });
        const agentId = Telescope.AgentId.make("agent-pa");
        yield* db.insert(workspace.id, "agents", {
          agent_id: agentId,
          owner_subject_id: workspace.createdBy,
          kind: "chief_of_staff",
          name: agentId,
          standing_powers_json: "{}",
          exposure: "hidden",
          sync_with_board: 0,
          dispatch_mode: "inbox",
          channels_json: "[]",
          resident_thread_id: resident,
          created_at: "2026-11-07T00:00:00.000Z",
          updated_at: "2026-11-07T00:00:00.000Z",
        });
        const started: Array<Telescope.AgentRun> = [];
        const finished: Array<Telescope.AgentRunId> = [];
        const handler = yield* AgentThreadRuns.makeHandler.pipe(
          Effect.provideService(RunRecordService.RunRecordService, {
            ...runs,
            startFor: (workspaceId, memberId, input) =>
              runs
                .startFor(workspaceId, memberId, input)
                .pipe(Effect.tap((run) => Effect.sync(() => started.push(run)))),
            finish: (ref, input) =>
              runs
                .finish(ref, input)
                .pipe(Effect.tap((run) => Effect.sync(() => finished.push(run.id)))),
          }),
        );
        const play = (events: ReadonlyArray<OrchestrationV2DomainEvent>) =>
          Effect.forEach(events, handler.handle, { discard: true });
        const runtimeRun = yield* runs.startFor(workspace.id, workspace.createdBy, {
          agentId,
          threadId: resident,
          inputSnapshot: { ...snapshot, codiMessageId: "message-codi-2" },
        });

        // A run queued behind the agent's turn opens nothing until it starts.
        yield* play([
          event("run.created", "codi-elsewhere", "running", ThreadId.make("thread-plain")),
          event("run.created", "codi-1", "queued"),
        ]);
        assert.lengthOf(started, 0);
        yield* play([event("run.updated", "codi-1", "running")]);
        assert.lengthOf(started, 1);
        const opened = started[0]!;
        assert.deepStrictEqual(
          [opened.agentId, opened.threadId, opened.onBehalfOf, opened.inputSnapshot.codiMessageId],
          [agentId, resident, [workspace.createdBy], "message-codi-1"],
        );

        // The runtime's run serves codi-2: its start opens nothing, codi-1's end leaves it open.
        yield* play([
          event("run.updated", "codi-2", "running"),
          event("run.updated", "codi-1", "running"),
          event("run.updated", "codi-1", "completed"),
          event("run.updated", "codi-1", "completed"),
        ]);
        assert.lengthOf(started, 1);
        assert.deepStrictEqual(finished, [opened.id]);
        assert.deepStrictEqual(
          (yield* db.openRunsOnThread(resident)).map((run) => run.runId),
          [runtimeRun.id],
        );
        yield* play([event("run.updated", "codi-2", "interrupted")]);
        assert.deepStrictEqual(finished, [opened.id, runtimeRun.id]);
      }),
  );
});
