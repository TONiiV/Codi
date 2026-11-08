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
import * as ServerSettings from "../../../serverSettings.ts";
import { runMigrations } from "../../../persistence/Migrations.ts";
import * as SqlitePersistence from "../../../persistence/Sqlite.ts";
import * as AgentService from "../../../telescope/AgentService.ts";
import * as DelegationService from "../../../telescope/DelegationService.ts";
import * as GrantService from "../../../telescope/GrantService.ts";
import type * as MemoryService from "../../../telescope/MemoryService.ts";
import * as RoutingService from "../../../telescope/RoutingService.ts";
import * as RunRecordService from "../../../telescope/RunRecordService.ts";
import * as TaskBoardService from "../../../telescope/TaskBoardService.ts";
import * as TelescopeDb from "../../../telescope/TelescopeDb.ts";
import * as ToolGateway from "../../../telescope/ToolGateway.ts";
import * as WakeQueueService from "../../../telescope/WakeQueueService.ts";
import * as WorkerDispatch from "../../../telescope/WorkerDispatch.ts";
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
  DelegationService.layer,
  WakeQueueService.layer,
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
// Opening Workers is covered by WorkerDispatch.integration.test.ts; cancel runs for real here.
const workers = WorkerDispatch.layer.pipe(
  Layer.provide(Layer.mock(RoutingService.RoutingService)({})),
  Layer.provide(ServerSettings.layerTest()),
);
const layer = McpToolAccess.HandlersLayer.layer(TelescopeHandlers.layer).pipe(
  Layer.provideMerge(workers),
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
const brief = {
  goal: "修好夹爪固件的超时 bug",
  constraints: ["不改硬件接口"],
  acceptance: ["回归测试通过"],
  goalChain: ["夹爪项目"],
};
const done = { result: "已修复，见 Worker 线程", decisions: [] };

/** Starts a run of `agentId` on its own thread and returns a caller of that thread's tools. */
const runOn = Effect.fn(function* (
  workspaceId: Telescope.WorkspaceId,
  agentId: Telescope.AgentId,
  via?: ReadonlyArray<Telescope.AgentId>,
  threadId = ThreadId.make(`thread-${agentId}`),
) {
  yield* (yield* RunRecordService.RunRecordService).start(ann, workspaceId, {
    agentId,
    threadId,
    inputSnapshot: snapshot,
    ...(via === undefined ? {} : { via }),
  });
  const toolkit = yield* TelescopeToolkit;
  return <Name extends keyof Tools & string>(name: Name, params: Tool.Parameters<Tools[Name]>) =>
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
});

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
  const call = yield* runOn(workspaceId, chief.id);
  return { workspaceId, chief, call, db: yield* TelescopeDb.TelescopeDb };
});

/** One call of every tool, so each scenario below covers the whole toolkit. */
const everyTool = (
  call: Effect.Success<typeof setup>["call"],
  ids: { readonly taskId: string; readonly leaseId: string },
) => {
  const taskId = Telescope.TaskId.make(ids.taskId);
  const leaseId = Telescope.LeaseId.make(ids.leaseId);
  const delegationId = Telescope.DelegationId.make("delegation-1");
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
    call("delegate", { toAgentId: Telescope.AgentId.make("agent-1"), brief }),
    call("delegation_list", {}),
    call("delegation_report", { delegationId, state: "COMPLETED", report: done }),
    call("delegation_cancel", { delegationId }),
    call("dispatch_worker", { delegationId, brief }),
  ]);
};
const TOOL_COUNT = Object.keys(TelescopeToolkit.tools).length;

/** `dispatchWorker`: the PA's own refusal of the last call, where it comes before `message`. */
const deniedWith = (results: ReadonlyArray<unknown>, message: string, dispatchWorker = message) => {
  assert.strictEqual(results.length, TOOL_COUNT);
  results.forEach((result, index) =>
    assert.deepInclude(result, {
      _tag: "OrchestratorMcpFailure",
      code: "capability_denied",
      message: `${index === TOOL_COUNT - 1 ? dispatchWorker : message} Do not retry; tell your member.`,
    }),
  );
};

