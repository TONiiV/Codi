import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  MessageId,
  OrchestratorMcpFailure,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  type Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as SchemaAST from "effect/SchemaAST";
import * as Stream from "effect/Stream";
import type { Tool, Toolkit } from "effect/ai";

import * as AssetSigner from "../../../assets/AssetSigner.ts";
import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import { runMigrations } from "../../../persistence/Migrations.ts";
import * as SqlitePersistence from "../../../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as PullRequestReviewGuideService from "../../../pullRequest/PullRequestReviewGuideService.ts";
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
import * as AttachmentHandlers from "../attachment/handlers.ts";
import { AttachmentToolkit } from "../attachment/tools.ts";
import * as ProjectHandlers from "../project/handlers.ts";
import { ProjectToolkit } from "../project/tools.ts";
import * as Gate from "../telescope/gate.ts";
import * as PullRequestsHandlers from "../pullRequests/handlers.ts";
import { PullRequestsToolkit } from "../pullRequests/tools.ts";
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
    McpToolAccess.HandlersLayer.layer(AttachmentHandlers.layer),
    McpToolAccess.HandlersLayer.layer(PullRequestsHandlers.layer),
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        services,
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
          getProjectThreadRecords: ({ threadId }, fields) =>
            Effect.sync(() => {
              if ((fields as ReadonlyArray<string>).includes("messages"))
                opened.push("t3_thread_send_attachments");
              return { thread: { id: threadId } } as never;
            }),
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
        // Stands in for a linked environment.
        Layer.mock(PeerForwarding.PeerForwarding)({
          call: (_scope, tool) =>
            Effect.sync(() => opened.push(`forwarded ${tool.name}`)).pipe(
              Effect.andThen(
                Effect.fail(
                  new OrchestratorMcpFailure({ code: "orchestration_error", message: "" }),
                ),
              ),
            ),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          // A missing thread is looked up again under its `mcp:` alias.
          getThreadShell: (threadId) =>
            Effect.sync(() => {
              if (!threadId.startsWith("mcp:")) opened.push("watch_pull_request");
              return null;
            }),
        }),
        Layer.mock(AssetSigner.AssetSigner)({}),
        Layer.mock(ServerSecretStore.ServerSecretStore)({}),
        Layer.mock(PullRequestReviewGuideService.PullRequestReviewGuideService)({}),
        Layer.succeed(
          SecureRandom.SecureRandom,
          SecureRandom.make((size) => new Uint8Array(size)),
        ),
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
          deleteScheduledTask: (_scope, { scheduledTaskId }) =>
            Effect.sync(
              () => (opened.push("delete_scheduled_task"), { scheduledTaskId, deleted: true }),
            ),
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
    attachment: yield* AttachmentToolkit,
    pr: yield* PullRequestsToolkit,
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
          capabilities: new Set(["orchestration", "pull-requests"] as const),
          issuedAt: 0,
        }),
      );
  const callers = (threadId: ThreadId) => ({
    call: handleOn(toolkits.orchestrator, threadId),
    thread: handleOn(toolkits.thread, threadId),
    project: handleOn(toolkits.project, threadId),
    attachment: handleOn(toolkits.attachment, threadId),
    pr: handleOn(toolkits.pr, threadId),
  });
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
    const run = yield* (yield* RunRecordService.RunRecordService).start(ann, workspaceId, {
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
    return { agentId: agent.id, runId: run.id, threadId, ...callers(threadId) };
  });
  const audit = (yield* GrantService.GrantService)
    .auditList(ann, { workspaceId })
    .pipe(
      Effect.map(({ entries }) =>
        entries.map((entry) => [entry.tool, entry.outcome, entry.reason]),
      ),
    );
  return { workspaceId, on, callers, audit };
});

