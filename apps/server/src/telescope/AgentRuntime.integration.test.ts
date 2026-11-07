import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { MemoryToolkit } from "../mcp/toolkits/memory/tools.ts";
import { TelescopeToolkit } from "../mcp/toolkits/telescope/tools.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AgentRuntime from "./AgentRuntime.ts";
import * as AgentService from "./AgentService.ts";
import * as DelegationService from "./DelegationService.ts";
import * as MemoryService from "./MemoryService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as ThreadTurnTokens from "./ThreadTurnTokens.ts";
import * as WakeQueueService from "./WakeQueueService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const selection = { instanceId, model: "test-model" };
const scratch = ProjectId.make("project:scratch");
const gripper = ProjectId.make("project:gripper");
const alice: WorkspaceService.Caller = {
  sessionId: AuthSessionId.make("session-alice"),
  subject: "one-time-token",
};
const brief = {
  goal: "推进夹爪项目",
  constraints: ["不改电机型号"],
  acceptance: ["样机能抓起 500g"],
  goalChain: ["夹爪项目"],
};
const agentTools = { ...TelescopeToolkit.tools, ...MemoryToolkit.tools };
/** Tool names the turn text mentions, quoted or bare snake_case, that the agent's thread lacks. */
const missingTools = (text: string) =>
  [...text.matchAll(/`(\w+)`|\b([a-z]+(?:_[a-z]+)+)\b/g)].flatMap(([, quoted, bare]) => {
    const name = quoted ?? bare;
    return name === undefined || name in agentTools ? [] : [name];
  });
const decodeRuns = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ run_id: Telescope.AgentRunId, on_behalf_of_json: Schema.String })),
);