it.effect("works the board as the run's agent through every board tool", () =>
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
    const renamed = yield* board.updateTask(member, {
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
    const { self } = yield* (yield* WorkspaceService.WorkspaceService).get(ann, { workspaceId });
    assert.deepStrictEqual(
      [stale.title, stale.overwrote],
      ["Agent title", [{ key: "title", by: self.subjectId, name: "Ann", at: renamed.updatedAt }]],
    );
    const { id: proposalId } = yield* board.createDecision(member, {
      workspaceId,
      title: "Rename it back",
      text: "-",
      status: "proposed",
    });
    const memberOnly = {
      code: "capability_denied",
      message: "Only a member settles or replaces a proposal. Leave a note or tell your member.",
    };
    assert.deepInclude(
      yield* call("decision_record", {
        title: "Take the agent's title",
        text: "-",
        supersedes: proposalId,
        chosen: "incoming",
      }),
      memberOnly,
    );
    assert.deepInclude(
      yield* call("decision_record", {
        title: "Keep Ann's title",
        text: "Recommend keeping it.",
        status: "proposed",
        supersedes: proposalId,
      }),
      memberOnly,
    );
    yield* board.createDecision(member, {
      workspaceId,
      title: "Keep",
      text: "-",
      supersedes: proposalId,
      chosen: "keep",
    });
    const settled = yield* board.getTask(member, { workspaceId, taskId });
    assert.deepStrictEqual([settled.title, settled.conflictDecisionId], ["Agent title", undefined]);

    const { entries } = yield* (yield* GrantService.GrantService).auditList(ann, { workspaceId });
    assert.deepStrictEqual(
      entries.map((entry) => entry.outcome).toSorted(),
      Array.from({ length: entries.length }, () => "allowed"),
    );
    assert.strictEqual(entries.length, 14, "every call is audited");

    yield* (yield* SqlClient.SqlClient)`DROP TABLE telescope_tasks`;
    assert.deepInclude(yield* call("ticket_list", {}), {
      code: "orchestration_error",
      message: "Telescope is unavailable.",
    });
  }).pipe(Effect.provide(layer)),
);