const threads = { threads: [{ prompt: "Fix the build" }] };
const worker = ThreadId.make("thread-worker");
type Run = ReturnType<Effect.Success<typeof setup>["callers"]>;
const sched = scheduledTask.scheduledTaskId;
/** Each tool that opens a thread, writes into one or schedules work, by the service step it reaches. */
const opens = {
  create_threads: (run: Run) => run.call("create_threads", threads),
  delegate_task: (run: Run) => run.call("delegate_task", { task: "Fix the build" }),
  "delegate_task naming its own environment": (run: Run) =>
    run.call("delegate_task", {
      task: "Fix the build",
      target: { environmentId: EnvironmentId.make("env-local") },
    }),
  schedule_task: (run: Run) =>
    run.call("schedule_task", {
      prompt: "Fix the build",
      schedule: { type: "interval", everyMs: 60_000 },
    }),
  "schedule_task update": (run: Run) =>
    run.call("schedule_task", { scheduledTaskId: sched, enabled: true }),
  t3_thread_launch: (run: Run) =>
    run.project("t3_thread_launch", { scratch: true, title: "Fix the build" }),
  "t3_thread_launch delegated from another environment": (run: Run) =>
    run.project("t3_thread_launch", {
      scratch: true,
      title: "Fix the build",
      delegatedFrom: {
        environmentId: EnvironmentId.make("env-peer"),
        threadId: worker,
        title: "Ops",
      },
    }),
  run_scheduled_task_now: (run: Run) => run.thread("run_scheduled_task_now", { taskId: sched }),
  "t3_thread_transfer fork": (run: Run) => run.thread("t3_thread_transfer", { action: "fork" }),
  "t3_thread_transfer merge_back": (run: Run) =>
    run.thread("t3_thread_transfer", { action: "merge_back", targetThreadId: worker }),
  t3_thread_send: (run: Run) => run.call("t3_thread_send", { threadId: worker, message: "Go" }),
  t3_thread_send_attachments: (run: Run) =>
    run.attachment("t3_thread_send_attachments", {
      threadId: worker,
      message: "Go",
      attachments: [
        { type: "file", id: "log-1", name: "log.txt", mimeType: "text/plain", sizeBytes: 1 },
      ],
    }),
  delete_scheduled_task: (run: Run) =>
    run.call("delete_scheduled_task", { scheduledTaskId: sched }),
  // Pull request tools fail as errors, not results.
  watch_pull_request: (run: Run) =>
    run
      .pr("watch_pull_request", { threadId: worker, url: "https://github.com/acme/web/pull/7" })
      .pipe(Effect.catch(Effect.succeed)),
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
      assert.deepStrictEqual(yield* audit, [["dispatch_worker", "denied", "project_only"]]);
    }).pipe(Effect.provide(layer(opened)));
  },
);

const RESIDENT =
  "An agent's own thread does not open or steer other threads. Open a Worker for the task with `dispatch_worker` and a brief.";
it.effect.each(Object.keys(opens) as Array<keyof typeof opens>)(
  "a Chief's %s on its own thread is refused with use dispatch_worker",
  (tool) => {
    const opened: Array<string> = [];
    return Effect.gen(function* () {
      const { workspaceId, on, audit } = yield* setup;
      const chief = yield* on("chief_agent");
      yield* (yield* TelescopeDb.TelescopeDb).update(
        workspaceId,
        "agents",
        { resident_thread_id: chief.threadId },
        { agent_id: chief.agentId },
      );
      assert.deepInclude(yield* opens[tool](chief), {
        _tag: "OrchestratorMcpFailure",
        code: "capability_denied",
        message: RESIDENT,
      });
      assert.deepStrictEqual(opened, []);
      assert.deepStrictEqual(yield* audit, [["dispatch_worker", "denied", "resident"]]);
    }).pipe(Effect.provide(layer(opened)));
  },
);

it.effect("an ordinary thread's create_threads is unchanged", () => {
  const opened: Array<string> = [];
  return Effect.gen(function* () {
    const { callers, audit } = yield* setup;
    const ordinary = callers(ThreadId.make("thread-ordinary")).call;
    assert.deepStrictEqual(yield* ordinary("create_threads", threads), { threads: [] });
    assert.deepStrictEqual(opened, ["create_threads"]);
    assert.deepStrictEqual(yield* audit, []);
  }).pipe(Effect.provide(layer(opened)));
});

