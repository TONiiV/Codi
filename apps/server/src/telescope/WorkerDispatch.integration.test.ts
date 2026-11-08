import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  CommandId,
  EnvironmentId,
  MessageId,
  type OrchestrationV2Run,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import type { Tool } from "effect/ai";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { MemoryToolkit } from "../mcp/toolkits/memory/tools.ts";
import * as TelescopeHandlers from "../mcp/toolkits/telescope/handlers.ts";
import { TelescopeToolkit } from "../mcp/toolkits/telescope/tools.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderRuntimeRecoveryService from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AgentInstructions from "./AgentInstructions.ts";
import * as AgentRuntime from "./AgentRuntime.ts";
import * as AgentService from "./AgentService.ts";
import * as AgentThreadRuns from "./AgentThreadRuns.ts";
import * as BoardChanges from "./BoardChanges.ts";
import * as DelegationAnswers from "./DelegationAnswers.ts";
import * as DelegationService from "./DelegationService.ts";
import * as GrantService from "./GrantService.ts";
import * as MemoryService from "./MemoryService.ts";
import * as RoutingService from "./RoutingService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as ThreadTurnTokens from "./ThreadTurnTokens.ts";
import * as ToolGateway from "./ToolGateway.ts";
import * as WakeQueueService from "./WakeQueueService.ts";
import * as WorkerDispatch from "./WorkerDispatch.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const selection = { instanceId, model: "test-model" };
const scratch = ProjectId.make("project:scratch");
const gripper = ProjectId.make("project:gripper");
const environmentId = EnvironmentId.make("env-telescope");
const alice: WorkspaceService.Caller = {
  sessionId: AuthSessionId.make("session-alice"),
  subject: "one-time-token",
};
const brief = {
  goal: "修好夹爪固件的超时 bug",
  constraints: ["不改硬件接口"],
  acceptance: ["回归测试通过"],
  goalChain: ["夹爪项目"],
};
const ALL = { openTickets: true, dispatchWorkers: true, answerMembers: true, mergePRs: true };
const agentTools = { ...TelescopeToolkit.tools, ...MemoryToolkit.tools };
const missingTools = (text: string) =>
  [...text.matchAll(/`(\w+)`|\b([a-z]+(?:_[a-z]+)+)\b/g)].flatMap(([, quoted, bare]) => {
    const name = quoted ?? bare;
    return name === undefined || name in agentTools ? [] : [name];
  });
const decodeRuns = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ run_id: Telescope.AgentRunId, on_behalf_of_json: Schema.String })),
);
const byAgentDefault: Telescope.RoutingResolution = {
  source: "agent_default",
  modelSelection: selection,
  skipped: [],
};

/**
 * A provider whose session start records the thread's open Telescope run, as tools/list would.
 * Without `listening`, no run listener sees Codi runs end, as while the server is down.
 */
