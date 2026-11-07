import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
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
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
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
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AgentInstructions from "./AgentInstructions.ts";
import * as AgentRuntime from "./AgentRuntime.ts";
import * as AgentService from "./AgentService.ts";
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

/** A provider whose session start records the thread's open Telescope run, as tools/list would. */
const makeHarness = Effect.gen(function* () {
  const cwd = yield* checkpointWorkspace("telescope-worker-dispatch");
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const sessions = yield* Queue.unbounded<{
    readonly threadId: ThreadId;
    readonly onBehalfOf?: string;
  }>();
  const started = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2TurnInput>();
  const finished = yield* Queue.unbounded<Telescope.AgentRun>();
  const interrupts =
    yield* Queue.unbounded<ThreadManagementService.ThreadManagementInterruptInput>();
  const route = yield* Ref.make(byAgentDefault);
  // Runs after each delegation start and run finish, and before each send.
  type Step = "started" | "finished" | "send";
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
          startTurn: (turn) => Queue.offer(started, turn).pipe(Effect.asVoid),
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
  const complete = (turn: ProviderAdapter.ProviderAdapterV2TurnInput) =>
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
    GrantService.layer,
    TaskBoardService.layer,
    ToolGateway.layer,
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
        (command.type === "thread.create" ? record("create", command.threadId) : Effect.void).pipe(
          Effect.andThen(service.dispatch(command)),
        ),
      sendToThread: (input) =>
        runHook("send").pipe(
          Effect.andThen(record("send", input.threadId)),
          Effect.andThen(service.sendToThread(input)),
        ),
      interruptThread: (input) =>
        Queue.offer(interrupts, input).pipe(
          Effect.andThen(service.interruptThread(input)),
          Effect.tap((result) => record(result.type, input.threadId)),
        ),
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
    AgentRuntime.layer,
    ThreadTurnTokens.layer,
    McpToolAccess.HandlersLayer.layer(TelescopeHandlers.layer),
  ).pipe(
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
  return { runtime, db, sessions, started, finished, interrupts, route, hook, log, complete };
});
type Harness = Effect.Success<typeof makeHarness>;

const withHarness = <A, E>(
  body: (harness: Harness) => Effect.Effect<A, E, Layer.Success<Harness["runtime"]> | Scope.Scope>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      return yield* Effect.gen(function* () {
        yield* Deferred.succeed(harness.db, yield* TelescopeDb.TelescopeDb);
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

it.effect(
  "dispatch_worker opens a top-level Worker thread in the Chief's project whose run exists before its session",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const seeded = yield* seed;
        const { delegation, call } = yield* chiefWorking(harness, seeded);
        const opened = (yield* call("dispatch_worker", {
          delegationId: delegation.id,
          brief,
        })) as Opened & { readonly link: string };
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
        const report = yield* wakes.take;
        assert.equal(report.wake.agentId, seeded.pa);
        assert.deepStrictEqual(report.payloads, [{ kind: "report", delegationId: delegation.id }]);
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
        const report = yield* wakes.take;
        assert.deepStrictEqual(report.payloads, [{ kind: "report", delegationId: delegation.id }]);
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

it.effect("cancel interrupts the Worker turn and keeps the thread", () =>
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
      const cancelled = yield* workers.cancel(seeded.actor, delegation.id);
      assert.deepStrictEqual(
        cancelled.map((row) => [row.id, row.state]),
        [
          [delegation.id, "CANCELED"],
          [opened.delegationId, "CANCELED"],
        ],
      );
      const interrupt = yield* Queue.take(harness.interrupts);
      assert.deepInclude(interrupt, { threadId: opened.threadId, projectId: gripper });
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