const FAILS_AFTER_GATEWAY = new Set(["t3_thread_send_attachments", "watch_pull_request"]);
it.effect.each([
  "t3_thread_send",
  "schedule_task update",
  "t3_thread_transfer fork",
  "t3_thread_transfer merge_back",
  "t3_thread_send_attachments",
  "delete_scheduled_task",
  "watch_pull_request",
] as const)("a Chief run's %s passes and counts one budget call", (tool) => {
  const opened: Array<string> = [];
  return Effect.gen(function* () {
    const { workspaceId, on, audit } = yield* setup;
    const chief = yield* on("chief_agent");
    const gateway = yield* ToolGateway.ToolGateway;
    const budget = { workspaceId, scope: "agent" as const, scopeId: chief.agentId };
    yield* gateway.setBudget(ann, { ...budget, limitCalls: 5 });
    // Past the gateway; some mocked service steps then fail, and the audit says so.
    assert.notPropertyVal(yield* opens[tool](chief), "code", "capability_denied");
    assert.deepStrictEqual(opened, [tool]);
    const outcome = FAILS_AFTER_GATEWAY.has(tool) ? "failed" : "allowed";
    assert.deepStrictEqual(yield* audit, [["dispatch_worker", outcome, undefined]]);
    const { budgets } = yield* gateway.governance(ann, { workspaceId });
    assert.deepStrictEqual(
      budgets.map((row) => row.usedCalls),
      [1],
    );
  }).pipe(Effect.provide(layer(opened)));
});

it.effect("a PA run's watch_pull_request on its own thread is not gated", () => {
  const opened: Array<string> = [];
  return Effect.gen(function* () {
    const { on, audit } = yield* setup;
    const pa = yield* on("chief_of_staff");
    for (const threadId of [undefined, pa.threadId])
      yield* Effect.exit(
        pa.pr("watch_pull_request", { threadId, url: "https://github.com/acme/web/pull/7" }),
      );
    assert.deepStrictEqual(opened, ["watch_pull_request", "watch_pull_request"]);
    assert.deepStrictEqual(yield* audit, []);
  }).pipe(Effect.provide(layer(opened)));
});

const peer = EnvironmentId.make("env-peer");
const pr7 = "https://github.com/acme/web/pull/7";
/**
 * One row per gated tool and input field that names an environment, set to a linked one.
 * `reaches` is where an ordinary thread's same call goes.
 */
const opensElsewhere = [
  {
    tool: "t3_thread_send",
    field: "environmentId",
    reaches: "forwarded t3_thread_send",
    call: (run: Run) =>
      run.call("t3_thread_send", { environmentId: peer, threadId: worker, message: "Go" }),
  },
  {
    tool: "schedule_task",
    field: "environmentId",
    reaches: "forwarded schedule_task",
    call: (run: Run) =>
      run.call("schedule_task", {
        environmentId: peer,
        prompt: "Fix the build",
        schedule: { type: "interval", everyMs: 60_000 },
      }),
  },
  {
    tool: "schedule_task update",
    field: "environmentId",
    reaches: "forwarded schedule_task",
    call: (run: Run) =>
      run.call("schedule_task", { environmentId: peer, scheduledTaskId: sched, enabled: true }),
  },
  {
    tool: "delete_scheduled_task",
    field: "environmentId",
    reaches: "forwarded delete_scheduled_task",
    call: (run: Run) =>
      run.call("delete_scheduled_task", { environmentId: peer, scheduledTaskId: sched }),
  },
  {
    tool: "t3_thread_launch",
    field: "environmentId",
    reaches: "forwarded t3_thread_launch",
    call: (run: Run) =>
      run.project("t3_thread_launch", {
        environmentId: peer,
        scratch: true,
        title: "Fix the build",
      }),
  },
  {
    tool: "run_scheduled_task_now",
    field: "environmentId",
    reaches: "forwarded run_scheduled_task_now",
    call: (run: Run) =>
      run.thread("run_scheduled_task_now", { environmentId: peer, taskId: sched }),
  },
  {
    tool: "t3_thread_transfer",
    field: "environmentId",
    reaches: "forwarded t3_thread_transfer",
    call: (run: Run) => run.thread("t3_thread_transfer", { environmentId: peer, action: "fork" }),
  },
  {
    tool: "watch_pull_request",
    field: "environmentId",
    reaches: "forwarded watch_pull_request",
    call: (run: Run) =>
      run
        .pr("watch_pull_request", { environmentId: peer, threadId: worker, url: pr7 })
        .pipe(Effect.catch(Effect.succeed)),
  },
  // The service, not routing, sends these to the linked environment.
  {
    tool: "delegate_task",
    field: "target.environmentId",
    reaches: "delegate_task",
    call: (run: Run) =>
      run
        .call("delegate_task", { task: "Fix the build", target: { environmentId: peer } })
        // The mocked service step returns no task, which then fails as an error.
        .pipe(Effect.catch(Effect.succeed)),
  },
  {
    tool: "create_threads",
    field: "threads[].target.environmentId",
    reaches: "create_threads",
    call: (run: Run) =>
      run.call("create_threads", {
        threads: [{ prompt: "Fix the build", target: { environmentId: peer } }],
      }),
  },
] as const;

