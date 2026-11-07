import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { EnvironmentId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as DelegationService from "./DelegationService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.merge(DelegationService.layer, TelescopeDb.layer).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env-test")),
    }),
  ),
);

const at = "2026-11-07T00:00:00.000Z";
const ws = Telescope.WorkspaceId.make("ws-a");
const otherWs = Telescope.WorkspaceId.make("ws-b");
const pa = Telescope.AgentId.make("pa");
const chief = Telescope.AgentId.make("chief");
const beaChief = Telescope.AgentId.make("bea-chief");
const workerThread = ThreadId.make("thread-worker");
const brief = {
  goal: "推进夹爪项目",
  constraints: ["不改硬件接口"],
  acceptance: ["样品可演示"],
  goalChain: ["夹爪项目", "公司交付目标"],
};
const actor = (agentId: Telescope.AgentId): DelegationService.Actor => ({
  workspaceId: ws,
  memberId: "ann",
  agentId,
  onBehalfOf: agentId === pa ? ["ann"] : ["ann", pa],
  runId: Telescope.AgentRunId.make(`run-${agentId}`),
});
const ann: DelegationService.MemberActor = { workspaceId: ws, memberId: "ann" };
const done = { result: "样品已演示", decisions: [] };

const WakeRow = Schema.Struct({
  agent_id: Schema.String,
  coalesce_key: Schema.String,
  status: Schema.String,
  project_id: Schema.NullOr(Schema.String),
  payload_json: Schema.fromJsonString(Schema.Json),
});
const decodeWakes = Schema.decodeUnknownEffect(Schema.Array(WakeRow));
const wakes = (where: Readonly<Record<string, string>> = {}) =>
  TelescopeDb.TelescopeDb.use((db) => db.select(ws, "wakes", decodeWakes, where));

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);
const failure = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flip(effect).pipe(
    Effect.map((error) => (isWorkspaceError(error) ? error.reason : error._tag)),
  );

const setup = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const agent = (id: string, owner: string, kind: Telescope.AgentKind, projectId: string | null) =>
    db.insert(ws, "agents", {
      agent_id: id,
      owner_subject_id: owner,
      kind,
      project_id: projectId,
      name: id,
      model_selection_json: null,
      standing_powers_json: "{}",
      exposure: "visible",
      sync_with_board: 1,
      dispatch_mode: "start",
      channels_json: "[]",
      created_at: at,
      updated_at: at,
    });
  yield* agent(pa, "ann", "chief_of_staff", null);
  yield* agent(chief, "ann", "chief_agent", "project-gripper");
  yield* agent(beaChief, "bea", "chief_agent", "project-gripper");
  yield* db.insert(ws, "members", {
    subject_id: "bea",
    display_name: "bea",
    role: "admin",
    joined_at: at,
  });
  return yield* DelegationService.DelegationService;
});

const STATES = Telescope.A2ATaskState.literals;
const ALLOWED = new Set([
  "SUBMITTED>WORKING",
  "SUBMITTED>REJECTED",
  "SUBMITTED>CANCELED",
  "WORKING>INPUT_REQUIRED",
  "WORKING>AUTH_REQUIRED",
  "WORKING>COMPLETED",
  "WORKING>FAILED",
  "WORKING>CANCELED",
  "INPUT_REQUIRED>WORKING",
  "INPUT_REQUIRED>CANCELED",
  "AUTH_REQUIRED>WORKING",
  "AUTH_REQUIRED>CANCELED",
]);

it("state machine table: every allowed and refused move", () => {
  for (const from of STATES) {
    for (const to of STATES) {
      assert.strictEqual(
        DelegationService.canMove(from, to),
        ALLOWED.has(`${from}>${to}`),
        `${from} -> ${to}`,
      );
    }
  }
});

it.effect("migration adds the hop, thread and decision columns and the resident thread", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = (table: string) =>
      sql<{ readonly name: string; readonly dflt_value: string | null }>`
        SELECT name, dflt_value FROM pragma_table_info(${table})
      `;
    const delegations = yield* columns("telescope_delegations");
    assert.includeMembers(
      delegations.map((column) => column.name),
      ["hop", "thread_id", "decision_id"],
    );
    assert.strictEqual(delegations.find((column) => column.name === "hop")?.dflt_value, "'agent'");
    assert.include(
      (yield* columns("telescope_agents")).map((column) => column.name),
      "resident_thread_id",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("delegate opens a new context id and one dispatch wake", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const first = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    const second = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    assert.notStrictEqual(first.contextId, second.contextId);
    assert.deepStrictEqual(
      [first.state, first.hop, first.fromAgentId, first.toAgentId],
      ["SUBMITTED", "agent", pa, chief],
    );
    assert.deepStrictEqual(first.messages[0]?.parts, [
      { kind: "data", data: { state: "SUBMITTED", brief } },
    ]);
    assert.deepStrictEqual(yield* wakes(), [
      {
        agent_id: chief,
        coalesce_key: `delegation:${first.id}`,
        status: "queued",
        project_id: "project-gripper",
        payload_json: { kind: "delegation", delegationId: first.id },
      },
      {
        agent_id: chief,
        coalesce_key: `delegation:${second.id}`,
        status: "queued",
        project_id: "project-gripper",
        payload_json: { kind: "delegation", delegationId: second.id },
      },
    ]);

    for (const toAgentId of [beaChief, pa, Telescope.AgentId.make("missing")]) {
      assert.strictEqual(
        yield* failure(delegations.delegate(actor(pa), { toAgentId, brief })),
        "not_found",
      );
    }
    assert.lengthOf(yield* wakes(), 2);
    assert.lengthOf(yield* delegations.listForAgent(ws, pa), 2);
  }).pipe(Effect.provide(layer)),
);