/** A provider whose session start records the thread's open Telescope run, as tools/list would. */
const makeHarness = Effect.fn("makeHarness")(function* (options: {
  readonly mcp: boolean;
  readonly rejectCreate?: boolean;
  readonly rejectStart?: boolean;
  readonly rejectSend?: boolean;
  readonly holdTokens?: boolean;
  readonly holdScratch?: boolean;
}) {
  const cwd = yield* checkpointWorkspace(`telescope-agent-runtime-${options.mcp}`);
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const sessions = yield* Queue.unbounded<{
    readonly onBehalfOf?: string;
    readonly visible: boolean;
  }>();
  const started = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2TurnInput>();
  const finished = yield* Queue.unbounded<Telescope.AgentRun>();
  // With `holdTokens`, the listener waits for a permit at each turn's tokens, as a busy one lags.
  const recorded = yield* Queue.unbounded<void>();
  const permits = yield* Queue.unbounded<void>();
  const waits = yield* Queue.unbounded<void>();
  // With `holdScratch`, each caller reaching Scratch waits for `scratchGate`.
  const atScratch = yield* Queue.unbounded<void>();
  const scratchGate = yield* Deferred.make<void>();
  const services = yield* Deferred.make<{
    readonly db: TelescopeDb.TelescopeDb["Service"];
    readonly memory: MemoryService.MemoryService["Service"];
  }>();
  const capabilities = {
    ...CodexProviderCapabilitiesV2,
    tools: { ...CodexProviderCapabilitiesV2.tools, supportsMcpTools: options.mcp },
  };
  const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(capabilities),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        const { db, memory } = yield* Deferred.await(services);
        const [run] = yield* db.latestRunForThread(input.threadId, decodeRuns).pipe(Effect.orDie);
        const visible = yield* memory.callerForThread(input.threadId).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        yield* Queue.offer(sessions, {
          ...(run && { onBehalfOf: run.on_behalf_of_json }),
          visible,
        });
        const now = yield* DateTime.now;
        return {
          instanceId,
          driver,
          providerSessionId: input.providerSessionId,
          providerSession: {
            id: input.providerSessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd,
            model: selection.model,
            capabilities,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          ensureThread: ({ threadId }) =>
            Effect.succeed({
              id: ProviderThreadId.make(`provider-thread:${threadId}`),
              driver,
              providerInstanceId: instanceId,
              providerSessionId: input.providerSessionId,
              appThreadId: threadId,
              ownerNodeId: null,
              nativeThreadRef: { driver, nativeId: `native:${threadId}`, strength: "strong" },
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
            }),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (turn) => Queue.offer(started, turn).pipe(Effect.asVoid),
          compactThread: () => Effect.die("unused"),
          steerTurn: () => Effect.die("unused"),
          interruptTurn: () => Effect.die("unused"),
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
  };
  const complete = (turn: ProviderAdapter.ProviderAdapterV2TurnInput, inputTokens: number) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const id = ProviderTurnId.make(`provider-turn:${turn.attemptId}`);
      yield* Queue.offer(events, {
        type: "provider_turn.updated",
        driver,
        providerTurn: {
          id,
          providerThreadId: turn.providerThread.id,
          nodeId: turn.rootNodeId,
          runAttemptId: turn.attemptId,
          nativeTurnRef: { driver, nativeId: `native:${turn.attemptId}`, strength: "strong" },
          ordinal: turn.providerTurnOrdinal,
          status: "completed",
          startedAt: now,
          completedAt: now,
          turnTokenUsage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            hasSubagents: false,
            inputTokens,
            outputTokens: 1,
          },
        },
      });
      yield* Queue.offer(events, {
        type: "turn.terminal",
        driver,
        providerThreadId: turn.providerThread.id,
        providerTurnId: id,
        runOrdinal: turn.runOrdinal,
        status: "completed",
        failure: null,
        threadDisposition: "reusable",
      });
    });

  const database = SqlitePersistence.layerMemory;
  const registry = ProviderAdapterRegistry.layerSingle(adapter);
  const telescope = Layer.mergeAll(
    TelescopeDb.layer,
    WorkspaceService.layer,
    AgentService.layer,
    DelegationService.layer,
    WakeQueueService.layer,
    MemoryService.layer,
  ).pipe(
    Layer.provideMerge(RunRecordService.layer),
    Layer.provideMerge(ProjectStore.layer),
    Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
    Layer.provide(
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("env-telescope")),
      }),
    ),
  );
  const orchestration = ThreadManagementService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ProjectionStore.layer.pipe(Layer.provide(database)),
        EventStore.layer.pipe(Layer.provide(database)),
        EffectOutbox.layer.pipe(Layer.provide(database)),
        ProviderReplayHarness.layerWithRegistry({ name: "telescope-agent-runtime" }, registry, {
          databaseLayer: database,
        }),
      ),
    ),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(CommandReceiptStore.layer.pipe(Layer.provide(database))),
  );
  const recordingRuns = Layer.effect(
    RunRecordService.RunRecordService,
    Effect.map(RunRecordService.RunRecordService, (runs) => ({
      ...runs,
      finish: (ref, input) =>
        runs.finish(ref, input).pipe(Effect.tap((run) => Queue.offer(finished, run))),
      recordThreadTurn: (...args) =>
        options.holdTokens === true
          ? Queue.offer(recorded, undefined).pipe(
              Effect.andThen(Queue.take(permits)),
              Effect.andThen(runs.recordThreadTurn(...args)),
            )
          : runs.recordThreadTurn(...args),
    })),
  );
  const threads = Layer.effect(
    ThreadManagementService.ThreadManagementService,
    Effect.map(ThreadManagementService.ThreadManagementService, (service) => {
      const disabled = (projectId: ProjectId) =>
        Effect.fail(
          new ThreadManagementService.ThreadManagementProviderInstanceDisabledError({
            projectId,
            instanceId,
          }),
        );
      return {
        ...service,
        dispatch: (command) =>
          options.rejectCreate === true && command.type === "thread.create"
            ? disabled(command.projectId)
            : service.dispatch(command),
        sendToThread: (input) =>
          options.rejectSend === true ? disabled(input.projectId) : service.sendToThread(input),
        // Signals a wake waiting for a turn already on its resident thread.
        waitForThread: (input) =>
          (input.runId === undefined ? Queue.offer(waits, undefined) : Effect.void).pipe(
            Effect.andThen(service.waitForThread(input)),
          ),
      };
    }),
  );
  const startable = Layer.effect(
    DelegationService.DelegationService,
    Effect.map(DelegationService.DelegationService, (service) => ({
      ...service,
      start: (ref) =>
        options.rejectStart === true
          ? Effect.fail(
              new Telescope.WorkspaceError({
                reason: "conflict",
                message: "Only a submitted delegation starts.",
              }),
            )
          : service.start(ref),
    })),
  );
  const runtime = Layer.merge(AgentRuntime.layerWakeRunner, ThreadTurnTokens.layer).pipe(
    Layer.provideMerge(AgentRuntime.layer),
    Layer.provide(Layer.mergeAll(recordingRuns, threads, startable)),
    Layer.provide(registry),
    Layer.provide(
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/home/user/projects",
        ensureScratchProject:
          options.holdScratch === true
            ? Queue.offer(atScratch, undefined).pipe(
                Effect.andThen(Deferred.await(scratchGate)),
                Effect.as({ projectId: scratch }),
              )
            : Effect.succeed({ projectId: scratch }),
      }),
    ),
    Layer.provideMerge(Layer.merge(telescope, orchestration)),
  );
  return {
    runtime,
    services,
    sessions,
    started,
    finished,
    recorded,
    permits,
    waits,
    atScratch,
    scratchGate,
    complete,
  };
});
type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