const makeHarness = Effect.fn("makeHarness")(function* (listening: boolean) {
  const cwd = yield* checkpointWorkspace("telescope-worker-dispatch");
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const sessions = yield* Queue.unbounded<{
    readonly threadId: ThreadId;
    readonly onBehalfOf?: string;
  }>();
  const started = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2TurnInput>();
  // When set, the next turn start runs this, then fails before the provider takes the prompt.
  const failNextStart = yield* Ref.make<Effect.Effect<void> | undefined>(undefined);
  const finished = yield* Queue.unbounded<Telescope.AgentRun>();
  const route = yield* Ref.make(byAgentDefault);
  // Runs after each delegation start and run finish, and before each thread create and send.
  type Step = "started" | "finished" | "create" | "send";
  const hook = yield* Ref.make<(step: Step) => Effect.Effect<void>>(() => Effect.void);
  const runHook = (step: Step) => Effect.flatMap(Ref.get(hook), (run) => run(step));
  // Thread creates, sends and interrupt results, in order.
  const log = yield* Ref.make<ReadonlyArray<string>>([]);
  const record = (entry: string, threadId: ThreadId) =>
    Ref.update(log, (calls) => [...calls, `${entry}:${threadId}`]);
  const db = yield* Deferred.make<TelescopeDb.TelescopeDb["Service"]>();
  const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
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
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          // Called for each thread before its first turn, whether or not a session is reused.
          ensureThread: ({ threadId }) =>
            Effect.gen(function* () {
              const [run] = yield* (yield* Deferred.await(db))
                .latestRunForThread(threadId, decodeRuns)
                .pipe(Effect.orDie);
              yield* Queue.offer(sessions, {
                threadId,
                ...(run && { onBehalfOf: run.on_behalf_of_json }),
              });
            }).pipe(
              Effect.as({
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
            ),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (turn) =>
            Effect.flatMap(Ref.getAndSet(failNextStart, undefined), (before) =>
              before === undefined
                ? Queue.offer(started, turn).pipe(Effect.asVoid)
                : before.pipe(
                    Effect.andThen(
                      Effect.fail(
                        new ProviderAdapter.ProviderAdapterTurnStartError({
                          driver,
                          threadId: turn.threadId,
                          providerThreadId: turn.providerThread.id,
                          runId: turn.runId,
                          cause: new Error("timed out before taking the prompt"),
                        }),
                      ),
                    ),
                  ),
            ),
          compactThread: () => Effect.die("unused"),
          steerTurn: () => Effect.die("unused"),
          interruptTurn: () => Effect.void,
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
  };
  const providerTurn = (
    turn: ProviderAdapter.ProviderAdapterV2TurnInput,
    status: "running" | "completed",
  ) =>
    Effect.map(DateTime.now, (now) => ({
      type: "provider_turn.updated" as const,
      driver,
      providerTurn: {
        id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
        providerThreadId: turn.providerThread.id,
        nodeId: turn.rootNodeId,
        runAttemptId: turn.attemptId,
        nativeTurnRef: {
          driver,
          nativeId: `native:${turn.attemptId}`,
          strength: "strong" as const,
        },
        ordinal: turn.providerTurnOrdinal,
        status,
        startedAt: now,
        completedAt: status === "running" ? null : now,
      },
    }));
  /** The provider reports the turn under way, which a restart needs to resume it. */
  const running = (turn: ProviderAdapter.ProviderAdapterV2TurnInput) =>
    Effect.gen(function* () {
      const engine = yield* Orchestrator.OrchestratorV2;
      const afterSequence = yield* engine.getThreadEventSequence(turn.threadId);
      yield* Queue.offer(events, yield* providerTurn(turn, "running"));
      yield* engine
        .streamStoredEventsFrom({
          threadId: turn.threadId,
          afterSequence,
          eventType: "provider-turn.updated",
        })
        .pipe(
          Stream.filter(
            ({ event }) =>
              event.type === "provider-turn.updated" && event.payload.status === "running",
          ),
          Stream.runHead,
        );
    });
  const complete = (turn: ProviderAdapter.ProviderAdapterV2TurnInput) =>
    Effect.gen(function* () {
      const update = yield* providerTurn(turn, "completed");
      const id = update.providerTurn.id;
      yield* Queue.offer(events, update);
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
    GrantService.layer,
    TaskBoardService.layer,
    ToolGateway.layer,
    BoardChanges.layer,
  ).pipe(
    Layer.provideMerge(RunRecordService.layer),
    Layer.provideMerge(ProjectStore.layer),
    Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
    Layer.provide(
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(environmentId),
      }),
    ),
  );
  const orchestration = ThreadManagementService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ProjectionStore.layer.pipe(Layer.provide(database)),
        EventStore.layer.pipe(Layer.provide(database)),
        EffectOutbox.layer.pipe(Layer.provide(database)),
        ProviderReplayHarness.layerWithRegistry({ name: "telescope-worker-dispatch" }, registry, {
          databaseLayer: database,
          runEffectWorker: false,
        }),
      ),
    ),
    Layer.provideMerge(ServerSettings.layerTest({ defaultModelSelection: selection })),
    Layer.provideMerge(CommandReceiptStore.layer.pipe(Layer.provide(database))),
  );
  const recordingRuns = Layer.effect(
    RunRecordService.RunRecordService,
    Effect.map(RunRecordService.RunRecordService, (runs) => ({
      ...runs,
      finish: (ref, input) =>
        runs.finish(ref, input).pipe(
          Effect.tap((run) => Queue.offer(finished, run)),
          Effect.tap(runHook("finished")),
        ),
    })),
  );
  const threads = Layer.effect(
    ThreadManagementService.ThreadManagementService,
    Effect.map(ThreadManagementService.ThreadManagementService, (service) => ({
      ...service,
      dispatch: (command) =>
        (command.type === "thread.create"
          ? runHook("create").pipe(Effect.andThen(record("create", command.threadId)))
          : Effect.void
        ).pipe(Effect.andThen(service.dispatch(command))),
      sendToThread: (input) =>
        runHook("send").pipe(
          Effect.andThen(record("send", input.threadId)),
          Effect.andThen(service.sendToThread(input)),
        ),
      interruptThread: (input) =>
        service
          .interruptThread(input)
          .pipe(Effect.tap((result) => record(result.type, input.threadId))),
    })),
  );
  const routing = Layer.mock(RoutingService.RoutingService)({ resolve: () => Ref.get(route) });
  const hookedDelegations = Layer.effect(
    DelegationService.DelegationService,
    Effect.map(DelegationService.DelegationService, (delegations) => ({
      ...delegations,
      start: (ref) => delegations.start(ref).pipe(Effect.tap(runHook("started"))),
    })),
  );
  const services = Layer.mergeAll(recordingRuns, threads, hookedDelegations);
  const runtime = Layer.mergeAll(
    AgentRuntime.layerWakeRunner,
    listening ? ThreadTurnTokens.layer : Layer.empty,
    McpToolAccess.HandlersLayer.layer(TelescopeHandlers.layer),
  ).pipe(
    Layer.provideMerge(AgentRuntime.layer),
    Layer.provideMerge(WorkerDispatch.layer.pipe(Layer.provide(routing))),
    Layer.provideMerge(services),
    Layer.provide(registry),
    Layer.provide(
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/home/user/projects",
        ensureScratchProject: Effect.succeed({ projectId: scratch }),
      }),
    ),
    Layer.provideMerge(Layer.merge(telescope, orchestration)),
  );
  // The effect worker runs as a server's does; a restart stops it with the server.
  const worker = yield* Ref.make<Fiber.Fiber<void> | undefined>(undefined);
  const startWorker = Effect.flatMap(Effect.forkScoped(EffectWorker.runDaemon), (fiber) =>
    Ref.set(worker, fiber),
  );
  const stopWorker = Effect.flatMap(Ref.getAndSet(worker, undefined), (fiber) =>
    fiber === undefined ? Effect.void : Fiber.interrupt(fiber),
  );
  return {
    runtime,
    db,
    sessions,
    started,
    failNextStart,
    finished,
    route,
    hook,
    log,
    running,
    complete,
    startWorker,
    stopWorker,
  };
});
type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

const withHarness = <A, E>(
  body: (harness: Harness) => Effect.Effect<A, E, Layer.Success<Harness["runtime"]> | Scope.Scope>,
  listening = true,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness(listening);
      return yield* Effect.gen(function* () {
        yield* Deferred.succeed(harness.db, yield* TelescopeDb.TelescopeDb);
        yield* harness.startWorker;
        return yield* body(harness);
      }).pipe(Effect.provide(harness.runtime));
    }),
  );

/** Alice's assistant and her Chief Agent of the bound gripper project, with every power. */
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
  yield* db.insert(workspace.id, "project_bindings", {
    environment_id: environmentId,
    project_id: gripper,
  });
  yield* db.insert(workspace.id, "agents", {
    agent_id: chief,
    owner_subject_id: workspace.createdBy,
    kind: "chief_agent",
    project_id: gripper,
    name: "Gripper Chief Agent",
    standing_powers_json: JSON.stringify(ALL),
    exposure: "hidden",
    sync_with_board: 1,
    dispatch_mode: "inbox",
    channels_json: "[]",
    created_at: pa.createdAt,
    updated_at: pa.createdAt,
  });
  const powers = { model_selection_json: JSON.stringify(selection) };
  yield* db.update(workspace.id, "agents", powers, { agent_id: chief });
  yield* db.update(
    workspace.id,
    "agents",
    { ...powers, standing_powers_json: JSON.stringify(ALL) },
    { agent_id: pa.id },
  );
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

/** Runs the wake as the queue's worker does, which finishes it in the queue when it ends. */
const runWake = (wake: WakeQueueService.WakeRun) =>
  Effect.gen(function* () {
    const run = yield* WakeQueueService.WakeRunner;
    const wakes = yield* WakeQueueService.WakeQueueService;
    return yield* Effect.forkScoped(
      run(wake).pipe(Effect.ensuring(Effect.orDie(wakes.finish(wake.wake, "done")))),
    );
  });

/** Each queued wake's agent and payload; a FAILED Worker hop also reports up to its Chief. */
const queued = (seeded: Seeded) =>
  Effect.flatMap(WakeQueueService.WakeQueueService, (wakes) =>
    wakes.list(alice, { workspaceId: seeded.workspaceId }),
  ).pipe(
    Effect.map(({ wakes }) =>
      wakes.flatMap((wake) => (wake.status === "queued" ? [[wake.agentId, wake.payload]] : [])),
    ),
  );

