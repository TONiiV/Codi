import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  type Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import { runMigrations } from "../../../persistence/Migrations.ts";
import * as SqlitePersistence from "../../../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as ScheduledTasks from "../../../scheduledTasks/ScheduledTaskService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as AgentService from "../../../telescope/AgentService.ts";
import * as GrantService from "../../../telescope/GrantService.ts";
import * as RunRecordService from "../../../telescope/RunRecordService.ts";
import * as TelescopeDb from "../../../telescope/TelescopeDb.ts";
import * as ToolGateway from "../../../telescope/ToolGateway.ts";
import * as WorkspaceService from "../../../telescope/WorkspaceService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as ProjectHandlers from "../project/handlers.ts";
import { ProjectToolkit } from "../project/tools.ts";
import * as ThreadHandlers from "../thread/handlers.ts";
import { ThreadToolkit } from "../thread/tools.ts";
import * as OrchestratorHandlers from "./handlers.ts";
import { OrchestratorToolkit } from "./tools.ts";

const services = Layer.mergeAll(
  ToolGateway.layer,
  GrantService.layer,
  RunRecordService.layer,
  AgentService.layer,
  WorkspaceService.layer,
  TelescopeDb.layer,
).pipe(
  Layer.provideMerge(
    Layer.merge(
      Layer.effectDiscard(runMigrations()).pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
      NodeCrypto.layer,
    ),
  ),
  Layer.provide(
    // Elsewhere, so binding `web` needs no project record here.
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env-elsewhere")),
    }),
  ),
);
/** `opened` records each thread-opening or steering call that reached the service. */
const layer = (opened: Array<string>) =>
  Layer.mergeAll(
    McpToolAccess.HandlersLayer.layer(OrchestratorHandlers.layer),
    McpToolAccess.HandlersLayer.layer(ThreadHandlers.layer),
    McpToolAccess.HandlersLayer.layer(ProjectHandlers.layer),
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        services,
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
          getProjectThreadRecords: ({ threadId }) =>
            Effect.succeed({ thread: { id: threadId } } as never),
          dispatch: (command) =>
            Effect.sync(
              () => (
                opened.push(`t3_thread_transfer ${command.type.replace("thread.", "")}`),
                {
                  sequence: 1,
                  storedEvents: [],
                }
              ),
            ),
        }),
        Layer.mock(ScheduledTasks.ScheduledTaskService)({
          list: () =>
            Effect.sync(() => (opened.push("run_scheduled_task_now"), { tasks: [] }) as never),
        }),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          ensureScratchProject: Effect.suspend(() => {
            opened.push("t3_thread_launch");
            return Effect.fail(new ManagedProjectFolders.ScratchUnavailableError());
          }),
        }),
        // t3_thread_launch needs these to type-check; the scratch path stops before any of them.
        Layer.mergeAll(
          Layer.mock(Project.ProjectService)({}),
          Layer.mock(ThreadLaunch.ThreadLaunchService)({}),
          Layer.mock(GitVcsDriver.GitVcsDriver)({}),
          Layer.mock(ProviderRegistry.ProviderRegistry)({}),
          Layer.mock(DocumentText.DocumentText)({}),
          ServerSettings.layerTest(),
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-telescope-gate-" }),
        ).pipe(Layer.provideMerge(NodeServices.layer)),
        Layer.mock(OrchestratorMcpService.OrchestratorMcpService)({
          createThreads: () => Effect.sync(() => (opened.push("create_threads"), { threads: [] })),
          delegateTask: () => Effect.sync(() => (opened.push("delegate_task"), {}) as never),
          scheduleTask: () => Effect.sync(() => (opened.push("schedule_task"), scheduledTask)),
          updateScheduledTask: () =>
            Effect.sync(() => (opened.push("schedule_task update"), scheduledTask)),
          sendToThread: (_scope, { threadId }) =>
            Effect.sync(() => {
              opened.push("t3_thread_send");
              return {
                threadId,
                messageId: MessageId.make("message-1"),
                runId: RunId.make("run-1"),
                status: "running" as const,
                delivery: "started" as const,
              };
            }),
        }),
      ),
    ),
  );