const withHarness = <A, E>(
  options: Parameters<typeof makeHarness>[0],
  body: (harness: Harness) => Effect.Effect<A, E, Layer.Success<Harness["runtime"]> | Scope.Scope>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness(options);
      return yield* Effect.gen(function* () {
        yield* Deferred.succeed(harness.services, {
          db: yield* TelescopeDb.TelescopeDb,
          memory: yield* MemoryService.MemoryService,
        });
        return yield* body(harness);
      }).pipe(Effect.provide(harness.runtime));
    }),
  );

/** Alice's workspace with her assistant and a Chief Agent for the gripper project, both on Codex. */
const seed = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspace = yield* (yield* WorkspaceService.WorkspaceService).create(alice, {
    kind: "personal",
    name: "Acme",
    displayName: "Alice",
  });
  const { agents } = yield* (yield* AgentService.AgentService).listMine(alice, {
    workspaceId: workspace.id,
  });
  const pa = agents.find((agent) => agent.kind === "chief_of_staff")!;
  const chief = Telescope.AgentId.make("agent-gripper-chief");
  yield* db.insert(workspace.id, "agents", {
    agent_id: chief,
    owner_subject_id: workspace.createdBy,
    kind: "chief_agent",
    project_id: gripper,
    name: "Gripper Chief Agent",
    standing_powers_json: JSON.stringify(pa.standingPowers),
    exposure: "hidden",
    sync_with_board: 1,
    dispatch_mode: "inbox",
    channels_json: "[]",
    created_at: pa.createdAt,
    updated_at: pa.createdAt,
  });
  const model = { model_selection_json: JSON.stringify(selection) };
  yield* db.update(workspace.id, "agents", model, { agent_id: pa.id });
  yield* db.update(workspace.id, "agents", model, { agent_id: chief });
  const member = workspace.createdBy;
  const actor: DelegationService.Actor = {
    workspaceId: workspace.id,
    memberId: member,
    agentId: pa.id,
    onBehalfOf: [member],
    runId: Telescope.AgentRunId.make("run-pa"),
  };
  return { workspaceId: workspace.id, member, pa: pa.id, chief, actor };
});
type Seeded = Effect.Success<typeof seed>;

const enqueueMessage = (seeded: Seeded, text: string) =>
  WakeQueueService.WakeQueueService.pipe(
    Effect.flatMap((wakes) =>
      wakes.enqueue(seeded.workspaceId, {
        reason: "message",
        priority: 1,
        agentId: seeded.pa,
        subjectId: seeded.member,
        coalesceKey: `message:${text}`,
        payload: { kind: "message", text },
      }),
    ),
  );
const messageWake = (seeded: Seeded, text: string) =>
  enqueueMessage(seeded, text).pipe(
    Effect.andThen(WakeQueueService.WakeQueueService.pipe(Effect.flatMap((wakes) => wakes.take))),
  );

/** Runs the wake as the queue's worker does, which finishes it in the queue when it ends. */
const runWake = (wake: WakeQueueService.WakeRun) =>
  Effect.gen(function* () {
    const run = yield* WakeQueueService.WakeRunner;
    const wakes = yield* WakeQueueService.WakeQueueService;
    return yield* Effect.forkScoped(
      run(wake).pipe(Effect.ensuring(Effect.orDie(wakes.finish(wake.wake, "done")))),
    );
  });

const memberTypes = (threadId: ThreadId, text: string, queue = false) =>
  Orchestrator.OrchestratorV2.pipe(
    Effect.flatMap((engine) =>
      engine.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`member-types:${text}`),
        threadId,
        messageId: MessageId.make(`message:${text}`),
        text,
        attachments: [],
        dispatchMode: { type: queue ? "queue_after_active" : "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      }),
    ),
  );

const residentOf = (seeded: Seeded, agentId: Telescope.AgentId) =>
  AgentService.AgentService.pipe(
    Effect.flatMap((agents) => agents.powersOf(seeded.workspaceId, agentId)),
    Effect.map(({ agent }) => agent.residentThreadId),
  );

it.effect(
  "a member message wake opens the PA's resident thread in Scratch with a run that exists when the provider session starts",
  () =>
    withHarness({ mcp: true }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const runner = yield* runWake(yield* messageWake(seeded, "样机哪天交付？"));
        const atSession = yield* Queue.take(harness.sessions);
        const turn = yield* Queue.take(harness.started);
        const threadId = yield* residentOf(seeded, seeded.pa);
        assert.isDefined(atSession.onBehalfOf);
        assert.equal(turn.threadId, threadId);
        assert.equal(turn.appThread.projectId, scratch);
        assert.include(turn.message.text, "personal assistant");
        assert.deepStrictEqual(missingTools(turn.message.text), []);
        assert.include(turn.message.text, "样机哪天交付？");
        yield* harness.complete(turn, 100);
        yield* Fiber.join(runner);
        yield* Queue.take(harness.finished);
        assert.equal(yield* (yield* TelescopeDb.TelescopeDb).count(seeded.workspaceId, "runs"), 1);
      }),
    ),
);