type Tools = (typeof TelescopeToolkit)["tools"];
/** Calls a Telescope tool in-process as the agent on `threadId`, as `/mcp` would. */
const callOn =
  (threadId: ThreadId) =>
  <Name extends keyof Tools & string>(name: Name, params: Tool.Parameters<Tools[Name]>) =>
    Effect.flatMap(TelescopeToolkit, (toolkit) => toolkit.handle(name, params)).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((out) => out.at(-1)?.result),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId,
        requestNamespace: `provider:${threadId}`,
        thread: {
          threadId,
          providerSessionId: `provider:${threadId}`,
          providerInstanceId: instanceId,
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
    );

/** The PA delegates; the Chief's wake starts its turn, in which it may call its tools. */
const chiefWorking = (harness: Harness, seeded: Seeded) =>
  Effect.gen(function* () {
    const delegations = yield* DelegationService.DelegationService;
    const wakes = yield* WakeQueueService.WakeQueueService;
    const delegation = yield* delegations.delegate(seeded.actor, {
      toAgentId: seeded.chief,
      brief,
    });
    const runner = yield* runWake(yield* wakes.take);
    yield* Queue.take(harness.sessions);
    const turn = yield* Queue.take(harness.started);
    return { delegation, runner, turn, call: callOn(turn.threadId) };
  });
type Opened = { readonly delegationId: Telescope.DelegationId; readonly threadId: ThreadId };

/**
 * A server restart in startup's order: open runs read as the layer builds, recovery, the listener.
 * The effect worker stays stopped until the test starts it. With `stopping` the listener sees the
 * runs Codi cuts, as while a server stops; with `gate` it handles nothing until the gate opens.
 */
const restart = (
  harness: Harness,
  {
    continueThreadsAfterServerUpdate = true,
    stopping = false,
    gate,
  }: {
    readonly continueThreadsAfterServerUpdate?: boolean;
    readonly stopping?: boolean;
    readonly gate?: Deferred.Deferred<void>;
  } = {},
) =>
  Effect.gen(function* () {
    yield* harness.stopWorker;
    const handler = yield* AgentThreadRuns.makeHandler;
    // From a sequence read now, so the listener sees every later event however late it starts.
    const sink = yield* EventSink.EventSinkV2;
    const handled = yield* SubscriptionRef.make(0);
    const listen = Effect.flatMap(sink.latestSequence(), (afterSequence) =>
      SubscriptionRef.set(handled, afterSequence).pipe(
        Effect.andThen(gate === undefined ? Effect.void : Deferred.await(gate)),
        Effect.andThen(
          Stream.runForEach(sink.stream({ afterSequence }), ({ event, sequence }) =>
            handler.handle(event).pipe(Effect.andThen(SubscriptionRef.set(handled, sequence))),
          ),
        ),
        Effect.forkScoped,
      ),
    );
    if (stopping) yield* listen;
    yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService.use(
      (recovery) => recovery.recover,
    ).pipe(
      Effect.provide(
        ProviderRuntimeRecoveryService.layer.pipe(
          Layer.provide(
            Layer.merge(
              IdAllocator.layer,
              ServerSettings.layerTest({ continueThreadsAfterServerUpdate }),
            ),
          ),
        ),
      ),
    );
    if (!stopping) yield* listen;
    return {
      ...handler,
      /** Waits until the listener has handled every event stored so far. */
      caughtUp: Effect.flatMap(sink.latestSequence(), (latest) =>
        SubscriptionRef.changes(handled).pipe(
          Stream.filter((sequence) => sequence >= latest),
          Stream.runHead,
        ),
      ),
    };
  });

/** The first update to a Codi run on the thread, after the sequence, that matches. */
const runUpdated = (
  threadId: ThreadId,
  afterSequence: number,
  matches: (run: OrchestrationV2Run) => boolean,
) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (engine) =>
    engine.streamStoredEventsFrom({ threadId, afterSequence, eventType: "run.updated" }).pipe(
      Stream.map(({ event }) => (event.type === "run.updated" ? event.payload : undefined)),
      Stream.filter((run): run is OrchestrationV2Run => run !== undefined && matches(run)),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    ),
  );

/**
 * A restart cuts the Chief's turn, and the turn Codi resumes fails before the provider takes its
 * prompt while a member message waits behind it. Returns once Codi has held that message, which
 * it does after it writes the retry it owes the failed continuation, due in 60 s.
 */
const resumedTurnFailsToStart = (
  harness: Harness,
  seeded: Seeded,
  gate?: Deferred.Deferred<void>,
) =>
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const { delegation, runner, turn } = yield* chiefWorking(harness, seeded);
    yield* harness.running(turn);
    yield* Fiber.interrupt(runner);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    yield* Ref.set(
      harness.failNextStart,
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
    );
    const restarted = yield* restart(harness, gate === undefined ? {} : { gate });
    yield* restarted.settleOrphans;
    const afterSequence = yield* engine.getThreadEventSequence(turn.threadId);
    yield* harness.startWorker;
    yield* Deferred.await(entered);
    yield* engine.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("member-waits"),
      threadId: turn.threadId,
      messageId: MessageId.make("member-waits"),
      text: "顺便看看日志",
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* Deferred.succeed(release, undefined);
    const failed = yield* runUpdated(
      turn.threadId,
      afterSequence,
      (run) => run.status === "failed",
    );
    yield* runUpdated(turn.threadId, afterSequence, (run) => run.queueHeld === true);
    return { delegation, turn, failed, restarted };
  });

it.effect(
  "dispatch_worker opens a top-level Worker thread in the Chief's project whose run exists before its session",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const { delegation, call } = yield* chiefWorking(harness, seeded);
        const delegations = yield* DelegationService.DelegationService;
        const db = yield* TelescopeDb.TelescopeDb;
        const runsAtCreate = yield* Ref.make<ReadonlyArray<number>>([]);
        yield* Ref.set(harness.hook, (step) =>
          step === "create"
            ? delegations.listForAgent(seeded.workspaceId, seeded.chief).pipe(
                Effect.flatMap((rows) =>
                  db.openRunsOnThread(rows.find((row) => row.hop === "worker")!.threadId!),
                ),
                Effect.flatMap((open) =>
                  Ref.update(runsAtCreate, (seen) => [...seen, open.length]),
                ),
                Effect.orDie,
              )
            : Effect.void,
        );
        const opened = (yield* call("dispatch_worker", {
          delegationId: delegation.id,
          brief,
        })) as Opened & { readonly link: string };
        assert.deepStrictEqual(yield* Ref.get(runsAtCreate), [1]);
        assert.include(opened.link, opened.threadId);
        const atSession = yield* Queue.take(harness.sessions);
        assert.equal(atSession.threadId, opened.threadId);
        // The Worker acts through the Chief's chain: the member and the PA.
        assert.deepStrictEqual(JSON.parse(atSession.onBehalfOf!), [seeded.member, seeded.pa]);
        const shell =
          yield* (yield* ThreadManagementService.ThreadManagementService).getThreadShell(
            opened.threadId,
          );
        assert.equal(shell?.projectId, gripper);
        assert.isNull(shell?.lineage.parentThreadId);
        const worker = yield* (yield* DelegationService.DelegationService).get({
          workspaceId: seeded.workspaceId,
          delegationId: opened.delegationId,
        });
        assert.deepInclude(worker, {
          hop: "worker",
          parentId: delegation.id,
          threadId: opened.threadId,
          state: "WORKING",
        });
      }),
    ),
);

