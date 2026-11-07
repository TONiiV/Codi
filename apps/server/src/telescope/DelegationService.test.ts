import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as BoardChanges from "./BoardChanges.ts";
import * as DelegationAnswers from "./DelegationAnswers.ts";
import * as DelegationService from "./DelegationService.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WakeQueueService from "./WakeQueueService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(
  DelegationService.layer,
  BoardChanges.layer,
  TelescopeDb.layer,
  WakeQueueService.layer,
  TaskBoardService.layer,
).pipe(
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
const session = (name: string) => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: name,
});
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
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO telescope_workspaces ${sql.insert({
    workspace_id: ws,
    kind: "enterprise",
    name: "A",
    created_at: at,
    created_by: "ann",
  })}`;
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
  for (const name of ["ann", "bea"]) {
    if (name === "ann")
      yield* db.insert(ws, "members", {
        subject_id: name,
        display_name: name,
        role: "member",
        joined_at: at,
      });
    yield* db.insert(ws, "member_sessions", {
      member_id: name,
      device_key: `session-${name}`,
      linked_at: at,
    });
  }
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

    const missing = Telescope.AgentId.make("missing");
    for (const [by, toAgentId] of [
      [pa, beaChief],
      [chief, pa],
      [pa, missing],
    ] as const) {
      assert.strictEqual(
        yield* failure(delegations.delegate(actor(by), { toAgentId, brief })),
        "not_found",
      );
    }
    assert.strictEqual(
      yield* failure(delegations.delegate(actor(chief), { toAgentId: chief, brief })),
      "forbidden",
    );
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
    assert.strictEqual(yield* failure(report(beaChief, "COMPLETED")), "not_found");
    assert.strictEqual(yield* failure(report(chief, "REJECTED")), "conflict");
    const cancelled = delegations.report(actor(chief), {
      delegationId: task.id,
      // @ts-expect-error a report cannot cancel; the runtime refuses it too
      state: "CANCELED",
      report: done,
    });
    assert.strictEqual(yield* failure(cancelled), "forbidden");

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
      question: "用哪种电机",
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
    assert.strictEqual(yield* failure(delegations.cancel(actor(beaChief), task.id)), "not_found");
    const bea = { workspaceId: ws, memberId: "bea" };
    assert.strictEqual(yield* failure(delegations.cancel(bea, task.id)), "not_found");

    const queue = yield* WakeQueueService.WakeQueueService;
    assert.strictEqual((yield* queue.dequeue)?.coalesceKey, `delegation:${task.id}`);
    yield* queue.enqueue(ws, {
      reason: "dispatch",
      agentId: chief,
      priority: 2,
      payload: {},
      subjectId: "ann",
      coalesceKey: `delegation:${task.id}`,
    });
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
        [`delegation:${task.id}`, "running"],
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

const question = (
  state: "INPUT_REQUIRED" | "AUTH_REQUIRED",
  hop: "agent" | "worker" = "agent",
  threadId = workerThread,
) =>
  Effect.gen(function* () {
    const delegations = yield* DelegationService.DelegationService;
    const task = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    yield* delegations.start({ workspaceId: ws, delegationId: task.id });
    const asking =
      hop === "agent"
        ? task
        : yield* delegations.recordWorker(actor(chief), {
            parentId: task.id,
            brief,
            threadId,
          });
    if (hop === "worker") yield* delegations.start({ workspaceId: ws, delegationId: asking.id });
    return yield* delegations.report(actor(chief), {
      delegationId: asking.id,
      state,
      report: { result: "", decisions: [], blockedOn: "电机选型", needsFrom: "ann" },
      question: "用哪种电机",
      options: ["A 电机", "B 电机"],
    });
  });
const decisions = TaskBoardService.TaskBoardService.use((board) =>
  board.listDecisions({ caller: session("ann") }, { workspaceId: ws }),
).pipe(Effect.map((result) => result.decisions));
const decide = (proposal: Telescope.Decision, chosen: string, text = proposal.text) =>
  TaskBoardService.TaskBoardService.use((board) =>
    board.createDecision(
      { caller: session("ann") },
      {
        workspaceId: ws,
        title: proposal.title,
        text,
        status: "decided",
        supersedes: proposal.id,
        ...(proposal.options === undefined ? {} : { options: proposal.options }),
        chosen,
      },
    ),
  );
const recordSends = Effect.map(
  Ref.make<ReadonlyArray<readonly [ThreadId, string]>>([]),
  (sent) => ({
    sent,
    send: (threadId: ThreadId, text: string) =>
      Ref.update(sent, (all) => [...all, [threadId, text] as const]),
  }),
);

it.effect("INPUT_REQUIRED opens one proposed decision with the agent's options", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const task = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    yield* delegations.start({ workspaceId: ws, delegationId: task.id });
    const unasked = delegations.report(actor(chief), {
      delegationId: task.id,
      state: "INPUT_REQUIRED",
      report: done,
    });
    assert.strictEqual(yield* failure(unasked), "invalid");
    assert.deepStrictEqual(yield* decisions, []);

    const asked = yield* question("INPUT_REQUIRED");
    const [proposal, ...others] = yield* decisions;
    assert.deepStrictEqual(others, []);
    assert.strictEqual(asked.decisionId, proposal?.id);
    assert.deepInclude(proposal, {
      status: "proposed",
      authorId: chief,
      title: "用哪种电机",
      text: "电机选型\nann",
      options: [
        { id: "1", label: "A 电机" },
        { id: "2", label: "B 电机" },
      ],
    });
    assert.deepStrictEqual(asked.messages.at(-1)?.parts[0], {
      kind: "data",
      data: {
        state: "INPUT_REQUIRED",
        report: { result: "", decisions: [], blockedOn: "电机选型", needsFrom: "ann" },
        decisionId: proposal?.id ?? null,
      },
    });
    assert.deepStrictEqual(yield* wakes({ agent_id: pa }), []);
  }).pipe(Effect.provide(layer)),
);

it.effect("AUTH_REQUIRED offers 批准/不批准", () =>
  Effect.gen(function* () {
    yield* setup;
    const asked = yield* question("AUTH_REQUIRED");
    const [proposal] = yield* decisions;
    assert.strictEqual(asked.state, "AUTH_REQUIRED");
    assert.deepStrictEqual(proposal?.options, [
      { id: "approve", label: "批准" },
      { id: "deny", label: "不批准" },
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("an agent cannot settle its own question (D57)", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const asked = yield* question("INPUT_REQUIRED");
    const [proposal] = yield* decisions;
    if (proposal === undefined) return assert.fail("no proposal");
    const settle = TaskBoardService.TaskBoardService.use((board) =>
      board.createDecision(
        {
          caller: { runId: actor(chief).runId, workspaceId: ws, memberId: "ann" },
          authorId: chief,
          onBehalfOf: actor(chief).onBehalfOf,
        },
        { workspaceId: ws, title: "用 A", text: "", supersedes: proposal.id, chosen: "1" },
      ),
    );
    assert.strictEqual(yield* failure(settle), "forbidden");
    const { send, sent } = yield* recordSends;
    assert.isUndefined(
      yield* delegations.answer({ workspaceId: ws, decisionId: proposal.id }, send),
    );
    assert.strictEqual(
      (yield* delegations.get({ workspaceId: ws, delegationId: asked.id })).state,
      "INPUT_REQUIRED",
    );
    assert.deepStrictEqual(yield* Ref.get(sent), []);
  }).pipe(Effect.provide(layer)),
);

it.effect.each(["worker", "agent"] as const)(
  "an answer moves the delegation to WORKING and delivers once to the asking %s hop",
  (hop) =>
    Effect.gen(function* () {
      const delegations = yield* setup;
      const asked = yield* question("INPUT_REQUIRED", hop);
      const [proposal] = yield* decisions;
      if (proposal === undefined) return assert.fail("no proposal");
      const { send, sent } = yield* recordSends;
      const ref = { workspaceId: ws, decisionId: proposal.id };
      assert.isUndefined(yield* delegations.answer(ref, send));

      yield* decide(proposal, "2", "预算够，用 B");
      const answered = yield* delegations.answer(ref, send);
      const text = 'Your member answered "用哪种电机": B 电机\n预算够，用 B';
      assert.deepStrictEqual(
        [answered?.id, answered?.state, answered?.decisionId],
        [asked.id, "WORKING", undefined],
      );
      const last = answered?.messages.at(-1);
      assert.deepStrictEqual(
        [last?.role, last?.parts],
        [
          "user",
          [
            { kind: "data", data: { state: "WORKING", decisionId: proposal.id } },
            { kind: "text", text },
          ],
        ],
      );
      assert.isUndefined(yield* delegations.answer(ref, send));
      const answerWakes = yield* wakes({ coalesce_key: `delegation:${asked.id}:answer` });
      if (hop === "worker") {
        assert.deepStrictEqual(yield* Ref.get(sent), [[workerThread, text]]);
        assert.deepStrictEqual(answerWakes, []);
      } else {
        assert.deepStrictEqual(yield* Ref.get(sent), []);
        assert.deepStrictEqual(answerWakes, [
          {
            agent_id: chief,
            coalesce_key: `delegation:${asked.id}:answer`,
            status: "queued",
            project_id: "project-gripper",
            payload_json: { kind: "answer", delegationId: asked.id },
          },
        ]);
      }
    }).pipe(Effect.provide(layer)),
);

it.effect("the answer to a cancelled delegation is not delivered", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const asked = yield* question("INPUT_REQUIRED", "worker");
    const [proposal] = yield* decisions;
    if (proposal === undefined) return assert.fail("no proposal");
    yield* delegations.cancel(ann, asked.id);
    yield* decide(proposal, "1");
    const { send, sent } = yield* recordSends;
    assert.isUndefined(
      yield* delegations.answer({ workspaceId: ws, decisionId: proposal.id }, send),
    );
    assert.strictEqual(
      (yield* delegations.get({ workspaceId: ws, delegationId: asked.id })).state,
      "CANCELED",
    );
    assert.deepStrictEqual(yield* Ref.get(sent), []);
  }).pipe(Effect.provide(layer)),
);

it.effect("an answer for a stopped agent fails its delegation instead of a turn (D48)", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const db = yield* TelescopeDb.TelescopeDb;
    const asked = yield* question("INPUT_REQUIRED", "worker");
    const [proposal] = yield* decisions;
    if (proposal === undefined) return assert.fail("no proposal");
    yield* decide(proposal, "1");
    yield* db.insert(ws, "kill_switches", {
      agent_id: pa,
      state: "paused",
      by_subject_id: "ann",
      at,
    });
    const { send, sent } = yield* recordSends;
    const failed = yield* delegations.answer({ workspaceId: ws, decisionId: proposal.id }, send);
    assert.deepStrictEqual(
      [failed?.id, failed?.state, failed?.report?.blockedOn],
      [asked.id, "FAILED", "agent stopped"],
    );
    assert.deepStrictEqual(yield* Ref.get(sent), []);
  }).pipe(Effect.provide(layer)),
);

it.effect("a member lists, reads and cancels only delegations of its own chain (D70, D98)", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const task = yield* delegations.delegate(actor(pa), { toAgentId: chief, brief });
    yield* delegations.start({ workspaceId: ws, delegationId: task.id });
    const hop = yield* delegations.recordWorker(actor(chief), {
      parentId: task.id,
      brief,
      threadId: workerThread,
    });
    const mine = { workspaceId: ws, delegationId: hop.id };

    const listed = yield* delegations.listForMember(session("ann"), { workspaceId: ws });
    assert.deepStrictEqual(
      listed.delegations.map((row) => [row.id, "messages" in row]),
      [
        [hop.id, false],
        [task.id, false],
      ],
    );
    assert.deepStrictEqual(
      (yield* delegations.listForMember(session("ann"), {
        workspaceId: ws,
        state: "SUBMITTED",
        limit: 1,
      })).delegations.map((row) => row.id),
      [hop.id],
    );
    assert.deepStrictEqual(
      (yield* delegations.listForMember(session("bea"), { workspaceId: ws })).delegations,
      [],
    );
    assert.deepStrictEqual(
      (yield* delegations.listForMember(session("bea"), { workspaceId: ws, agentId: chief }))
        .delegations,
      [],
    );
    assert.strictEqual((yield* delegations.getForMember(session("ann"), mine)).id, hop.id);
    const unknown = { workspaceId: ws, delegationId: Telescope.DelegationId.make("nope") };
    const attempts: ReadonlyArray<Effect.Effect<object, { readonly _tag: string }>> = [
      delegations.getForMember(session("bea"), mine),
      delegations.getForMember(session("bea"), unknown),
      delegations.cancelForMember(session("bea"), mine),
      delegations.cancelForMember(session("bea"), unknown),
    ];
    for (const attempt of attempts) {
      assert.strictEqual(yield* failure(attempt), "not_found");
    }
    assert.strictEqual(
      yield* failure(delegations.listForMember(session("mallory"), { workspaceId: ws })),
      "forbidden",
    );

    // Bea owns the Chief now: the owner of either agent in the chain may cancel.
    yield* TelescopeDb.TelescopeDb.use((db) =>
      db.update(ws, "agents", { owner_subject_id: "bea" }, { agent_id: chief }),
    );
    assert.deepStrictEqual(yield* delegations.cancelForMember(session("bea"), mine), {
      canceled: [hop.id],
    });
    assert.deepStrictEqual(
      yield* delegations.cancelForMember(session("ann"), {
        workspaceId: ws,
        delegationId: task.id,
      }),
      { canceled: [task.id] },
    );
  }).pipe(Effect.provide(layer)),
);

/** The listener with a fake orchestrator that records each message sent to a thread. */
const listen = Effect.gen(function* () {
  const sends = yield* Queue.unbounded<ThreadManagementService.ThreadManagementSendInput>();
  const answers = yield* DelegationAnswers.make.pipe(
    Effect.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () => Effect.succeed({ projectId: "project-gripper" } as never),
        sendToThread: (input) => Queue.offer(sends, input).pipe(Effect.as({} as never)),
      }),
    ),
  );
  return { ...answers, sends };
});

it.effect("the restart re-scan delivers a missed answer once", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const asked = yield* question("INPUT_REQUIRED", "worker");
    const [proposal] = yield* decisions;
    if (proposal === undefined) return assert.fail("no proposal");
    yield* decide(proposal, "1");

    const { catchUp, sends } = yield* listen;
    yield* catchUp;
    yield* catchUp;
    const sent = yield* Queue.takeAll(sends);
    assert.deepStrictEqual(
      sent.map((input) => [input.threadId, input.commandId, input.text]),
      [
        [
          workerThread,
          `telescope-answer:${proposal.id}`,
          'Your member answered "用哪种电机": A 电机',
        ],
      ],
    );
    assert.strictEqual(
      (yield* delegations.get({ workspaceId: ws, delegationId: asked.id })).state,
      "WORKING",
    );
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("a member's decision goes to the asking Worker thread and no other", () =>
  Effect.gen(function* () {
    const delegations = yield* setup;
    const other = yield* question("INPUT_REQUIRED", "worker", ThreadId.make("thread-other"));
    const asked = yield* question("INPUT_REQUIRED", "worker");
    const { follow, sends } = yield* listen;
    const following = yield* Effect.forkScoped(follow);
    const proposal = (yield* decisions).find((decision) => decision.id === asked.decisionId);
    if (proposal === undefined) return assert.fail("no proposal");
    yield* decide(proposal, "2");

    assert.strictEqual((yield* Queue.take(sends)).threadId, workerThread);
    // `answer` holds the service lock, so this waits for the delivery in flight to finish.
    const ref = { workspaceId: ws, decisionId: proposal.id };
    assert.isUndefined(yield* delegations.answer(ref, () => Effect.void));
    yield* Fiber.interrupt(following);
    assert.strictEqual(yield* Queue.size(sends), 0);
    const states = yield* Effect.forEach([asked, other], ({ id }) =>
      delegations.get({ workspaceId: ws, delegationId: id }),
    );
    assert.deepStrictEqual(
      states.map((row) => row.state),
      ["WORKING", "INPUT_REQUIRED"],
    );
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