it.effect(
  "the first tools/list on the resident thread includes the memory and board toolkits",
  () =>
    withHarness({ mcp: true }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const runner = yield* runWake(yield* messageWake(seeded, "早"));
        assert.isTrue((yield* Queue.take(harness.sessions)).visible);
        yield* harness.complete(yield* Queue.take(harness.started), 1);
        yield* Fiber.join(runner);
      }),
    ),
);

it.effect(
  "the wake stays running until the turn ends and the listener finishes the run with its tokens",
  () =>
    withHarness({ mcp: true }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const runner = yield* runWake(yield* messageWake(seeded, "早"));
        const turn = yield* Queue.take(harness.started);
        assert.isUndefined(runner.pollUnsafe());
        yield* harness.complete(turn, 120);
        yield* Fiber.join(runner);
        const run = yield* Queue.take(harness.finished);
        assert.equal(run.agentId, seeded.pa);
        assert.deepStrictEqual(run.onBehalfOf, [seeded.member]);
        assert.equal(run.tokens.input, 120);
      }),
    ),
);

it.effect("a turn the member types into the resident thread gets its own run", () =>
  withHarness({ mcp: true }, (harness) =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const runner = yield* runWake(yield* messageWake(seeded, "早"));
      yield* harness.complete(yield* Queue.take(harness.started), 1);
      yield* Fiber.join(runner);
      const first = yield* Queue.take(harness.finished);
      const threadId = (yield* residentOf(seeded, seeded.pa))!;
      yield* memberTypes(threadId, "顺便看看预算");
      yield* harness.complete(yield* Queue.take(harness.started), 7);
      const second = yield* Queue.take(harness.finished);
      assert.notEqual(second.id, first.id);
      assert.equal(second.threadId, threadId);
      assert.equal(second.tokens.input, 7);
    }),
  ),
);

it.effect("an archived resident thread is replaced on the next wake", () =>
  withHarness({ mcp: true }, (harness) =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const first = yield* runWake(yield* messageWake(seeded, "早"));
      yield* harness.complete(yield* Queue.take(harness.started), 1);
      yield* Fiber.join(first);
      const archived = (yield* residentOf(seeded, seeded.pa))!;
      yield* (yield* Orchestrator.OrchestratorV2).dispatch({
        type: "thread.archive",
        commandId: CommandId.make("archive-resident"),
        threadId: archived,
      });
      const second = yield* runWake(yield* messageWake(seeded, "晚"));
      const turn = yield* Queue.take(harness.started);
      const replaced = yield* residentOf(seeded, seeded.pa);
      assert.notEqual(replaced, archived);
      assert.equal(turn.threadId, replaced);
      assert.include(turn.message.text, "personal assistant");
      yield* harness.complete(turn, 1);
      yield* Fiber.join(second);
    }),
  ),
);

it.effect(
  "a second wake for a busy agent stays queued until its turn ends and runs on the agent's current model (D84)",
  () =>
    withHarness({ mcp: true }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const db = yield* TelescopeDb.TelescopeDb;
        const wakes = yield* WakeQueueService.WakeQueueService;
        yield* enqueueMessage(seeded, "早");
        yield* enqueueMessage(seeded, "晚");
        const first = yield* runWake(yield* wakes.take);
        const one = yield* Queue.take(harness.started);
        assert.isUndefined(yield* wakes.dequeue);
        yield* harness.complete(one, 1);
        yield* Fiber.join(first);
        yield* Queue.take(harness.finished);
        const changed = { instanceId, model: "other-model" };
        yield* db.update(
          seeded.workspaceId,
          "agents",
          { model_selection_json: JSON.stringify(changed) },
          { agent_id: seeded.pa },
        );
        const second = yield* runWake(yield* wakes.take);
        const two = yield* Queue.take(harness.started);
        yield* harness.complete(two, 1);
        yield* Fiber.join(second);
        assert.equal(two.threadId, one.threadId);
        assert.notInclude(two.message.text, "personal assistant");
        assert.equal(two.modelSelection.model, changed.model);
        assert.equal((yield* Queue.take(harness.finished)).inputSnapshot.model, changed.model);
      }),
    ),
);