it.effect("the Worker's first message is the rendered brief and nothing else", () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const { delegation, call } = yield* chiefWorking(harness, seeded);
      yield* call("dispatch_worker", { delegationId: delegation.id, brief });
      yield* Queue.take(harness.sessions);
      const turn = yield* Queue.take(harness.started);
      assert.equal(turn.message.text, AgentInstructions.renderBrief(brief));
      assert.notInclude(turn.message.text, delegation.id);
    }),
  ),
);

it.effect.each([
  { order: "the Chief's turn ends first", workerFirst: false, takeEarly: false },
  { order: "a fast Worker ends first", workerFirst: true, takeEarly: false },
  {
    order: "a fast Worker's wake starts before the Chief's run end is handled",
    workerFirst: true,
    takeEarly: true,
  },
] as const)(
  "a Chief turn that ends after dispatch_worker leaves its task WORKING ($order), the Worker's turn end wakes the Chief once with the task id, and a follow-up turn without a report fails the task and its Worker (D134)",
  ({ workerFirst, takeEarly }) =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const delegations = yield* DelegationService.DelegationService;
        const wakes = yield* WakeQueueService.WakeQueueService;
        const { delegation, runner, turn, call } = yield* chiefWorking(harness, seeded);
        const opened = (yield* call("dispatch_worker", {
          delegationId: delegation.id,
          brief,
        })) as Opened;
        yield* Queue.take(harness.sessions);
        const workerTurn = yield* Queue.take(harness.started);
        const endWorker = Effect.gen(function* () {
          yield* harness.complete(workerTurn);
          assert.equal((yield* Queue.take(harness.finished)).threadId, opened.threadId);
        });
        if (workerFirst) yield* endWorker;
        // The queue's worker may start the settled wake once the Chief's wake is done.
        const early = yield* Deferred.make<WakeQueueService.WakeRun>();
        if (takeEarly)
          yield* Ref.set(harness.hook, (step) =>
            step === "finished"
              ? Ref.set(harness.hook, () => Effect.void).pipe(
                  Effect.andThen(Effect.orDie(wakes.take)),
                  Effect.flatMap((run) => Deferred.succeed(early, run)),
                  Effect.asVoid,
                )
              : Effect.void,
          );
        yield* harness.complete(turn);
        yield* Fiber.join(runner);
        assert.equal((yield* Queue.take(harness.finished)).threadId, turn.threadId);
        const ref = { workspaceId: seeded.workspaceId, delegationId: delegation.id };
        assert.equal((yield* delegations.get(ref)).state, "WORKING");
        if (!workerFirst) {
          assert.isUndefined(yield* wakes.dequeue);
          yield* endWorker;
        }
        const settled = takeEarly ? yield* Deferred.await(early) : yield* wakes.take;
        assert.equal(settled.wake.agentId, seeded.chief);
        assert.deepStrictEqual(settled.payloads, [{ kind: "worker", delegationId: delegation.id }]);
        assert.isUndefined(yield* wakes.dequeue);
        assert.equal((yield* delegations.get(ref)).state, "WORKING");

        const next = yield* runWake(settled);
        const followUp = yield* Queue.take(harness.started);
        assert.equal(followUp.threadId, turn.threadId);
        assert.include(
          followUp.message.text,
          `Your Worker on task ${delegation.id} ended its turn.`,
        );
        assert.deepStrictEqual(missingTools(followUp.message.text), []);
        yield* harness.complete(followUp);
        yield* Fiber.join(next);
        assert.sameDeepMembers(yield* queued(seeded), [
          [seeded.pa, { kind: "report", delegationId: delegation.id }],
          [seeded.chief, { kind: "report", delegationId: opened.delegationId }],
        ]);
        for (const delegationId of [delegation.id, opened.delegationId]) {
          const failed = yield* delegations.get({ workspaceId: seeded.workspaceId, delegationId });
          assert.deepInclude(failed, { state: "FAILED" });
          assert.equal(failed.report?.blockedOn, "没有汇报");
        }
      }),
    ),
);

it.effect(
  "with two Workers on one task, a follow-up turn without a report fails the task only once neither Worker is live (D134)",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const delegations = yield* DelegationService.DelegationService;
        const wakes = yield* WakeQueueService.WakeQueueService;
        const { delegation, runner, turn, call } = yield* chiefWorking(harness, seeded);
        const dispatchOne = Effect.gen(function* () {
          const opened = (yield* call("dispatch_worker", {
            delegationId: delegation.id,
            brief,
          })) as Opened;
          yield* Queue.take(harness.sessions);
          return { opened, turn: yield* Queue.take(harness.started) };
        });
        const first = yield* dispatchOne;
        const second = yield* dispatchOne;
        yield* harness.complete(turn);
        yield* Fiber.join(runner);
        yield* Queue.take(harness.finished);
        /** The `worker` wake's follow-up turn ends with no tool call. */
        const followUp = Effect.gen(function* () {
          const next = yield* runWake(yield* wakes.take);
          yield* harness.complete(yield* Queue.take(harness.started));
          yield* Fiber.join(next);
        });
        const state = (delegationId: Telescope.DelegationId) =>
          delegations
            .get({ workspaceId: seeded.workspaceId, delegationId })
            .pipe(Effect.map((row) => [row.state, row.report?.blockedOn]));

        yield* harness.complete(first.turn);
        assert.equal((yield* Queue.take(harness.finished)).threadId, first.opened.threadId);
        yield* followUp;
        assert.equal((yield* Queue.take(harness.finished)).threadId, turn.threadId);
        // One fiber handles run ends, so the second Worker's run end follows the follow-up's.
        yield* harness.complete(second.turn);
        assert.equal((yield* Queue.take(harness.finished)).threadId, second.opened.threadId);
        assert.deepStrictEqual(yield* state(delegation.id), ["WORKING", undefined]);
        assert.deepStrictEqual(yield* state(first.opened.delegationId), ["WORKING", undefined]);

        yield* followUp;
        assert.sameDeepMembers(yield* queued(seeded), [
          [seeded.pa, { kind: "report", delegationId: delegation.id }],
          [seeded.chief, { kind: "report", delegationId: first.opened.delegationId }],
          [seeded.chief, { kind: "report", delegationId: second.opened.delegationId }],
        ]);
        for (const delegationId of [
          delegation.id,
          first.opened.delegationId,
          second.opened.delegationId,
        ])
          assert.deepStrictEqual(yield* state(delegationId), ["FAILED", "没有汇报"]);
      }),
    ),
);