const ann: WorkspaceService.SessionCaller = {
  sessionId: AuthSessionId.make("session-ann"),
  subject: "one-time-token",
};
const web = ProjectId.make("project-web");
const scheduledTask = {
  scheduledTaskId: ScheduledTaskId.make("sched-1"),
  title: "Nightly",
  prompt: "Fix the build",
  enabled: true,
  projectId: web,
  boundThreadId: null,
  freshSession: false,
  schedule: { type: "interval" as const, everyMs: 60_000 },
  nextRunAt: null,
  lastRunStatus: "never" as const,
};

const ALL: Telescope.StandingPowers = {
  openTickets: true,
  dispatchWorkers: true,
  answerMembers: true,
  mergePRs: true,
};

/** Ann's workspace, bound to `web`; `on(kind)` starts that agent's run on its own thread. */
const setup = Effect.gen(function* () {
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const { id: workspaceId } = yield* workspaces.create(ann, {
    kind: "personal",
    name: "Acme",
    displayName: "Ann",
  });
  yield* workspaces.bind(ann, {
    workspaceId,
    environmentId: EnvironmentId.make("env-local"),
    projectId: web,
  });
  const { agents } = yield* (yield* AgentService.AgentService).listMine(ann, { workspaceId });
  const db = yield* TelescopeDb.TelescopeDb;
  const toolkits = {
    orchestrator: yield* OrchestratorToolkit,
    thread: yield* ThreadToolkit,
    project: yield* ProjectToolkit,
  };
  const handleOn =
    <Tools extends Record<string, Tool.Any>>(
      toolkit: Toolkit.WithHandler<Tools>,
      threadId: ThreadId,
    ) =>
    <Name extends keyof Tools & string>(name: Name, params: Tool.Parameters<Tools[Name]>) =>
      toolkit.handle(name, params).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((out) => out.at(-1)?.result),
        Effect.provideService(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("env-local"),
          requestNamespace: `provider:${threadId}`,
          thread: {
            threadId,
            providerSessionId: `provider:${threadId}`,
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
      );
  const callOn = (threadId: ThreadId) => handleOn(toolkits.orchestrator, threadId);
  const on = Effect.fn(function* (kind: Telescope.AgentKind) {
    const agent = agents.find((candidate) => candidate.kind === kind);
    assert.isDefined(agent);
    // Stored directly so the grant holds dispatchWorkers and only the gateway's rules decide.
    yield* db.update(
      workspaceId,
      "agents",
      { standing_powers_json: JSON.stringify(ALL) },
      { agent_id: agent.id },
    );
    const threadId = ThreadId.make(`thread-${kind}-${workspaceId}`);
    yield* (yield* RunRecordService.RunRecordService).start(ann, workspaceId, {
      agentId: agent.id,
      threadId,
      inputSnapshot: {
        promptVersion: "prompt@1",
        skillsVersions: {},
        powersVersion: "powers@1",
        model: "model-a",
        contextManifest: [],
      },
    });
    return {
      agentId: agent.id,
      call: callOn(threadId),
      thread: handleOn(toolkits.thread, threadId),
      project: handleOn(toolkits.project, threadId),
    };
  });
  const audit = (yield* GrantService.GrantService)
    .auditList(ann, { workspaceId })
    .pipe(
      Effect.map(({ entries }) =>
        entries.map((entry) => [entry.tool, entry.outcome, entry.reason]),
      ),
    );
  return { workspaceId, on, callOn, audit };
});

const threads = { threads: [{ prompt: "Fix the build" }] };
const worker = ThreadId.make("thread-worker");
type Run = Effect.Success<ReturnType<Effect.Success<typeof setup>["on"]>>;
const sched = scheduledTask.scheduledTaskId;
/** Each tool that opens a thread, writes into one or schedules work, by the service step it reaches. */
const opens = {
  create_threads: (run: Run) => run.call("create_threads", threads),
  delegate_task: (run: Run) => run.call("delegate_task", { task: "Fix the build" }),
  schedule_task: (run: Run) =>
    run.call("schedule_task", {
      prompt: "Fix the build",
      schedule: { type: "interval", everyMs: 60_000 },
    }),
  "schedule_task update": (run: Run) =>
    run.call("schedule_task", { scheduledTaskId: sched, enabled: true }),
  t3_thread_launch: (run: Run) =>
    run.project("t3_thread_launch", { scratch: true, title: "Fix the build" }),
  run_scheduled_task_now: (run: Run) => run.thread("run_scheduled_task_now", { taskId: sched }),
  "t3_thread_transfer fork": (run: Run) => run.thread("t3_thread_transfer", { action: "fork" }),
  "t3_thread_transfer merge_back": (run: Run) =>
    run.thread("t3_thread_transfer", { action: "merge_back", targetThreadId: worker }),
  t3_thread_send: (run: Run) => run.call("t3_thread_send", { threadId: worker, message: "Go" }),
};

it.effect.each(Object.keys(opens) as Array<keyof typeof opens>)(
  "a PA run calling %s is denied by the gateway and opens no thread",
  (tool) => {
    const opened: Array<string> = [];
    return Effect.gen(function* () {
      const { on, audit } = yield* setup;
      const pa = yield* on("chief_of_staff");
      assert.deepInclude(yield* opens[tool](pa), {
        _tag: "OrchestratorMcpFailure",
        code: "capability_denied",
        message:
          "Only a project's agent opens Worker threads. Hand the work to its Chief Agent with `delegate`. Do not retry; tell your member.",
      });
      assert.deepStrictEqual(opened, []);
      assert.deepStrictEqual(yield* audit, [
        [
          "dispatch_worker",
          "denied",
          "Only a project's agent opens Worker threads. Hand the work to its Chief Agent with `delegate`.",
        ],
      ]);
    }).pipe(Effect.provide(layer(opened)));
  },
);

it.effect("an ordinary thread's create_threads is unchanged", () => {
  const opened: Array<string> = [];
  return Effect.gen(function* () {
    const { callOn, audit } = yield* setup;
    const ordinary = callOn(ThreadId.make("thread-ordinary"));
    assert.deepStrictEqual(yield* ordinary("create_threads", threads), { threads: [] });
    assert.deepStrictEqual(opened, ["create_threads"]);
    assert.deepStrictEqual(yield* audit, []);
  }).pipe(Effect.provide(layer(opened)));
});

it.effect.each([
  "t3_thread_send",
  "schedule_task update",
  "t3_thread_transfer fork",
  "t3_thread_transfer merge_back",
] as const)("a Chief run's %s passes and counts one budget call", (tool) => {
  const opened: Array<string> = [];
  return Effect.gen(function* () {
    const { workspaceId, on, audit } = yield* setup;
    const chief = yield* on("chief_agent");
    const gateway = yield* ToolGateway.ToolGateway;
    const budget = { workspaceId, scope: "agent" as const, scopeId: chief.agentId };
    yield* gateway.setBudget(ann, { ...budget, limitCalls: 5 });
    assert.notPropertyVal(yield* opens[tool](chief), "_tag", "OrchestratorMcpFailure");
    assert.deepStrictEqual(opened, [tool]);
    assert.deepStrictEqual(yield* audit, [["dispatch_worker", "allowed", undefined]]);
    const { budgets } = yield* gateway.governance(ann, { workspaceId });
    assert.deepStrictEqual(
      budgets.map((row) => row.usedCalls),
      [1],
    );
  }).pipe(Effect.provide(layer(opened)));
});