it.effect("a Chief turn that ends without a report fails its delegation as unreported (D66)", () =>
  withHarness({ mcp: true }, (harness) =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const delegations = yield* DelegationService.DelegationService;
      const wakes = yield* WakeQueueService.WakeQueueService;
      const delegation = yield* delegations.delegate(seeded.actor, {
        toAgentId: seeded.chief,
        brief,
      });
      const runner = yield* runWake(yield* wakes.take);
      const atSession = yield* Queue.take(harness.sessions);
      const turn = yield* Queue.take(harness.started);
      assert.equal(turn.appThread.projectId, gripper);
      assert.include(turn.message.text, "Chief Agent");
      assert.deepStrictEqual(missingTools(turn.message.text), []);
      assert.include(turn.message.text, `Delegated task ${delegation.id}`);
      assert.include(turn.message.text, "样机能抓起 500g");
      // The runtime's run, acting through the PA, is the one open when the session starts.
      assert.include(atSession.onBehalfOf, seeded.pa);
      const ref = { workspaceId: seeded.workspaceId, delegationId: delegation.id };
      assert.equal((yield* delegations.get(ref)).state, "WORKING");
      yield* harness.complete(turn, 1);
      yield* Fiber.join(runner);
      const run = yield* Queue.take(harness.finished);
      assert.deepStrictEqual(run.onBehalfOf, [seeded.member, seeded.pa]);
      const report = yield* wakes.take;
      assert.equal(report.wake.agentId, seeded.pa);
      assert.deepStrictEqual(report.payloads, [{ kind: "report", delegationId: delegation.id }]);
      const failed = yield* delegations.get(ref);
      assert.equal(failed.state, "FAILED");
      assert.equal(failed.report?.blockedOn, "没有汇报");
    }),
  ),
);

it.effect.each([
  { who: "Chief", agent: "chief" },
  { who: "delegating PA", agent: "pa" },
] as const)(
  "a Chief wake whose $who is stopped starts no run and fails its delegation (D48)",
  ({ agent }) =>
    withHarness({ mcp: true }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const db = yield* TelescopeDb.TelescopeDb;
        const delegations = yield* DelegationService.DelegationService;
        const wakes = yield* WakeQueueService.WakeQueueService;
        yield* db.insert(seeded.workspaceId, "kill_switches", {
          agent_id: seeded[agent],
          state: "stopped",
          by_subject_id: seeded.member,
          at: "2026-11-07T00:00:00.000Z",
        });
        const delegation = yield* delegations.delegate(seeded.actor, {
          toAgentId: seeded.chief,
          brief,
        });
        const runner = yield* runWake(yield* wakes.take);
        const outcome = yield* Effect.raceFirst(
          Fiber.await(runner).pipe(Effect.as("ended without a turn")),
          Queue.take(harness.started).pipe(Effect.as("started a turn")),
        );
        assert.equal(outcome, "ended without a turn");
        const failed = yield* delegations.get({
          workspaceId: seeded.workspaceId,
          delegationId: delegation.id,
        });
        assert.equal(failed.state, "FAILED");
        assert.equal(failed.report?.blockedOn, "agent stopped");
        assert.equal(yield* db.count(seeded.workspaceId, "runs"), 0);
        assert.isUndefined(yield* residentOf(seeded, seeded.chief));
        assert.equal((yield* wakes.take).wake.agentId, seeded.pa);
      }),
    ),
);

it.effect(
  "a provider without Codi MCP refuses to host a resident thread and fails the delegation",
  () =>
    withHarness({ mcp: false }, () =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const db = yield* TelescopeDb.TelescopeDb;
        const delegations = yield* DelegationService.DelegationService;
        const wakes = yield* WakeQueueService.WakeQueueService;
        const delegation = yield* delegations.delegate(seeded.actor, {
          toAgentId: seeded.chief,
          brief,
        });
        const exit = yield* Fiber.await(yield* runWake(yield* wakes.take));
        assert.isTrue(Exit.isFailure(exit));
        assert.include(String(Exit.isFailure(exit) && exit.cause), "cannot use Codi's tools");
        const failed = yield* delegations.get({
          workspaceId: seeded.workspaceId,
          delegationId: delegation.id,
        });
        assert.equal(failed.state, "FAILED");
        assert.include(failed.report?.blockedOn, "cannot use Codi's tools");
        assert.equal(yield* db.count(seeded.workspaceId, "runs"), 0);
      }),
    ),
);

it.effect.each([
  { step: "started", rejected: { rejectStart: true }, error: "Only a submitted delegation starts" },
  { step: "created", rejected: { rejectCreate: true }, error: "is disabled for project" },
  { step: "sent", rejected: { rejectSend: true }, error: "is disabled for project" },
] as const)(
  "a turn whose task or thread cannot be $step finishes its run as failed and fails the delegation (D81)",
  ({ rejected, error }) =>
    withHarness({ mcp: true, ...rejected }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const db = yield* TelescopeDb.TelescopeDb;
        const delegations = yield* DelegationService.DelegationService;
        const wakes = yield* WakeQueueService.WakeQueueService;
        const delegation = yield* delegations.delegate(seeded.actor, {
          toAgentId: seeded.chief,
          brief,
        });
        const exit = yield* Fiber.await(yield* runWake(yield* wakes.take));
        assert.isTrue(Exit.isFailure(exit));
        const threadId = (yield* residentOf(seeded, seeded.chief))!;
        assert.deepStrictEqual(yield* db.openRunsOnThread(threadId), []);
        const finished = yield* Queue.takeAll(harness.finished);
        assert.lengthOf(finished, 1);
        assert.equal(finished[0]?.threadId, threadId);
        assert.isDefined(finished[0]?.finishedAt);
        assert.include(finished[0]?.outputSummary, error);
        const failed = yield* delegations.get({
          workspaceId: seeded.workspaceId,
          delegationId: delegation.id,
        });
        assert.equal(failed.state, "FAILED");
        assert.include(failed.report?.blockedOn, error);
        assert.equal((yield* wakes.take).wake.agentId, seeded.pa);
      }),
    ),
);

