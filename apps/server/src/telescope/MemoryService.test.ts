import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scheduler from "effect/Scheduler";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as MemoryService from "./MemoryService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(TelescopeDb.layer, WorkspaceService.layer, MemoryService.layer).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
);

const session = (name: string): WorkspaceService.Caller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const sessions = { alice: session("alice"), bob: session("bob"), carol: session("carol") };
const as = (name: keyof typeof sessions) => ({ session: sessions[name] });
const at = "2026-11-06T00:00:00.000Z";
const agent = (id: string, owner: string | null, kind: Telescope.AgentKind = "chief_of_staff") => ({
  agent_id: id,
  owner_subject_id: owner,
  kind,
  name: id,
  standing_powers_json: "{}",
  exposure: "hidden",
  sync_with_board: 0,
  dispatch_mode: "inbox",
  channels_json: "[]",
  created_at: at,
  updated_at: at,
});

const setup = Effect.fn(function* (kind: Telescope.Workspace["kind"]) {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const memory = yield* MemoryService.MemoryService;
  const workspace = yield* workspaces.create(sessions.alice, {
    kind,
    name: "Acme",
    displayName: "Alice",
  });
  const workspaceId = workspace.id;
  const { code } = yield* workspaces.invite(sessions.alice, { workspaceId, role: "member" });
  const bob = yield* workspaces.accept(sessions.bob, { code, displayName: "Bob" });
  const aliceAgent = `${workspaceId}-alice`;
  const bobAgent = `${workspaceId}-bob`;
  yield* db.insert(workspaceId, "agents", agent(aliceAgent, workspace.createdBy));
  yield* db.insert(workspaceId, "agents", agent(bobAgent, bob.subjectId));
  const add = (text: string, fields: Partial<typeof Telescope.MemoryWrite.Type> = {}) =>
    memory.write(as("alice"), {
      workspaceId,
      agentId: Telescope.AgentId.make(aliceAgent),
      op: "add",
      text,
      ...fields,
    });
  const search = (name: keyof typeof sessions, query: string, options = {}) =>
    memory
      .search(as(name), { workspaceId, query, ...options })
      .pipe(Effect.map(({ memories }) => memories));
  const aliceId = workspace.createdBy;
  const runOn = Effect.fn(function* (agentId: string, onBehalfOf: string) {
    const threadId = ThreadId.make(`thread-${agentId}`);
    yield* db.insert(workspaceId, "runs", {
      run_id: `run-${agentId}`,
      agent_id: agentId,
      on_behalf_of_json: JSON.stringify([onBehalfOf]),
      input_snapshot_json: "{}",
      started_at: at,
      thread_id: threadId,
    });
    return yield* memory.callerForThread(threadId);
  });
  const searchAs = (caller: MemoryService.ThreadAgent, query: string) =>
    memory
      .search(caller, { workspaceId, query })
      .pipe(Effect.map(({ memories }) => memories.map((m) => m.text)));
  return {
    db,
    memory,
    workspaceId,
    aliceId,
    bobId: bob.subjectId,
    aliceAgent,
    bobAgent,
    add,
    search,
    runOn,
    searchAs,
  };
});

it.effect("searches by substring without FTS5", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const trigger of ["insert", "update", "delete"])
      yield* sql`DROP TRIGGER ${sql(`telescope_memories_fts_${trigger}`)}`;
    yield* sql`DROP TABLE telescope_memories_fts`;
    const { add, search } = yield* setup("personal");
    const written = yield* add("夹爪项目下周交付样机");
    yield* add("Gripper firmware ships Friday");

    for (const query of ["夹爪", "夹爪项目", "样机 交付", "gripper FIRMWARE"]) {
      assert.lengthOf(yield* search("alice", query), 1, query);
    }
    assert.strictEqual((yield* search("alice", "夹爪"))[0]?.id, written.id);
    assert.deepStrictEqual(yield* search("alice", "机械臂"), []);
  }).pipe(Effect.provide(layer)),
);