it.effect.each([
  { worker: "ended its turn", started: true },
  { worker: "never got its thread", started: false },
] as const)(
  "a restart finishes the runs left open while it was down, where the Worker $worker, past a later turn on the Chief's thread, and wakes the Chief once for its task; settling again changes nothing",
  ({ started }) =>
    withHarness(
      (harness) =>
        Effect.gen(function* () {
          const seeded = yield* seed;
          const db = yield* TelescopeDb.TelescopeDb;
          const delegations = yield* DelegationService.DelegationService;
          const { delegation, runner, turn, call } = yield* chiefWorking(harness, seeded);
          // Stopping before the Worker's thread exists leaves its run with no Codi run at all.
          if (!started)
            yield* Ref.set(harness.hook, (step) =>
              step === "create" ? Effect.die("server stopped") : Effect.void,
            );
          yield* Effect.exit(call("dispatch_worker", { delegationId: delegation.id, brief }));
          const worker = (yield* delegations.listForAgent(seeded.workspaceId, seeded.chief)).find(
            (row) => row.hop === "worker",
          )!;
          if (started) {
            yield* Queue.take(harness.sessions);
            yield* harness.complete(yield* Queue.take(harness.started));
            yield* (yield* ThreadManagementService.ThreadManagementService).waitForThread({
              projectId: gripper,
              threadId: worker.threadId!,
              timeoutMs: 60_000,
            });
          }
          yield* harness.complete(turn);
          yield* Fiber.join(runner);
          yield* (yield* Orchestrator.OrchestratorV2).dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("member-asks"),
            threadId: turn.threadId,
            messageId: MessageId.make("member-asks"),
            text: "进度如何？",
            attachments: [],
            dispatchMode: { type: "start_immediately" },
            createdBy: "user",
            creationSource: "web",
          });
          yield* Queue.take(harness.started);

          const restarted = yield* AgentThreadRuns.makeHandler;
          yield* restarted.settleOrphans;
          const ended = yield* Queue.clear(harness.finished);
          assert.sameMembers(
            ended.map((run) => run.threadId),
            [turn.threadId, worker.threadId],
          );
          const chiefWake = [[seeded.chief, { kind: "worker", delegationId: delegation.id }]];
          assert.deepStrictEqual(yield* queued(seeded), chiefWake);
          for (const delegationId of [delegation.id, worker.id]) {
            const ref = { workspaceId: seeded.workspaceId, delegationId };
            assert.equal((yield* delegations.get(ref)).state, "WORKING");
          }
          const wakeRows = yield* db.count(seeded.workspaceId, "wakes");

          yield* restarted.settleOrphans;
          assert.strictEqual(yield* Queue.size(harness.finished), 0);
          assert.strictEqual(yield* db.count(seeded.workspaceId, "wakes"), wakeRows);
          assert.deepStrictEqual(yield* queued(seeded), chiefWake);
        }),
      false,
    ),
);

it.effect("the startup pass leaves a run opened after it read the open runs", () =>
  withHarness(
    (harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const db = yield* TelescopeDb.TelescopeDb;
        const delegations = yield* DelegationService.DelegationService;
        const { delegation, call } = yield* chiefWorking(harness, seeded);
        const started = yield* AgentThreadRuns.makeHandler;
        yield* Ref.set(harness.hook, (step) =>
          step === "create" ? Effect.die("thread not created yet") : Effect.void,
        );
        yield* Effect.exit(call("dispatch_worker", { delegationId: delegation.id, brief }));
        const worker = (yield* delegations.listForAgent(seeded.workspaceId, seeded.chief)).find(
          (row) => row.hop === "worker",
        )!;
        yield* started.settleOrphans;
        assert.strictEqual(yield* Queue.size(harness.finished), 0);
        assert.lengthOf(yield* db.openRunsOnThread(worker.threadId!), 1);
      }),
    false,
  ),
);

it.effect.each([
  { order: "the startup pass runs before Codi resumes the turn", passFirst: true, stopping: false },
  { order: "Codi resumes the turn before the startup pass", passFirst: false, stopping: false },
  { order: "the run listener saw the cut as the server stopped", passFirst: true, stopping: true },
] as const)(
  "a Chief run a restart cut follows the turn Codi resumes, whose report settles its task, when $order",
  ({ passFirst, stopping }) =>
    withHarness(
      (harness) =>
        Effect.gen(function* () {
          const seeded = yield* seed;
          const db = yield* TelescopeDb.TelescopeDb;
          const delegations = yield* DelegationService.DelegationService;
          const { delegation, runner, turn } = yield* chiefWorking(harness, seeded);
          yield* harness.running(turn);
          yield* Fiber.interrupt(runner);

          const restarted = yield* restart(harness, { stopping });
          if (passFirst) yield* restarted.settleOrphans;
          yield* harness.startWorker;
          const resumed = yield* Queue.take(harness.started);
          if (!passFirst) yield* restarted.settleOrphans;
          assert.equal(resumed.threadId, turn.threadId);
          const ref = { workspaceId: seeded.workspaceId, delegationId: delegation.id };
          assert.equal((yield* delegations.get(ref)).state, "WORKING");
          assert.lengthOf(yield* db.openRunsOnThread(turn.threadId), 1);
          assert.deepStrictEqual(yield* queued(seeded), []);

          yield* callOn(resumed.threadId)("delegation_report", {
            delegationId: delegation.id,
            state: "COMPLETED",
            report: { result: "修好了超时，回归测试通过", decisions: [] },
          });
          yield* harness.complete(resumed);
          assert.equal((yield* Queue.take(harness.finished)).threadId, turn.threadId);
          assert.equal((yield* delegations.get(ref)).state, "COMPLETED");
          assert.deepStrictEqual(yield* queued(seeded), [
            [seeded.pa, { kind: "report", delegationId: delegation.id }],
          ]);
        }),
      false,
    ),
);