it.effect(
  "a wake for a revoked member starts nothing; once restored a wake starts a new thread, which a later refusal keeps",
  () =>
    withHarness({ mcp: true }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const db = yield* TelescopeDb.TelescopeDb;
        const delegations = yield* DelegationService.DelegationService;
        const wakes = yield* WakeQueueService.WakeQueueService;
        const revoked = (at: string | null) =>
          db.update(
            seeded.workspaceId,
            "members",
            { revoked_at: at },
            { subject_id: seeded.member },
          );
        const delegation = yield* delegations.delegate(seeded.actor, {
          toAgentId: seeded.chief,
          brief,
        });
        yield* revoked("2026-11-07T00:00:00.000Z");
        const exit = yield* Fiber.await(yield* runWake(yield* wakes.take));
        assert.isTrue(Exit.isFailure(exit));
        const failed = yield* delegations.get({
          workspaceId: seeded.workspaceId,
          delegationId: delegation.id,
        });
        assert.equal(failed.state, "FAILED");
        assert.equal(failed.report?.blockedOn, "Runs act only for active members.");
        assert.equal(yield* db.count(seeded.workspaceId, "runs"), 0);
        assert.isUndefined(yield* residentOf(seeded, seeded.chief));
        assert.equal((yield* wakes.take).wake.agentId, seeded.pa);
        yield* revoked(null);
        yield* delegations.delegate(seeded.actor, { toAgentId: seeded.chief, brief });
        const runner = yield* runWake(yield* wakes.take);
        const turn = yield* Queue.take(harness.started);
        assert.equal(turn.threadId, yield* residentOf(seeded, seeded.chief));
        assert.include(turn.message.text, "Chief Agent");
        yield* harness.complete(turn, 1);
        yield* Fiber.join(runner);
        yield* Queue.take(harness.finished);
        // A refusal on a reused thread keeps it resident. The PA's report wakes wait behind
        // the one taken above, so the next take is the Chief's.
        const later = yield* delegations.delegate(seeded.actor, { toAgentId: seeded.chief, brief });
        yield* revoked("2026-11-07T01:00:00.000Z");
        assert.isTrue(Exit.isFailure(yield* Fiber.await(yield* runWake(yield* wakes.take))));
        const refused = yield* delegations.get({
          workspaceId: seeded.workspaceId,
          delegationId: later.id,
        });
        assert.equal(refused.report?.blockedOn, "Runs act only for active members.");
        assert.equal(yield* residentOf(seeded, seeded.chief), turn.threadId);
      }),
    ),
);

const chiefActor = (seeded: Seeded, runId: Telescope.AgentRunId): DelegationService.Actor => ({
  workspaceId: seeded.workspaceId,
  memberId: seeded.member,
  agentId: seeded.chief,
  onBehalfOf: [seeded.member, seeded.pa],
  runId,
});

it.effect(
  "a lagging listener finishes each delegation's run with its own turn and fails only the unreported delegation",
  () =>
    withHarness({ mcp: true, holdTokens: true }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const delegations = yield* DelegationService.DelegationService;
        const wakes = yield* WakeQueueService.WakeQueueService;
        const ref = (delegation: Telescope.Delegation) => ({
          workspaceId: seeded.workspaceId,
          delegationId: delegation.id,
        });
        const d1 = yield* delegations.delegate(seeded.actor, { toAgentId: seeded.chief, brief });
        // A later wake, so the queue takes d1's first.
        yield* TestClock.adjust("1 millis");
        const d2 = yield* delegations.delegate(seeded.actor, { toAgentId: seeded.chief, brief });
        const first = yield* runWake(yield* wakes.take);
        yield* harness.complete(yield* Queue.take(harness.started), 11);
        // The listener holds turn 1's tokens while wake 2 starts turn 2 on the same thread.
        yield* Queue.take(harness.recorded);
        yield* Fiber.join(first);
        const second = yield* runWake(yield* wakes.take);
        const turn2 = yield* Queue.take(harness.started);
        yield* Queue.offer(harness.permits, undefined);
        const run1 = yield* Queue.take(harness.finished);
        assert.equal(run1.tokens.input, 11);
        const report = yield* wakes.take;
        assert.deepStrictEqual(report.payloads, [{ kind: "report", delegationId: d1.id }]);
        assert.equal((yield* delegations.get(ref(d1))).report?.blockedOn, "没有汇报");
        assert.equal((yield* delegations.get(ref(d2))).state, "WORKING");
        const [run2] = yield* (yield* TelescopeDb.TelescopeDb).openRunsOnThread(turn2.threadId);
        yield* delegations.report(chiefActor(seeded, run2!.runId), {
          delegationId: d2.id,
          state: "COMPLETED",
          report: { result: "样机能抓起 500g", decisions: [] },
        });
        yield* harness.complete(turn2, 55);
        yield* Queue.take(harness.recorded);
        yield* Queue.offer(harness.permits, undefined);
        yield* Fiber.join(second);
        const finished2 = yield* Queue.take(harness.finished);
        assert.equal(finished2.id, run2!.runId);
        assert.equal(finished2.tokens.input, 55);
        assert.equal((yield* delegations.get(ref(d2))).state, "COMPLETED");
      }),
    ),
);