it.layer(layer)("Telescope memories", (it) => {
  it.effect("finds Chinese substrings through the trigram index", () =>
    Effect.gen(function* () {
      const { add, search } = yield* setup("personal");
      const written = yield* add("夹爪项目下周交付样机");
      yield* add("Gripper firmware ships Friday");

      for (const query of ["夹爪", "夹爪项目", "样机 交付", "gripper FIRMWARE"]) {
        assert.lengthOf(yield* search("alice", query), 1, query);
      }
      const [found] = yield* search("alice", "夹爪");
      assert.deepStrictEqual([found?.id, found?.layer], [written.id, "long_term"]);
      assert.deepStrictEqual(yield* search("alice", "机械臂"), []);
    }),
  );

  it.effect("returns only the current fact once a memory is superseded or invalidated", () =>
    Effect.gen(function* () {
      const { add, search, memory, workspaceId, aliceAgent } = yield* setup("personal");
      const first = yield* add("交付日期是周五");
      const updated = yield* memory.write(as("alice"), {
        workspaceId,
        agentId: Telescope.AgentId.make(aliceAgent),
        op: "update",
        id: first.id,
        text: "交付日期改到下周一",
      });

      const current = yield* search("alice", "交付日期");
      assert.deepStrictEqual(
        current.map((m) => [m.id, m.rev, m.text]),
        [[first.id, 1, "交付日期改到下周一"]],
      );
      assert.deepStrictEqual(yield* search("alice", "周五"), []);
      const history = yield* search("alice", "交付日期", { includeInvalidated: true });
      assert.deepStrictEqual(history.map((m) => [m.rev, m.invalidAt !== undefined]).toSorted(), [
        [0, true],
        [1, false],
      ]);

      yield* memory.write(as("alice"), {
        workspaceId,
        agentId: updated.agentId,
        op: "invalidate",
        id: first.id,
      });
      assert.deepStrictEqual(yield* search("alice", "交付日期"), []);
    }),
  );

  it.effect("keeps private memories with their owner and runs inside their own agent", () =>
    Effect.gen(function* () {
      const {
        db,
        add,
        search,
        memory,
        workspaceId,
        aliceId,
        bobId,
        aliceAgent,
        bobAgent,
        runOn,
        searchAs,
      } = yield* setup("enterprise");
      yield* add("预算审批人是老王");
      yield* add("预算按季度结算", { level: "internal" });

      assert.lengthOf(yield* search("alice", "预算"), 2);
      assert.deepStrictEqual(
        (yield* search("bob", "预算")).map((m) => m.text),
        ["预算按季度结算"],
      );
      // Private means the writing agent: other agents acting for the same member do not see it.
      yield* db.insert(
        workspaceId,
        "agents",
        agent(`${workspaceId}-company`, null, "company_main"),
      );
      yield* db.insert(workspaceId, "agents", agent(`${workspaceId}-alice2`, aliceId, "custom"));
      for (const [other, expected] of [
        [aliceAgent, ["预算审批人是老王", "预算按季度结算"]],
        [`${workspaceId}-company`, ["预算按季度结算"]],
        [`${workspaceId}-alice2`, ["预算按季度结算"]],
      ] as const) {
        const seen = yield* searchAs(yield* runOn(other, aliceId), "预算");
        assert.deepStrictEqual(seen.toSorted(), [...expected].toSorted(), other);
      }
      const outsider = yield* search("carol", "预算").pipe(Effect.flip);
      assert.strictEqual(
        outsider._tag === "TelescopeWorkspaceError" && outsider.reason,
        "forbidden",
      );

      const threadId = ThreadId.make("thread-bob");
      yield* db.insert(workspaceId, "runs", {
        run_id: "run-1",
        agent_id: bobAgent,
        on_behalf_of_json: JSON.stringify([bobId, bobAgent]),
        input_snapshot_json: "{}",
        started_at: at,
        thread_id: threadId,
      });
      const resolved = yield* memory.callerForThread(threadId);
      assert.strictEqual(resolved.workspaceId, workspaceId);
      const asRun = (agentId: string, scope?: "person") =>
        memory.write(resolved, {
          workspaceId,
          agentId: Telescope.AgentId.make(agentId),
          op: "add",
          text: "鲍勃喜欢早上开会",
          ...(scope === undefined ? {} : { scope, aboutSubjectId: bobId }),
        });
      const written = yield* asRun(bobAgent);
      assert.deepStrictEqual(written.source, {
        runId: Telescope.AgentRunId.make("run-1"),
        threadId,
      });
      const intoAlice = yield* asRun(`${workspaceId}-alice`).pipe(Effect.flip);
      assert.strictEqual(
        intoAlice._tag === "TelescopeWorkspaceError" && intoAlice.reason,
        "forbidden",
      );
      const personRecord = yield* asRun(bobAgent, "person").pipe(Effect.flip);
      assert.strictEqual(
        personRecord._tag === "TelescopeWorkspaceError" && personRecord.reason,
        "forbidden",
      );

      yield* db.update(workspaceId, "runs", { finished_at: at }, { run_id: "run-1" });
      const finished = yield* memory.callerForThread(threadId).pipe(Effect.flip);
      assert.strictEqual(
        finished._tag === "TelescopeWorkspaceError" && finished.reason,
        "forbidden",
      );
    }),
  );

  it.effect("shows a person record only to company agents and the person it is about", () =>
    Effect.gen(function* () {
      const { db, memory, workspaceId, aliceId, bobId, runOn, search, searchAs } =
        yield* setup("enterprise");
      const company = `${workspaceId}-company`;
      yield* db.insert(workspaceId, "agents", agent(company, null, "company_main"));
      const companyRun = yield* runOn(company, aliceId);
      yield* memory.write(companyRun, {
        workspaceId,
        agentId: Telescope.AgentId.make(company),
        op: "add",
        text: "鲍勃擅长结构设计",
        scope: "person",
        aboutSubjectId: Telescope.SubjectId.make(bobId),
      });

      assert.deepStrictEqual(yield* searchAs(companyRun, "结构设计"), ["鲍勃擅长结构设计"]);
      assert.lengthOf(yield* search("bob", "结构设计"), 1);
      assert.deepStrictEqual(yield* search("alice", "结构设计"), []);
    }),
  );

  it.effect("returns pinned memories first and counts each retrieval", () =>
    Effect.gen(function* () {
      const { add, search, memory, workspaceId } = yield* setup("personal");
      yield* add("周会在周二上午");
      const later = yield* add("周会改成线上");
      yield* memory.pin(as("alice"), { workspaceId, id: later.id, pinned: true });

      const first = yield* search("alice", "周会");
      assert.deepStrictEqual(
        first.map((m) => [m.text, m.pinned, m.uses]),
        [
          ["周会改成线上", true, 1],
          ["周会在周二上午", false, 1],
        ],
      );
      const second = yield* search("alice", "周会", { limit: 1 });
      assert.deepStrictEqual(
        second.map((m) => [m.id, m.uses, m.lastRetrievedAt !== undefined]),
        [[later.id, 2, true]],
      );
      // A small yield budget interleaves the searches, so some read before others write.
      yield* Effect.all(
        Array.from({ length: 4 }, () => search("alice", "周会", { limit: 1 })),
        { concurrency: "unbounded" },
      ).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, 50));
      const [counted] = yield* search("alice", "周会", { limit: 1 });
      assert.strictEqual(counted?.uses, 7);
    }),
  );
});