it.effect(
  "a Worker run a restart cut wakes its Chief once, when the turn Codi resumes ends, not at startup",
  () =>
    withHarness(
      (harness) =>
        Effect.gen(function* () {
          const seeded = yield* seed;
          const delegations = yield* DelegationService.DelegationService;
          const { delegation, runner, turn, call } = yield* chiefWorking(harness, seeded);
          const opened = (yield* call("dispatch_worker", {
            delegationId: delegation.id,
            brief,
          })) as Opened;
          yield* Queue.take(harness.sessions);
          const working = yield* Queue.take(harness.started);
          yield* harness.running(working);
          yield* harness.complete(turn);
          yield* Fiber.join(runner);

          const restarted = yield* restart(harness);
          yield* harness.startWorker;
          const resumed = yield* Queue.take(harness.started);
          yield* restarted.settleOrphans;
          assert.equal(resumed.threadId, opened.threadId);
          assert.deepStrictEqual(
            (yield* Queue.clear(harness.finished)).map((run) => run.threadId),
            [turn.threadId],
          );
          assert.deepStrictEqual(yield* queued(seeded), []);
          const ref = { workspaceId: seeded.workspaceId, delegationId: delegation.id };
          assert.equal((yield* delegations.get(ref)).state, "WORKING");

          yield* harness.complete(resumed);
          assert.equal((yield* Queue.take(harness.finished)).threadId, opened.threadId);
          assert.deepStrictEqual(yield* queued(seeded), [
            [seeded.chief, { kind: "worker", delegationId: delegation.id }],
          ]);
        }),
      false,
    ),
);

it.effect(
  "a Chief run a restart cut fails its task once Codi declines to resume the turn, as when the member settled its thread first",
  () =>
    withHarness(
      (harness) =>
        Effect.gen(function* () {
          const seeded = yield* seed;
          const delegations = yield* DelegationService.DelegationService;
          const { delegation, runner, turn } = yield* chiefWorking(harness, seeded);
          yield* harness.running(turn);
          yield* Fiber.interrupt(runner);

          const restarted = yield* restart(harness);
          yield* restarted.settleOrphans;
          yield* (yield* Orchestrator.OrchestratorV2).dispatch({
            type: "thread.settle",
            commandId: CommandId.make("member-settles"),
            threadId: turn.threadId,
          });
          yield* harness.startWorker;
          yield* restarted.awaitContinuations;
          assert.deepStrictEqual(
            (yield* Queue.clear(harness.finished)).map((run) => run.threadId),
            [turn.threadId],
          );
          const failed = yield* delegations.get({
            workspaceId: seeded.workspaceId,
            delegationId: delegation.id,
          });
          assert.equal(failed.state, "FAILED");
          assert.equal(failed.report?.blockedOn, "没有汇报");
          assert.deepStrictEqual(yield* queued(seeded), [
            [seeded.pa, { kind: "report", delegationId: delegation.id }],
          ]);
          assert.strictEqual(yield* Queue.size(harness.started), 0);
        }),
      false,
    ),
);

it.effect(
  "with continuing threads after a restart off, a Chief run the restart cut fails its task at startup",
  () =>
    withHarness(
      (harness) =>
        Effect.gen(function* () {
          const seeded = yield* seed;
          const db = yield* TelescopeDb.TelescopeDb;
          const delegations = yield* DelegationService.DelegationService;
          const { delegation, runner, turn } = yield* chiefWorking(harness, seeded);
          yield* harness.running(turn);
          yield* Fiber.interrupt(runner);

          const restarted = yield* restart(harness, { continueThreadsAfterServerUpdate: false });
          yield* restarted.settleOrphans;
          assert.deepStrictEqual(
            (yield* Queue.clear(harness.finished)).map((run) => run.threadId),
            [turn.threadId],
          );
          assert.lengthOf(yield* db.openRunsOnThread(turn.threadId), 0);
          const failed = yield* delegations.get({
            workspaceId: seeded.workspaceId,
            delegationId: delegation.id,
          });
          assert.equal(failed.state, "FAILED");
          assert.equal(failed.report?.blockedOn, "没有汇报");
          assert.deepStrictEqual(yield* queued(seeded), [
            [seeded.pa, { kind: "report", delegationId: delegation.id }],
          ]);
        }),
      false,
    ),
);

it.effect.each([
  { listener: "sees the failed start as it happens", held: false },
  { listener: "catches up only once Codi retried", held: true },
] as const)(
  "a Chief run whose resumed turn failed to start follows Codi's retry, whose report settles its task, when the run listener $listener",
  ({ held }) =>
    withHarness(
      (harness) =>
        Effect.gen(function* () {
          const seeded = yield* seed;
          const db = yield* TelescopeDb.TelescopeDb;
          const delegations = yield* DelegationService.DelegationService;
          const gate = yield* Deferred.make<void>();
          const { delegation, turn, restarted } = yield* resumedTurnFailsToStart(
            harness,
            seeded,
            held ? gate : undefined,
          );
          const afterSequence = yield* (yield* Orchestrator.OrchestratorV2).getThreadEventSequence(
            turn.threadId,
          );
          yield* TestClock.adjust("61 seconds");
          const retried = yield* Queue.take(harness.started);
          assert.equal(retried.threadId, turn.threadId);
          yield* Deferred.succeed(gate, undefined);
          yield* restarted.caughtUp;
          const ref = { workspaceId: seeded.workspaceId, delegationId: delegation.id };
          assert.equal((yield* delegations.get(ref)).state, "WORKING");
          assert.lengthOf(yield* db.openRunsOnThread(turn.threadId), 1);
          assert.strictEqual(yield* Queue.size(harness.finished), 0);
          assert.deepStrictEqual(yield* queued(seeded), []);

          yield* callOn(retried.threadId)("delegation_report", {
            delegationId: delegation.id,
            state: "COMPLETED",
            report: { result: "修好了超时，回归测试通过", decisions: [] },
          });
          yield* harness.complete(retried);
          yield* runUpdated(
            turn.threadId,
            afterSequence,
            (run) => run.id === retried.runId && run.status === "completed",
          );
          yield* restarted.caughtUp;
          yield* restarted.awaitContinuations;
          assert.deepStrictEqual(
            (yield* Queue.clear(harness.finished)).map((run) => run.threadId),
            [turn.threadId],
          );
          assert.equal((yield* delegations.get(ref)).state, "COMPLETED");
          assert.deepStrictEqual(yield* queued(seeded), [
            [seeded.pa, { kind: "report", delegationId: delegation.id }],
          ]);
        }),
      false,
    ),
);