it.effect("only the to-agent reports, from a state that allows the move", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const task = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    const ref = { workspaceId: ws, delegationId: task.id };
    const report = (by: Telescope.AgentId, state: "COMPLETED" | "FAILED" | "REJECTED") =>
      delegations.report(actor(by), { delegationId: task.id, state, report: done });

    assert.strictEqual(yield* failure(report(chief, "COMPLETED")), "conflict");
    const working = yield* delegations.start({ ...ref, threadId: ThreadId.make("thread-chief") });
    assert.deepStrictEqual([working.state, working.threadId], ["WORKING", "thread-chief"]);
    assert.strictEqual(yield* failure(delegations.start(ref)), "conflict");
    assert.strictEqual(yield* failure(report(pa, "COMPLETED")), "forbidden");
    assert.strictEqual(yield* failure(report(chief, "REJECTED")), "conflict");

    const silent = yield* delegations.report(actor(chief), {
      delegationId: task.id,
      state: "FAILED",
      report: { result: "", decisions: [], blockedOn: "没有汇报" },
    });
    assert.deepStrictEqual([silent.state, silent.report?.blockedOn], ["FAILED", "没有汇报"]);
    assert.deepStrictEqual(
      silent.messages.map((message) => message.role),
      ["user", "agent", "agent"],
    );

    const declined = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    assert.strictEqual(
      (yield* delegations.report(actor(chief), {
        delegationId: declined.id,
        state: "REJECTED",
        report: { result: "不在本项目范围", decisions: [] },
      })).state,
      "REJECTED",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("a terminal report wakes the from-agent once, by delegation id", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const asking = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    yield* delegations.start({ workspaceId: ws, delegationId: asking.id });
    const question = yield* delegations.report(actor(chief), {
      delegationId: asking.id,
      state: "INPUT_REQUIRED",
      report: { result: "", decisions: [], blockedOn: "用哪种电机", needsFrom: "ann" },
    });
    assert.strictEqual(question.state, "INPUT_REQUIRED");
    assert.strictEqual(
      yield* failure(delegations.start({ workspaceId: ws, delegationId: asking.id })),
      "conflict",
    );

    const task = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    yield* delegations.start({ workspaceId: ws, delegationId: task.id });
    const worker = yield* delegations.recordWorker(actor(chief), {
      parentId: task.id,
      brief,
      threadId: workerThread,
    });
    yield* delegations.start({ workspaceId: ws, delegationId: worker.id });
    yield* delegations.report(actor(chief), {
      delegationId: worker.id,
      state: "COMPLETED",
      report: done,
    });
    assert.deepStrictEqual(yield* wakes({ agent_id: pa }), []);
    assert.deepStrictEqual(yield* wakes({ coalesce_key: `delegation:${worker.id}:report` }), []);

    const artifact = { artifactId: "art-1", parts: [{ kind: "text" as const, text: "线程链接" }] };
    const completed = yield* delegations.report(actor(chief), {
      delegationId: task.id,
      state: "COMPLETED",
      report: done,
      artifacts: [artifact],
    });
    assert.deepStrictEqual([completed.report, completed.artifacts], [done, [artifact]]);
    assert.strictEqual(
      yield* failure(
        delegations.report(actor(chief), { delegationId: task.id, state: "FAILED", report: done }),
      ),
      "conflict",
    );
    assert.deepStrictEqual(yield* wakes({ agent_id: pa }), [
      {
        agent_id: pa,
        coalesce_key: `delegation:${task.id}:report`,
        status: "queued",
        project_id: null,
        payload_json: { kind: "report", delegationId: task.id },
      },
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("a Worker hop opens only under the Chief's own delegation in progress", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const task = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    const open = (by: Telescope.AgentId, parentId: Telescope.DelegationId) =>
      delegations.recordWorker(actor(by), { parentId, brief, threadId: workerThread });

    assert.strictEqual(yield* failure(open(chief, task.id)), "conflict");
    yield* delegations.start({ workspaceId: ws, delegationId: task.id });
    assert.strictEqual(yield* failure(open(pa, task.id)), "forbidden");
    const worker = yield* open(chief, task.id);
    assert.deepStrictEqual(
      [worker.hop, worker.parentId, worker.fromAgentId, worker.toAgentId, worker.threadId],
      ["worker", task.id, chief, chief, workerThread],
    );
    assert.notStrictEqual(worker.contextId, task.contextId);
    yield* delegations.start({ workspaceId: ws, delegationId: worker.id });
    assert.strictEqual(yield* failure(open(chief, worker.id)), "forbidden");
    assert.deepStrictEqual(
      (yield* delegations.byThread(ws, workerThread)).map((row) => row.id),
      [worker.id],
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("cancel cascades to descendants and reports CANCELED up one level", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const db = yield* TelescopeDb.TelescopeDb;
    const task = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    yield* delegations.start({ workspaceId: ws, delegationId: task.id });
    const worker = (threadId: string) =>
      delegations.recordWorker(actor(chief), {
        parentId: task.id,
        brief,
        threadId: ThreadId.make(threadId),
      });
    const running = yield* worker("thread-w1");
    const finished = yield* worker("thread-w2");
    yield* delegations.start({ workspaceId: ws, delegationId: finished.id });
    yield* delegations.report(actor(chief), {
      delegationId: finished.id,
      state: "COMPLETED",
      report: done,
    });
    const followUp = yield* delegations.deliver({ workspaceId: ws, delegationId: running.id }, [
      { kind: "text", text: "顺便测一下夹力" },
    ]);
    assert.deepStrictEqual(followUp.messages.at(-1)?.parts, [
      { kind: "text", text: "顺便测一下夹力" },
    ]);

    assert.strictEqual(yield* failure(delegations.cancel(actor(chief), task.id)), "forbidden");
    const bea = { workspaceId: ws, memberId: "bea" };
    assert.strictEqual(yield* failure(delegations.cancel(bea, task.id)), "forbidden");

    const cancelled = yield* delegations.cancel(ann, task.id);
    assert.deepStrictEqual(
      cancelled.map((row) => [row.id, row.state]),
      [
        [task.id, "CANCELED"],
        [running.id, "CANCELED"],
      ],
    );
    assert.strictEqual(
      (yield* delegations.get({ workspaceId: ws, delegationId: finished.id })).state,
      "COMPLETED",
    );
    assert.deepStrictEqual(cancelled[0]?.messages.at(-1)?.parts, [
      { kind: "data", data: { state: "CANCELED", by: { memberId: "ann" } } },
    ]);
    assert.deepStrictEqual(
      (yield* wakes()).map((wake) => [wake.coalesce_key, wake.status]),
      [
        [`delegation:${task.id}`, "interrupted"],
        [`delegation:${task.id}:report`, "queued"],
      ],
    );
    assert.strictEqual(yield* failure(delegations.cancel(ann, task.id)), "conflict");
    assert.strictEqual(
      yield* failure(
        delegations.deliver({ workspaceId: ws, delegationId: running.id }, [
          { kind: "text", text: "还在吗" },
        ]),
      ),
      "conflict",
    );

    const sent = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    yield* delegations.start({ workspaceId: ws, delegationId: sent.id });
    const hop = yield* delegations.recordWorker(actor(chief), {
      parentId: sent.id,
      brief,
      threadId: ThreadId.make("thread-w3"),
    });
    // Ann keeps the PA only: a chain holding one of her agents above the hop is still hers.
    yield* db.update(ws, "agents", { owner_subject_id: "cal" }, { agent_id: chief });
    assert.deepStrictEqual(
      (yield* delegations.cancel(ann, hop.id)).map((row) => row.id),
      [hop.id],
    );
    assert.deepStrictEqual(yield* wakes({ coalesce_key: `delegation:${hop.id}:report` }), []);
    yield* db.update(ws, "agents", { owner_subject_id: "ann" }, { agent_id: chief });

    assert.deepStrictEqual(
      (yield* delegations.cancel(actor(pa), sent.id)).map((row) => row.state),
      ["CANCELED"],
    );
    assert.deepStrictEqual(yield* wakes({ coalesce_key: `delegation:${sent.id}:report` }), []);
  }).pipe(Effect.provide(layer)),
);

it.effect("another workspace's delegation is not found", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const task = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    const ref = { workspaceId: otherWs, delegationId: task.id };
    const elsewhere = { ...actor(chief), workspaceId: otherWs };

    const attempts: ReadonlyArray<Effect.Effect<object, { readonly _tag: string }>> = [
      delegations.get(ref),
      delegations.start(ref),
      delegations.deliver(ref, [{ kind: "text", text: "hi" }]),
      delegations.report(elsewhere, { delegationId: task.id, state: "COMPLETED", report: done }),
      delegations.cancel({ workspaceId: otherWs, memberId: "ann" }, task.id),
      delegations.recordWorker(elsewhere, { parentId: task.id, brief, threadId: workerThread }),
      delegations.delegate({ ...actor(pa), workspaceId: otherWs }, { toAgentId: chief, brief }),
    ];
    for (const attempt of attempts) {
      assert.strictEqual(yield* failure(attempt), "not_found");
    }
    assert.deepStrictEqual(yield* delegations.listForAgent(otherWs, chief), []);
    assert.strictEqual((yield* delegations.get({ ...ref, workspaceId: ws })).state, "SUBMITTED");
  }).pipe(Effect.provide(layer)),
);