it.effect("refuses every tool when the agent's grant lacks the tool's power", () =>
  Effect.gen(function* () {
    const { workspaceId, chief, call, db } = yield* setup;
    const grant = (powers: Partial<Telescope.StandingPowers>) =>
      db.update(
        workspaceId,
        "agents",
        { standing_powers_json: JSON.stringify({ ...chief.standingPowers, ...powers }) },
        { agent_id: chief.id },
      );
    yield* grant({ dispatchWorkers: false });
    const delegationId = Telescope.DelegationId.make("delegation-1");
    for (const result of [
      yield* call("delegate", { toAgentId: chief.id, brief }),
      yield* call("delegation_cancel", { delegationId }),
    ])
      assert.deepInclude(result, {
        message: "The agent's grant does not allow this tool. Do not retry; tell your member.",
      });
    yield* grant({ openTickets: false, dispatchWorkers: false });
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
      "Only a project's agent opens Worker threads. Hand the work to its Chief Agent with `delegate`.",
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

/** Ann's PA and her Chief Agent of `web`, each with a run; the Chief's run acts through the PA. */
const chain = Effect.gen(function* () {
  const { workspaceId, chief: pa, call, db } = yield* setup;
  yield* (yield* WorkspaceService.WorkspaceService).bind(ann, {
    workspaceId,
    environmentId: EnvironmentId.make("env-elsewhere"),
    projectId: ProjectId.make("project-web"),
  });
  const { agents } = yield* (yield* AgentService.AgentService).listMine(ann, { workspaceId });
  const chief = agents.find((agent) => agent.kind === "chief_agent");
  assert.isDefined(chief);
  const delegations = yield* DelegationService.DelegationService;
  const get = (delegationId: Telescope.DelegationId) =>
    delegations.get({ workspaceId, delegationId }).pipe(Effect.map((row) => row.state));
  return {
    workspaceId,
    db,
    pa: { id: pa.id, call },
    chief: { id: chief.id, call: yield* runOn(workspaceId, chief.id, [pa.id]) },
    delegations,
    get,
    queue: yield* WakeQueueService.WakeQueueService,
  };
});
const refused = (message: string) =>
  ({ _tag: "OrchestratorMcpFailure", code: "capability_denied", message }) as const;

it.effect("delegate from the PA creates a delegation for its own Chief and a wake", () =>
  Effect.gen(function* () {
    const { workspaceId, db, pa, chief, delegations, queue } = yield* chain;
    yield* db.insert(workspaceId, "delegations", {
      delegation_id: "bea-pa-to-bea-chief",
      context_id: "context-bea",
      parent_id: null,
      from_agent_id: "bea-pa",
      to_agent_id: "bea-chief",
      hop: "agent",
      thread_id: null,
      decision_id: null,
      state: "SUBMITTED",
      brief_json: JSON.stringify(brief),
      report_json: null,
      messages_json: "[]",
      artifacts_json: "[]",
      created_at: "2026-11-07T00:00:00.000Z",
      updated_at: "2026-11-07T00:00:00.000Z",
    });
    const sent = (yield* pa.call("delegate", {
      toAgentId: chief.id,
      brief,
    })) as Telescope.Delegation;
    assert.deepInclude(sent, {
      workspaceId,
      fromAgentId: pa.id,
      toAgentId: chief.id,
      hop: "agent",
      state: "SUBMITTED",
      brief,
    });
    assert.notProperty(sent, "messages");
    const dispatch = yield* queue.take;
    assert.deepInclude(dispatch.wake, {
      reason: "dispatch",
      agentId: chief.id,
      coalesceKey: `delegation:${sent.id}`,
    });
    assert.deepStrictEqual(dispatch.payloads, [{ kind: "delegation", delegationId: sent.id }]);
    yield* queue.finish(dispatch.wake, "done");

    const ids = (result: unknown) =>
      (result as { readonly delegations: ReadonlyArray<Telescope.Delegation> }).delegations.map(
        (row) => row.id,
      );
    assert.deepStrictEqual(ids(yield* pa.call("delegation_list", {})), [sent.id]);
    assert.deepStrictEqual(ids(yield* chief.call("delegation_list", {})), [sent.id]);

    yield* delegations.start({ workspaceId, delegationId: sent.id });
    assert.deepInclude(
      yield* chief.call("delegation_report", {
        delegationId: sent.id,
        state: "COMPLETED",
        report: done,
      }),
      { state: "COMPLETED", report: done },
    );
    const report = yield* queue.take;
    assert.deepInclude(report.wake, {
      agentId: pa.id,
      coalesceKey: `delegation:${sent.id}:report`,
    });

    const unwanted = (yield* pa.call("delegate", {
      toAgentId: chief.id,
      brief,
    })) as Telescope.Delegation;
    assert.deepStrictEqual(yield* pa.call("delegation_cancel", { delegationId: unwanted.id }), {
      canceled: [unwanted.id],
    });
    const { entries } = yield* (yield* GrantService.GrantService).auditList(ann, { workspaceId });
    assert.deepStrictEqual(entries.map((entry) => [entry.tool, entry.outcome]).toSorted(), [
      ["delegate", "allowed"],
      ["delegate", "allowed"],
      ["delegation_cancel", "allowed"],
      ["delegation_list", "allowed"],
      ["delegation_list", "allowed"],
      ["delegation_report", "allowed"],
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("delegate to another member's agent is not found", () =>
  Effect.gen(function* () {
    const { workspaceId, db, pa, chief, queue } = yield* chain;
    const agent = (id: string, owner: string | null, kind: Telescope.AgentKind) =>
      db.insert(workspaceId, "agents", {
        agent_id: id,
        owner_subject_id: owner,
        kind,
        project_id: "project-web",
        name: id,
        model_selection_json: null,
        standing_powers_json: "{}",
        exposure: "visible",
        sync_with_board: 1,
        dispatch_mode: "start",
        channels_json: "[]",
        created_at: "2026-11-07T00:00:00.000Z",
        updated_at: "2026-11-07T00:00:00.000Z",
      });
    yield* agent("bea-chief", "bea", "chief_agent");
    yield* agent("company-it", null, "department");
    for (const toAgentId of ["bea-chief", "company-it", "agent-missing"])
      assert.deepInclude(
        yield* pa.call("delegate", { toAgentId: Telescope.AgentId.make(toAgentId), brief }),
        { code: "invalid_request", message: "Agent not found." },
      );
    yield* (yield* WorkspaceService.WorkspaceService).bind(ann, {
      workspaceId,
      environmentId: EnvironmentId.make("env-elsewhere"),
      projectId: ProjectId.make("project-app"),
    });
    const { agents } = yield* (yield* AgentService.AgentService).listMine(ann, { workspaceId });
    const sibling = agents.find((row) => row.kind === "chief_agent" && row.id !== chief.id);
    assert.isDefined(sibling);
    for (const toAgentId of [sibling.id, chief.id])
      assert.deepInclude(
        yield* chief.call("delegate", { toAgentId, brief }),
        refused(
          "Only an agent without a project hands work to a Chief Agent. Do your own project's work with your Workers (`dispatch_worker`); report work outside your project back with `delegation_report`.",
        ),
      );
    assert.isUndefined(yield* queue.dequeue);
    assert.deepStrictEqual(yield* pa.call("delegation_list", {}), { delegations: [] });
  }).pipe(Effect.provide(layer)),
);

it.effect("delegation_report by the from-agent is refused", () =>
  Effect.gen(function* () {
    const { workspaceId, pa, chief, delegations, get } = yield* chain;
    const sent = (yield* pa.call("delegate", {
      toAgentId: chief.id,
      brief,
    })) as Telescope.Delegation;
    yield* delegations.start({ workspaceId, delegationId: sent.id });
    assert.deepInclude(
      yield* pa.call("delegation_report", {
        delegationId: sent.id,
        state: "COMPLETED",
        report: done,
      }),
      refused("Only the agent a task was delegated to reports on it."),
    );
    assert.strictEqual(yield* get(sent.id), "WORKING");
  }).pipe(Effect.provide(layer)),
);

it.effect("a stopped Chief's delegation_report is refused (kill switch along the chain, D48)", () =>
  Effect.gen(function* () {
    const { workspaceId, pa, chief, delegations, get } = yield* chain;
    const sent = (yield* pa.call("delegate", {
      toAgentId: chief.id,
      brief,
    })) as Telescope.Delegation;
    yield* delegations.start({ workspaceId, delegationId: sent.id });
    const gateway = yield* ToolGateway.ToolGateway;
    const stopped = refused("An admin stopped this agent. Do not retry; tell your member.");
    const reportDone = chief.call("delegation_report", {
      delegationId: sent.id,
      state: "COMPLETED",
      report: done,
    });
    for (const agentId of [chief.id, pa.id]) {
      yield* gateway.setKillSwitch(ann, { workspaceId, agentId, state: "paused" });
      assert.deepInclude(yield* reportDone, stopped);
      assert.strictEqual(yield* get(sent.id), "WORKING");
      yield* gateway.setKillSwitch(ann, { workspaceId, agentId, state: "running" });
    }
    assert.deepInclude(yield* reportDone, { state: "COMPLETED" });
  }).pipe(Effect.provide(layer)),
);

it.effect("delegation_cancel from the to-agent is refused", () =>
  Effect.gen(function* () {
    const { pa, chief, get } = yield* chain;
    const sent = (yield* pa.call("delegate", {
      toAgentId: chief.id,
      brief,
    })) as Telescope.Delegation;
    assert.deepInclude(
      yield* chief.call("delegation_cancel", { delegationId: sent.id }),
      refused("Only the agent that sent a task cancels it."),
    );
    assert.strictEqual(yield* get(sent.id), "SUBMITTED");
  }).pipe(Effect.provide(layer)),
);

it.effect("a Worker run is refused every Telescope tool, and each refusal is audited", () =>
  Effect.gen(function* () {
    const { workspaceId, db, pa, chief, delegations } = yield* chain;
    const sent = (yield* pa.call("delegate", {
      toAgentId: chief.id,
      brief,
    })) as Telescope.Delegation;
    yield* delegations.start({ workspaceId, delegationId: sent.id });
    const threadId = ThreadId.make("thread-worker");
    yield* db.insert(workspaceId, "delegations", {
      delegation_id: "worker-1",
      context_id: "context-worker",
      parent_id: sent.id,
      from_agent_id: chief.id,
      to_agent_id: chief.id,
      hop: "worker",
      thread_id: threadId,
      decision_id: null,
      state: "WORKING",
      brief_json: JSON.stringify(brief),
      report_json: null,
      messages_json: "[]",
      artifacts_json: "[]",
      created_at: "2026-11-07T00:00:00.000Z",
      updated_at: "2026-11-07T00:00:00.000Z",
    });
    const worker = yield* runOn(workspaceId, chief.id, [pa.id], threadId);
    const results = yield* everyTool(worker, { taskId: "task-1", leaseId: "lease-1" });
    assert.strictEqual(results.length, TOOL_COUNT);
    for (const result of results)
      assert.deepInclude(
        result,
        refused("A Worker reports through its thread; Telescope tools are not for Workers."),
      );
    const { entries } = yield* (yield* GrantService.GrantService).auditList(ann, { workspaceId });
    assert.strictEqual(entries.filter((entry) => entry.outcome === "denied").length, TOOL_COUNT);
    // The Chief's own thread keeps its tools.
    assert.property(yield* chief.call("delegation_list", {}), "delegations");
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
