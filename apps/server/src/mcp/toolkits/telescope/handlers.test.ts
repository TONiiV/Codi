import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import { runMigrations } from "../../../persistence/Migrations.ts";
import * as SqlitePersistence from "../../../persistence/Sqlite.ts";
import * as AgentService from "../../../telescope/AgentService.ts";
import * as GrantService from "../../../telescope/GrantService.ts";
import type * as MemoryService from "../../../telescope/MemoryService.ts";
import * as RunRecordService from "../../../telescope/RunRecordService.ts";
import * as TaskBoardService from "../../../telescope/TaskBoardService.ts";
import * as TelescopeDb from "../../../telescope/TelescopeDb.ts";
import * as ToolGateway from "../../../telescope/ToolGateway.ts";
import * as WorkspaceService from "../../../telescope/WorkspaceService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import * as TelescopeHandlers from "./handlers.ts";
import { TelescopeToolkit } from "./tools.ts";

const services = Layer.mergeAll(
  ToolGateway.layer,
  GrantService.layer,
  RunRecordService.layer,
  AgentService.layer,
  TaskBoardService.layer,
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
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env-local")),
    }),
  ),
);
const layer = McpToolAccess.HandlersLayer.layer(TelescopeHandlers.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(services, liveThreadsLayer)),
);

const session = (name: string): WorkspaceService.SessionCaller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const ann = session("ann");
const snapshot = {
  promptVersion: "prompt@1",
  skillsVersions: {},
  powersVersion: "powers@1",
  model: "model-a",
  contextManifest: [],
};
type Tools = (typeof TelescopeToolkit)["tools"];