/** Leaves the Chief's next wake waiting for a turn the member typed into its resident thread. */
const waitBehindMemberTurn = (harness: Harness, seeded: Seeded) =>
  Effect.gen(function* () {
    const delegations = yield* DelegationService.DelegationService;
    const wakes = yield* WakeQueueService.WakeQueueService;
    yield* delegations.delegate(seeded.actor, { toAgentId: seeded.chief, brief });
    const first = yield* runWake(yield* wakes.take);
    yield* harness.complete(yield* Queue.take(harness.started), 1);
    yield* Fiber.join(first);
    yield* Queue.take(harness.finished);
    // The unreported first task's report wake, for the PA.
    yield* wakes.take;
    const threadId = (yield* residentOf(seeded, seeded.chief))!;
    yield* memberTypes(threadId, "先看看电机");
    const memberTurn = yield* Queue.take(harness.started);
    const delegation = yield* delegations.delegate(seeded.actor, {
      toAgentId: seeded.chief,
      brief,
    });
    const waiting = yield* runWake(yield* wakes.take);
    yield* Queue.take(harness.waits);
    const release = harness
      .complete(memberTurn, 1)
      .pipe(
        Effect.andThen(Queue.take(harness.finished)),
        Effect.andThen(
          Effect.raceFirst(
            Fiber.await(waiting).pipe(Effect.as("ended without a turn")),
            Queue.take(harness.started).pipe(Effect.as("started a turn")),
          ),
        ),
      );
    return { delegation, release };
  });

it.effect("a wake whose agent is stopped while it waits for the thread starts no run (D48)", () =>
  withHarness({ mcp: true }, (harness) =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const db = yield* TelescopeDb.TelescopeDb;
      const delegations = yield* DelegationService.DelegationService;
      const { delegation, release } = yield* waitBehindMemberTurn(harness, seeded);
      yield* db.insert(seeded.workspaceId, "kill_switches", {
        agent_id: seeded.chief,
        state: "stopped",
        by_subject_id: seeded.member,
        at: "2026-11-07T00:00:00.000Z",
      });
      assert.equal(yield* release, "ended without a turn");
      const failed = yield* delegations.get({
        workspaceId: seeded.workspaceId,
        delegationId: delegation.id,
      });
      assert.equal(failed.report?.blockedOn, "agent stopped");
      assert.equal(yield* db.count(seeded.workspaceId, "runs"), 2);
    }),
  ),
);

it.effect("a wake whose delegation is cancelled while it waits for the thread starts no run", () =>
  withHarness({ mcp: true }, (harness) =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const db = yield* TelescopeDb.TelescopeDb;
      const delegations = yield* DelegationService.DelegationService;
      const { delegation, release } = yield* waitBehindMemberTurn(harness, seeded);
      yield* delegations.cancel(seeded.actor, delegation.id);
      assert.equal(yield* release, "ended without a turn");
      const ref = { workspaceId: seeded.workspaceId, delegationId: delegation.id };
      assert.equal((yield* delegations.get(ref)).state, "CANCELED");
      assert.equal(yield* db.count(seeded.workspaceId, "runs"), 2);
    }),
  ),
);