it.effect(
  "a Chief run whose resumed turn failed to start fails its task once Codi declines the retry it had scheduled when the run listener saw the failed start, as the member archived the thread",
  () =>
    withHarness(
      (harness) =>
        Effect.gen(function* () {
          const seeded = yield* seed;
          const db = yield* TelescopeDb.TelescopeDb;
          const delegations = yield* DelegationService.DelegationService;
          const gate = yield* Deferred.make<void>();
          const { delegation, turn, restarted } = yield* resumedTurnFailsToStart(
            harness,
            seeded,
            gate,
          );
          yield* Deferred.succeed(gate, undefined);
          yield* restarted.caughtUp;
          const ref = { workspaceId: seeded.workspaceId, delegationId: delegation.id };
          assert.equal((yield* delegations.get(ref)).state, "WORKING");
          assert.lengthOf(yield* db.openRunsOnThread(turn.threadId), 1);
          assert.strictEqual(yield* Queue.size(harness.finished), 0);

          yield* (yield* Orchestrator.OrchestratorV2).dispatch({
            type: "thread.archive",
            commandId: CommandId.make("member-archives"),
            threadId: turn.threadId,
          });
          yield* TestClock.adjust("61 seconds");
          yield* restarted.awaitContinuations;
          assert.deepStrictEqual(
            (yield* Queue.clear(harness.finished)).map((run) => run.threadId),
            [turn.threadId],
          );
          const task = yield* delegations.get(ref);
          assert.equal(task.state, "FAILED");
          assert.match(task.report?.blockedOn ?? "", /^The provider could not start this turn\./);
          assert.deepStrictEqual(yield* queued(seeded), [
            [seeded.pa, { kind: "report", delegationId: delegation.id }],
          ]);
          assert.strictEqual(yield* Queue.size(harness.started), 0);
        }),
      false,
    ),
);

it.effect(
  "a Chief run whose resumed turn failed to start before the server stopped, with no retry written, fails its task at the next start",
  () =>
    withHarness(
      (harness) =>
        Effect.gen(function* () {
          const seeded = yield* seed;
          const delegations = yield* DelegationService.DelegationService;
          const sql = yield* SqlClient.SqlClient;
          const { delegation, turn, failed } = yield* resumedTurnFailsToStart(harness, seeded);
          yield* sql`DELETE FROM orchestration_v2_effect_outbox WHERE effect_id = ${`effect:restart-continuation:${failed.id}`}`;
          yield* Queue.clear(harness.finished);

          const again = yield* restart(harness);
          yield* again.settleOrphans;
          assert.deepStrictEqual(
            (yield* Queue.clear(harness.finished)).map((run) => run.threadId),
            [turn.threadId],
          );
          const task = yield* delegations.get({
            workspaceId: seeded.workspaceId,
            delegationId: delegation.id,
          });
          assert.equal(task.state, "FAILED");
          assert.deepStrictEqual(yield* queued(seeded), [
            [seeded.pa, { kind: "report", delegationId: delegation.id }],
          ]);
        }),
      false,
    ),
);

it.effect.each([
  { answered: false, name: "the Chief's task stays WORKING while its Worker's question is open" },
  {
    answered: true,
    name: "the member's answer runs the Worker's next turn in a run whose end wakes the Chief once",
  },
] as const)(
  "a Chief that raises its Worker's question on the Worker's task: $name",
  ({ answered }) =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const delegations = yield* DelegationService.DelegationService;
        const wakes = yield* WakeQueueService.WakeQueueService;
        const threads = yield* ThreadManagementService.ThreadManagementService;
        const { delegation, runner, turn, call } = yield* chiefWorking(harness, seeded);
        const opened = (yield* call("dispatch_worker", {
          delegationId: delegation.id,
          brief,
        })) as Opened;
        yield* Queue.take(harness.sessions);
        const workerTurn = yield* Queue.take(harness.started);
        yield* harness.complete(turn);
        yield* Fiber.join(runner);
        assert.equal((yield* Queue.take(harness.finished)).threadId, turn.threadId);
        yield* harness.complete(workerTurn);
        assert.equal((yield* Queue.take(harness.finished)).threadId, opened.threadId);

        const next = yield* runWake(yield* wakes.take);
        const asking = yield* Queue.take(harness.started);
        yield* call("delegation_report", {
          delegationId: opened.delegationId,
          state: "INPUT_REQUIRED",
          report: { result: "", decisions: [], blockedOn: "电机选型" },
          question: "换电机还是加齿轮？",
          options: ["换 MX-40", "加减速齿轮"],
        });
        yield* harness.complete(asking);
        yield* Fiber.join(next);
        assert.equal((yield* Queue.take(harness.finished)).threadId, turn.threadId);
        // One fiber handles run ends, so this later run's end follows the asking turn's.
        const chiefThread = yield* threads.getThreadShell(turn.threadId);
        yield* threads.sendToThread({
          projectId: chiefThread!.projectId,
          commandId: CommandId.make("member-asks"),
          threadId: turn.threadId,
          messageId: MessageId.make("member-asks"),
          text: "进度如何？",
          attachments: [],
          mode: "queue",
          createdBy: "user",
          creationSource: "web",
        });
        yield* harness.complete(yield* Queue.take(harness.started));
        assert.equal((yield* Queue.take(harness.finished)).threadId, turn.threadId);
        const state = (delegationId: Telescope.DelegationId) =>
          delegations
            .get({ workspaceId: seeded.workspaceId, delegationId })
            .pipe(Effect.map((row) => [row.state, row.report?.blockedOn]));
        assert.deepStrictEqual(
          [yield* state(delegation.id), yield* state(opened.delegationId)],
          [
            ["WORKING", undefined],
            ["INPUT_REQUIRED", "电机选型"],
          ],
        );
        if (!answered) return;

        const board = yield* TaskBoardService.TaskBoardService;
        const { decisionId } = yield* delegations.get({
          workspaceId: seeded.workspaceId,
          delegationId: opened.delegationId,
        });
        const { decisions } = yield* board.listDecisions(
          { caller: alice },
          { workspaceId: seeded.workspaceId },
        );
        const proposal = decisions.find((decision) => decision.id === decisionId)!;
        yield* board.createDecision(
          { caller: alice },
          {
            workspaceId: seeded.workspaceId,
            title: proposal.title,
            text: proposal.text,
            status: "decided",
            supersedes: proposal.id,
            options: proposal.options!,
            chosen: "1",
          },
        );
        yield* (yield* DelegationAnswers.make).catchUp;
        const db = yield* TelescopeDb.TelescopeDb;
        const answer = `telescope-answer:${proposal.id}`;
        assert.lengthOf(yield* db.openRunsOnThread(opened.threadId, answer), 1);
        const answeredTurn = yield* Queue.take(harness.started);
        assert.equal(answeredTurn.threadId, opened.threadId);
        assert.include(answeredTurn.message.text, "换 MX-40");
        yield* harness.complete(answeredTurn);
        assert.equal((yield* Queue.take(harness.finished)).threadId, opened.threadId);
        const settled = yield* wakes.take;
        assert.equal(settled.wake.agentId, seeded.chief);
        assert.deepStrictEqual(settled.payloads, [{ kind: "worker", delegationId: delegation.id }]);
        assert.isUndefined(yield* wakes.dequeue);

        const last = yield* runWake(settled);
        const reporting = yield* Queue.take(harness.started);
        yield* call("delegation_report", {
          delegationId: delegation.id,
          state: "COMPLETED",
          report: { result: "换了 MX-40，回归测试通过", decisions: [] },
        });
        yield* harness.complete(reporting);
        yield* Fiber.join(last);
        assert.deepStrictEqual(yield* state(delegation.id), ["COMPLETED", undefined]);
        assert.deepStrictEqual(yield* queued(seeded), [
          [seeded.pa, { kind: "report", delegationId: delegation.id }],
        ]);
      }),
    ),
);

