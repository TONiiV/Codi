import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  type Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import { runMigrations } from "../../../persistence/Migrations.ts";
import * as SqlitePersistence from "../../../persistence/Sqlite.ts";
import * as AgentService from "../../../telescope/AgentService.ts";
import * as GrantService from "../../../telescope/GrantService.ts";
import * as RunRecordService from "../../../telescope/RunRecordService.ts";
import * as TelescopeDb from "../../../telescope/TelescopeDb.ts";
import * as ToolGateway from "../../../telescope/ToolGateway.ts";
import * as WorkspaceService from "../../../telescope/WorkspaceService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
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
  McpToolAccess.HandlersLayer.layer(OrchestratorHandlers.layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        services,
        liveThreadsLayer,
        Layer.mock(OrchestratorMcpService.OrchestratorMcpService)({
          createThreads: () => Effect.sync(() => (opened.push("create_threads"), { threads: [] })),
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
const ALL: Telescope.StandingPowers = {
  openTickets: true,
  dispatchWorkers: true,
  answerMembers: true,
  mergePRs: true,
};
type Tools = (typeof OrchestratorToolkit)["tools"];

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
  const toolkit = yield* OrchestratorToolkit;
  const callOn =
    (threadId: ThreadId) =>
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
    return { agentId: agent.id, call: callOn(threadId) };
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

it.effect("a PA run calling create_threads is denied by the gateway and opens no thread", () => {
  const opened: Array<string> = [];
  return Effect.gen(function* () {
    const { on, audit } = yield* setup;
    const pa = yield* on("chief_of_staff");
    assert.deepInclude(yield* pa.call("create_threads", threads), {
      _tag: "OrchestratorMcpFailure",
      code: "capability_denied",
      message:
        "Only a project's agent opens Worker threads. Delegate to its Chief Agent instead. Do not retry; tell your member.",
    });
    assert.deepStrictEqual(opened, []);
    assert.deepStrictEqual(yield* audit, [
      [
        "dispatch_worker",
        "denied",
        "Only a project's agent opens Worker threads. Delegate to its Chief Agent instead.",
      ],
    ]);
  }).pipe(Effect.provide(layer(opened)));
});

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

it.effect("a Chief run's t3_thread_send passes and counts one budget call", () => {
  const opened: Array<string> = [];
  return Effect.gen(function* () {
    const { workspaceId, on, audit } = yield* setup;
    const chief = yield* on("chief_agent");
    const gateway = yield* ToolGateway.ToolGateway;
    const budget = { workspaceId, scope: "agent" as const, scopeId: chief.agentId };
    yield* gateway.setBudget(ann, { ...budget, limitCalls: 5 });
    const worker = ThreadId.make("thread-worker");
    assert.deepInclude(yield* chief.call("t3_thread_send", { threadId: worker, message: "Go" }), {
      threadId: worker,
      delivery: "started",
    });
    assert.deepStrictEqual(opened, ["t3_thread_send"]);
    assert.deepStrictEqual(yield* audit, [["dispatch_worker", "allowed", undefined]]);
    const { budgets } = yield* gateway.governance(ann, { workspaceId });
    assert.deepStrictEqual(
      budgets.map((row) => row.usedCalls),
      [1],
    );
  }).pipe(Effect.provide(layer(opened)));
});