it.effect(
  "a message the member queues behind the agent's turn gets its own run when it starts",
  () =>
    withHarness({ mcp: true, holdTokens: true }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const db = yield* TelescopeDb.TelescopeDb;
        const runner = yield* runWake(yield* messageWake(seeded, "早"));
        const turn = yield* Queue.take(harness.started);
        yield* memberTypes(turn.threadId, "顺便看看预算", true);
        yield* harness.complete(turn, 1);
        yield* Queue.take(harness.recorded);
        yield* Queue.offer(harness.permits, undefined);
        yield* Fiber.join(runner);
        const agentRun = yield* Queue.take(harness.finished);
        const memberTurn = yield* Queue.take(harness.started);
        assert.include(memberTurn.message.text, "顺便看看预算");
        yield* harness.complete(memberTurn, 7);
        // The listener has seen the member's run start and holds its turn's tokens.
        yield* Queue.take(harness.recorded);
        const open = yield* db.openRunsOnThread(turn.threadId);
        assert.lengthOf(open, 1);
        const [toolRun] = yield* db.latestRunForThread(turn.threadId, decodeRuns);
        assert.equal(toolRun?.run_id, open[0]?.runId);
        assert.notEqual(toolRun?.run_id, agentRun.id);
        yield* Queue.offer(harness.permits, undefined);
        const memberRun = yield* Queue.take(harness.finished);
        assert.equal(memberRun.id, open[0]?.runId);
        assert.deepStrictEqual(memberRun.onBehalfOf, [seeded.member]);
        assert.equal(memberRun.tokens.input, 7);
      }),
    ),
);

it.effect(
  "openThread gives the owner a resident thread with no turn, and the first wake on it still carries the role text",
  () =>
    withHarness({ mcp: true }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const runtime = yield* AgentRuntime.AgentRuntime;
        const ref = { workspaceId: seeded.workspaceId, agentId: seeded.pa };
        const { threadId } = yield* runtime.openThread(alice, ref);
        assert.equal(yield* residentOf(seeded, seeded.pa), threadId);
        const shell =
          yield* (yield* ThreadManagementService.ThreadManagementService).getThreadShell(threadId);
        assert.equal(shell?.projectId, scratch);
        assert.isNull(shell?.latestRunId);
        assert.deepStrictEqual(yield* runtime.openThread(alice, ref), { threadId });
        const runner = yield* runWake(yield* messageWake(seeded, "早"));
        const turn = yield* Queue.take(harness.started);
        assert.equal(turn.threadId, threadId);
        assert.include(turn.message.text, "personal assistant");
        yield* harness.complete(turn, 1);
        yield* Fiber.join(runner);
      }),
    ),
);

it.effect("openThread refuses an agent another member owns and creates no thread", () =>
  withHarness({ mcp: true }, () =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const db = yield* TelescopeDb.TelescopeDb;
      yield* db.update(
        seeded.workspaceId,
        "agents",
        { owner_subject_id: "someone-else" },
        { agent_id: seeded.chief },
      );
      const error = yield* Effect.flip(
        (yield* AgentRuntime.AgentRuntime).openThread(alice, {
          workspaceId: seeded.workspaceId,
          agentId: seeded.chief,
        }),
      );
      assert.equal(error._tag, "TelescopeWorkspaceError");
      assert.equal(error._tag === "TelescopeWorkspaceError" && error.reason, "not_found");
      assert.isUndefined(yield* residentOf(seeded, seeded.chief));
    }),
  ),
);

it.effect.each([
  { provider: "Replay (dev)", instance: "devReplay", opens: true },
  { provider: "another provider without Codi MCP", instance: "codex", opens: false },
] as const)(
  "openThread on $provider: opens a resident thread is $opens (D87)",
  ({ instance, opens }) =>
    withHarness({ mcp: false }, () =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const model = { instanceId: ProviderInstanceId.make(instance), model: "showcase" };
        yield* (yield* TelescopeDb.TelescopeDb).update(
          seeded.workspaceId,
          "agents",
          { model_selection_json: JSON.stringify(model) },
          { agent_id: seeded.pa },
        );
        const opened = yield* Effect.exit(
          (yield* AgentRuntime.AgentRuntime).openThread(alice, {
            workspaceId: seeded.workspaceId,
            agentId: seeded.pa,
          }),
        );
        assert.equal(Exit.isSuccess(opened), opens);
        assert.equal((yield* residentOf(seeded, seeded.pa)) !== undefined, opens);
      }),
    ),
);

it.effect(
  "two openThread calls racing for one agent create exactly one resident thread (D88)",
  () =>
    withHarness({ mcp: true, holdScratch: true }, (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const runtime = yield* AgentRuntime.AgentRuntime;
        const ref = { workspaceId: seeded.workspaceId, agentId: seeded.pa };
        const first = yield* Effect.forkScoped(runtime.openThread(alice, ref));
        const second = yield* Effect.forkScoped(runtime.openThread(alice, ref));
        // Both have read the agent with no resident thread before either writes one.
        yield* Queue.take(harness.atScratch);
        yield* Queue.take(harness.atScratch);
        yield* Deferred.succeed(harness.scratchGate, undefined);
        const one = yield* Fiber.join(first);
        const two = yield* Fiber.join(second);
        assert.equal(one.threadId, two.threadId);
        assert.equal(yield* residentOf(seeded, seeded.pa), one.threadId);
        const shell =
          yield* (yield* ThreadManagementService.ThreadManagementService).getThreadShell(
            one.threadId,
          );
        assert.equal(shell?.projectId, scratch);
      }),
    ),
);