it.effect.each([
  {
    route: { source: "none", skipped: [] },
    allowlist: { models: ["other-model"] },
    disabled: false,
    name: "routing none with a default outside the allowlist",
  },
  {
    route: { source: "none", skipped: [] },
    allowlist: undefined,
    disabled: true,
    name: "routing none with a default whose provider the project disabled",
  },
  {
    route: { source: "none_allowed", skipped: [{ reason: "model_not_allowed" }] },
    allowlist: undefined,
    disabled: false,
    name: "routing none_allowed",
  },
] as const)("$name refuses the Worker and opens nothing", ({ route, allowlist, disabled }) =>
  withHarness((harness) =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const db = yield* TelescopeDb.TelescopeDb;
      yield* Ref.set(harness.route, route);
      if (allowlist !== undefined)
        yield* db.insert(seeded.workspaceId, "project_rules", {
          project_id: gripper,
          powers_json: JSON.stringify(ALL),
          routing_json: JSON.stringify(allowlist),
          updated_by: seeded.member,
          updated_at: "2026-11-07T00:00:00.000Z",
        });
      const { delegation, call } = yield* chiefWorking(harness, seeded);
      if (disabled)
        yield* (yield* ServerSettings.ServerSettingsService).updateSettings({
          projectSettingsOverrides: {
            [gripper]: { providerInstances: { [instanceId]: { enabled: false } } },
          },
        });
      assert.deepInclude(yield* call("dispatch_worker", { delegationId: delegation.id, brief }), {
        code: "capability_denied",
        message:
          "The project's routing allows no model for a Worker, so none was opened. Report it on your task with `delegation_report`.",
      });
      const rows = yield* (yield* DelegationService.DelegationService).listForAgent(
        seeded.workspaceId,
        seeded.chief,
      );
      assert.deepStrictEqual(
        rows.map((row) => row.hop),
        ["agent"],
      );
      assert.equal(yield* db.count(seeded.workspaceId, "runs"), 1);
    }),
  ),
);

it.effect.each([
  { by: "cancel", member: false },
  { by: "a member cancel of a chain with a Worker hop", member: true },
] as const)("$by interrupts the Worker turn and keeps the thread", ({ member }) =>
  withHarness((harness) =>
    Effect.gen(function* () {
      const seeded = yield* seed;
      const { delegation, call } = yield* chiefWorking(harness, seeded);
      const opened = (yield* call("dispatch_worker", {
        delegationId: delegation.id,
        brief,
      })) as Opened;
      yield* Queue.take(harness.sessions);
      yield* Queue.take(harness.started);
      const workers = yield* WorkerDispatch.WorkerDispatch;
      const delegations = yield* DelegationService.DelegationService;
      const ref = { workspaceId: seeded.workspaceId, delegationId: delegation.id };
      const cancelled = member
        ? (yield* workers.cancelForMember(alice, ref)).canceled
        : (yield* workers.cancel(seeded.actor, delegation.id)).map((row) => row.id);
      assert.deepStrictEqual(cancelled, [delegation.id, opened.delegationId]);
      for (const delegationId of cancelled)
        assert.equal((yield* delegations.get({ ...ref, delegationId })).state, "CANCELED");
      assert.deepStrictEqual(
        (yield* Ref.get(harness.log))
          .filter((entry) => entry.endsWith(opened.threadId))
          .map((entry) => entry.split(":")[0]),
        ["create", "send", "interrupt_requested"],
      );
      const shell = yield* (yield* ThreadManagementService.ThreadManagementService).getThreadShell(
        opened.threadId,
      );
      assert.isNotNull(shell);
      assert.isNull(shell?.archivedAt);
    }),
  ),
);

it.effect(
  "a task cancelled before its Worker thread is created opens no thread, starts no turn and finishes the Worker run",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const { delegation, call } = yield* chiefWorking(harness, seeded);
        const workers = yield* WorkerDispatch.WorkerDispatch;
        const cancel = Effect.orDie(workers.cancel(seeded.actor, delegation.id));
        yield* Ref.set(harness.hook, (step) =>
          step === "started" ? Effect.asVoid(cancel) : Effect.void,
        );
        const result = yield* call("dispatch_worker", { delegationId: delegation.id, brief });
        const [worker] = (yield* (yield* DelegationService.DelegationService).listForAgent(
          seeded.workspaceId,
          seeded.chief,
        )).filter((row) => row.hop === "worker");
        const threadId = worker!.threadId!;
        assert.deepStrictEqual(
          (yield* Ref.get(harness.log)).filter((entry) => entry.endsWith(threadId)),
          [],
        );
        assert.isNull(
          yield* (yield* ThreadManagementService.ThreadManagementService).getThreadShell(threadId),
        );
        assert.deepStrictEqual(result, { delegationId: worker!.id, state: "CANCELED" });
        const run = yield* Queue.take(harness.finished);
        assert.equal(run.threadId, threadId);
        assert.include(run.outputSummary, "cancelled");
      }),
    ),
);

it.effect(
  "a task cancelled between its Worker thread's creation and the brief interrupts the Worker turn and keeps the thread",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const { delegation, call } = yield* chiefWorking(harness, seeded);
        const workers = yield* WorkerDispatch.WorkerDispatch;
        const cancel = Effect.orDie(workers.cancel(seeded.actor, delegation.id));
        yield* Ref.set(harness.hook, (step) =>
          step === "send" ? Effect.asVoid(cancel) : Effect.void,
        );
        const result = (yield* call("dispatch_worker", {
          delegationId: delegation.id,
          brief,
        })) as Opened & { readonly state: string };
        // The cancel's own interrupt finds no turn yet; the Worker turn needs one after the send.
        assert.deepStrictEqual(
          (yield* Ref.get(harness.log))
            .filter((entry) => entry.endsWith(result.threadId))
            .map((entry) => entry.split(":")[0]),
          ["create", "no_active_run", "send", "interrupt_requested"],
        );
        assert.equal(result.state, "CANCELED");
        const shell =
          yield* (yield* ThreadManagementService.ThreadManagementService).getThreadShell(
            result.threadId,
          );
        assert.isNotNull(shell);
        assert.isNull(shell?.archivedAt);
      }),
    ),
);