const linkedRefusal =
  "Telescope agents cannot act on a linked environment yet. Leave out environmentId to work here.";

it.effect.each(opensElsewhere)(
  "a Telescope run's $tool naming a linked environment in $field is refused, audited, before it routes",
  ({ call, reaches }) => {
    const opened: Array<string> = [];
    return Effect.gen(function* () {
      const { workspaceId, on, callers, audit } = yield* setup;
      const chief = yield* on("chief_agent");
      assert.deepInclude(yield* call(chief), {
        _tag: "OrchestratorMcpFailure",
        code: "capability_denied",
        message: linkedRefusal,
      });
      assert.deepStrictEqual(opened, []);
      const refused = [["dispatch_worker", "denied", "linked"]];
      assert.deepStrictEqual(yield* audit, refused);
      const { calls } = yield* (yield* RunRecordService.RunRecordService).calls(ann, {
        workspaceId,
        runId: chief.runId,
      });
      assert.deepStrictEqual(
        calls.map((row) => [row.tool, row.grantCheck]),
        [["dispatch_worker", "denied"]],
      );
      yield* call(callers(ThreadId.make("thread-ordinary")));
      assert.deepStrictEqual(opened, [reaches]);
      assert.deepStrictEqual(yield* audit, refused);
    }).pipe(Effect.provide(layer(opened)));
  },
);

/** Every `environmentId` an input of this schema can carry, by path. */
const environmentFields = (ast: SchemaAST.AST): ReadonlyArray<string> => {
  switch (ast._tag) {
    case "Objects":
      return ast.propertySignatures.flatMap(({ name, type }) =>
        name === "environmentId"
          ? ["environmentId"]
          : environmentFields(type).map((path) => `${String(name)}.${path}`),
      );
    case "Arrays":
      return [...ast.elements, ...ast.rest].flatMap(environmentFields).map((path) => `[].${path}`);
    case "Union":
      return ast.types.flatMap(environmentFields);
    default:
      return [];
  }
};

it("every environment a gated tool's input can name has a linked-environment row", () => {
  const gated = [
    OrchestratorToolkit,
    ThreadToolkit,
    ProjectToolkit,
    AttachmentToolkit,
    PullRequestsToolkit,
  ]
    .flatMap((toolkit) => Object.values<Tool.Any>(toolkit.tools))
    .filter((tool) => Gate.dispatchesWork(tool.name));
  assert.deepStrictEqual(
    new Set(gated.map((tool) => tool.name)),
    new Set(Object.keys(opens).map((key) => key.split(" ")[0])),
  );
  // Where a delegated task came from, not where it runs (its `opens` row stays local).
  const origins = new Set(["t3_thread_launch delegatedFrom.environmentId"]);
  const named = gated
    .flatMap((tool) =>
      environmentFields(tool.parametersSchema.ast).map(
        (field) => `${tool.name} ${field.replaceAll(".[]", "[]")}`,
      ),
    )
    .filter((field) => !origins.has(field));
  assert.deepStrictEqual(
    new Set(named),
    new Set(opensElsewhere.map(({ tool, field }) => `${tool.split(" ")[0]} ${field}`)),
  );
});

it.effect("a Telescope run's reads still route to a linked environment", () => {
  const opened: Array<string> = [];
  return Effect.gen(function* () {
    const pa = yield* (yield* setup).on("chief_of_staff");
    yield* Effect.exit(pa.thread("t3_thread_transfer", { environmentId: peer, action: "status" }));
    yield* Effect.exit(pa.call("t3_thread_list", { environmentId: peer }));
    assert.deepStrictEqual(opened, ["forwarded t3_thread_transfer", "forwarded t3_thread_list"]);
  }).pipe(Effect.provide(layer(opened)));
});