/** Ann's workspace with a run of her chief of staff on its own thread. */
const setup = Effect.gen(function* () {
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const { id: workspaceId } = yield* workspaces.create(ann, {
    kind: "personal",
    name: "Acme",
    displayName: "Ann",
  });
  const { agents } = yield* (yield* AgentService.AgentService).listMine(ann, { workspaceId });
  const chief = agents.find((agent) => agent.kind === "chief_of_staff");
  assert.isDefined(chief);
  const threadId = ThreadId.make(`thread-${workspaceId}`);
  yield* (yield* RunRecordService.RunRecordService).start(ann, workspaceId, {
    agentId: chief.id,
    threadId,
    inputSnapshot: snapshot,
  });
  const toolkit = yield* TelescopeToolkit;
  const call = <Name extends keyof Tools & string>(
    name: Name,
    params: Tool.Parameters<Tools[Name]>,
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((out) => out.at(-1)?.result),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("env-local"),
        requestNamespace: "provider:telescope",
        thread: {
          threadId,
          providerSessionId: "provider:telescope",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
    );
  return { workspaceId, chief, call, db: yield* TelescopeDb.TelescopeDb };
});

/** One call of every tool, so each scenario below covers the whole toolkit. */
const everyTool = (
  call: Effect.Success<typeof setup>["call"],
  ids: { readonly taskId: string; readonly leaseId: string },
) => {
  const taskId = Telescope.TaskId.make(ids.taskId);
  const leaseId = Telescope.LeaseId.make(ids.leaseId);
  return Effect.all([
    call("ticket_list", {}),
    call("ticket_get", { taskId }),
    call("open_ticket", { title: "Ship the sample" }),
    call("ticket_update", { taskId, baseVersion: 1, note: "Started" }),
    call("ticket_lease", { taskId }),
    call("ticket_lease_renew", { leaseId }),
    call("ticket_lease_release", { leaseId }),
    call("decision_list", {}),
    call("decision_record", { title: "Ship Friday", text: "Agreed with Bob." }),
    call("agent_list", {}),
  ]);
};
const TOOL_COUNT = Object.keys(TelescopeToolkit.tools).length;

const deniedWith = (results: ReadonlyArray<unknown>, message: string) => {
  assert.strictEqual(results.length, TOOL_COUNT);
  for (const result of results)
    assert.deepInclude(result, {
      _tag: "OrchestratorMcpFailure",
      code: "capability_denied",
      message: `${message} Do not retry; tell your member.`,
    });
};

it.effect("works the board as the run's agent through every Telescope tool", () =>
  Effect.gen(function* () {
    const { workspaceId, chief, call } = yield* setup;
    const opened = yield* call("open_ticket", { title: "Ship the sample", goalChain: ["Q4"] });
    assert.deepInclude(opened, { title: "Ship the sample", workspaceId, version: 1 });
    const taskId = (opened as Telescope.Task).id;

    assert.deepStrictEqual(
      ((yield* call("ticket_list", {})) as typeof Telescope.TaskListResult.Type).tasks.map(
        (task) => task.id,
      ),
      [taskId],
    );
    const updated = yield* call("ticket_update", { taskId, baseVersion: 1, note: "Started" });
    assert.deepStrictEqual((updated as Telescope.Task).freeText.at(-1)?.authorId, chief.id);
    const got = (yield* call("ticket_get", { taskId })) as Telescope.Task;
    assert.strictEqual(got.version, 2);

    const lease = (yield* call("ticket_lease", { taskId })) as Telescope.Lease;
    assert.deepInclude(lease, { taskId, holderAgentId: chief.id });
    assert.deepInclude(yield* call("ticket_lease", { taskId }), { code: "invalid_request" });
    assert.deepInclude(yield* call("ticket_lease_renew", { leaseId: lease.id }), {
      id: lease.id,
    });
    assert.deepStrictEqual(yield* call("ticket_lease_release", { leaseId: lease.id }), {});

    const decision = yield* call("decision_record", { title: "Ship Friday", text: "Agreed." });
    assert.deepInclude(decision, { status: "decided", authorId: chief.id });
    assert.deepStrictEqual(
      (
        (yield* call("decision_list", {})) as typeof Telescope.DecisionListResult.Type
      ).decisions.map((item) => item.title),
      ["Ship Friday"],
    );
    const { agents } = (yield* call("agent_list", {})) as typeof Telescope.AgentListResult.Type;
    assert.include(
      agents.map((agent) => agent.id),
      chief.id,
    );

    const board = yield* TaskBoardService.TaskBoardService;
    const member = { caller: ann };
    const { version } = yield* board.getTask(member, { workspaceId, taskId });
    yield* board.updateTask(member, {
      workspaceId,
      taskId,
      baseVersion: version,
      set: { title: "Ann v2" },
    });
    const stale = (yield* call("ticket_update", {
      taskId,
      baseVersion: version,
      set: { title: "Agent title" },
    })) as typeof Telescope.TaskUpdateResult.Type;
    const conflictId = stale.conflict?.decisionId;
    assert.isDefined(conflictId);
    const memberOnly = {
      code: "capability_denied",
      message: "Only a member settles or replaces a proposal. Leave a note or tell your member.",
    };
    assert.deepInclude(
      yield* call("decision_record", {
        title: "Take the agent's title",
        text: "-",
        supersedes: conflictId,
        chosen: "incoming",
      }),
      memberOnly,
    );
    assert.deepInclude(
      yield* call("decision_record", {
        title: "Keep Ann's title",
        text: "Recommend keeping it.",
        status: "proposed",
        supersedes: conflictId,
      }),
      memberOnly,
    );
    yield* board.createDecision(member, {
      workspaceId,
      title: "Keep",
      text: "-",
      supersedes: conflictId,
      chosen: "keep",
    });
    const settled = yield* board.getTask(member, { workspaceId, taskId });
    assert.deepStrictEqual([settled.title, settled.conflictDecisionId], ["Ann v2", undefined]);

    const { entries } = yield* (yield* GrantService.GrantService).auditList(ann, { workspaceId });
    assert.deepStrictEqual(
      entries.map((entry) => entry.outcome).toSorted(),
      Array.from({ length: entries.length }, () => "allowed"),
    );
    assert.strictEqual(entries.length, TOOL_COUNT + 4, "every call is audited");

    yield* (yield* SqlClient.SqlClient)`DROP TABLE telescope_tasks`;
    assert.deepInclude(yield* call("ticket_list", {}), {
      code: "orchestration_error",
      message: "The Telescope board is unavailable.",
    });
  }).pipe(Effect.provide(layer)),
);

it.effect("refuses every tool when the agent's grant lacks openTickets", () =>
  Effect.gen(function* () {
    const { workspaceId, chief, call, db } = yield* setup;
    const powers = { ...chief.standingPowers, openTickets: false };
    yield* db.update(
      workspaceId,
      "agents",
      { standing_powers_json: JSON.stringify(powers) },
      { agent_id: chief.id },
    );
    deniedWith(
      yield* everyTool(call, { taskId: "task-1", leaseId: "lease-1" }),
      "The agent's grant does not allow this tool.",
    );
    const board = yield* TaskBoardService.TaskBoardService;
    assert.deepStrictEqual(yield* board.listTasks({ caller: ann }, { workspaceId }), { tasks: [] });
  }).pipe(Effect.provide(layer)),
);

it.effect("refuses every tool once an admin stops the agent", () =>
  Effect.gen(function* () {
    const { workspaceId, chief, call } = yield* setup;
    const gateway = yield* ToolGateway.ToolGateway;
    yield* gateway.setKillSwitch(ann, { workspaceId, agentId: chief.id, state: "paused" });
    deniedWith(
      yield* everyTool(call, { taskId: "task-1", leaseId: "lease-1" }),
      "An admin stopped this agent.",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("refuses every tool once the agent's call budget is spent", () =>
  Effect.gen(function* () {
    const { workspaceId, chief, call } = yield* setup;
    const gateway = yield* ToolGateway.ToolGateway;
    yield* gateway.setBudget(ann, {
      workspaceId,
      scope: "agent",
      scopeId: chief.id,
      limitCalls: 1,
    });
    assert.deepInclude(yield* call("ticket_list", {}), { tasks: [] });
    deniedWith(
      yield* everyTool(call, { taskId: "task-1", leaseId: "lease-1" }),
      "A Telescope budget is used up. Level: agent.",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("never reaches another workspace's board", () =>
  Effect.gen(function* () {
    const { call } = yield* setup;
    const bea = session("bea");
    const workspaces = yield* WorkspaceService.WorkspaceService;
    const { id: other } = yield* workspaces.create(bea, {
      kind: "personal",
      name: "Other",
      displayName: "Bea",
    });
    const board = yield* TaskBoardService.TaskBoardService;
    const foreign = yield* board.createTask(
      { caller: bea },
      { workspaceId: other, title: "Secret" },
    );
    yield* board.createDecision(
      { caller: bea },
      { workspaceId: other, title: "Hidden", text: "-" },
    );
    const { agents: foreignAgents } = yield* (yield* AgentService.AgentService).listMine(bea, {
      workspaceId: other,
    });

    assert.deepStrictEqual(yield* call("ticket_list", {}), { tasks: [] });
    assert.deepStrictEqual(yield* call("decision_list", {}), { decisions: [] });
    for (const result of [
      yield* call("ticket_get", { taskId: foreign.id }),
      yield* call("ticket_update", { taskId: foreign.id, baseVersion: 1, note: "x" }),
      yield* call("ticket_lease", { taskId: foreign.id }),
    ])
      assert.deepInclude(result, { code: "invalid_request", message: "Task not found." });
    const { agents } = (yield* call("agent_list", {})) as typeof Telescope.AgentListResult.Type;
    const visible = new Set(agents.map((agent) => agent.id));
    assert.isFalse(foreignAgents.some((agent) => visible.has(agent.id)));
  }).pipe(Effect.provide(layer)),
);

// `@ts-expect-error` fails the build if a run caller ever compiles here. Never called.
export const runsRefusedAtCompileTime = (
  run: ToolGateway.ToolCaller,
  grants: GrantService.GrantService["Service"],
  agents: AgentService.AgentService["Service"],
  memory: MemoryService.MemoryService["Service"],
) => {
  const { workspaceId, agentId } = run;
  const projectId = ProjectId.make("project-x");
  const powers = { openTickets: true, dispatchWorkers: true, answerMembers: true, mergePRs: true };
  return [
    agents.listMine(run, { workspaceId }),
    // @ts-expect-error a run reads the audit
    grants.auditList(run, { workspaceId }),
    // @ts-expect-error a run caps a project's powers
    grants.setProjectRule(run, { workspaceId, projectId, powers, routing: null }),
    // @ts-expect-error a run creates an agent
    agents.createCustom(run, { workspaceId, name: "Helper" }),
    // @ts-expect-error a run raises its own agent's powers
    agents.update(run, { workspaceId, agentId, standingPowers: powers }),
    // @ts-expect-error a run configures a company agent
    agents.updateCompany(run, { workspaceId, agentId, name: "HR" }),
    // @ts-expect-error a run passes for a member's session
    memory.search({ session: run }, { workspaceId, query: "plan" }),
  ];
};
