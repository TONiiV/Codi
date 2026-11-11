import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const here = Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
  getEnvironmentId: Effect.succeed(EnvironmentId.make("env-elsewhere")),
});
const layer = Layer.mergeAll(TaskBoardService.layer, WorkspaceService.layer).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
  Layer.provide(here),
);

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);
const isStale = Schema.is(Telescope.StaleTaskVersionError);
const decodeLeaseAcquire = Schema.decodeUnknownSync(Telescope.LeaseAcquireInput);
const encodeUpdateResult = Schema.encodeEffect(Telescope.TaskUpdateResult);
const reasonOf = (error: { readonly _tag: string }) =>
  isWorkspaceError(error) ? error.reason : error._tag;

const session = (name: string): WorkspaceService.Caller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const alice = { caller: session("alice") };
const setup = Effect.gen(function* () {
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const board = yield* TaskBoardService.TaskBoardService;
  const create = (name: string) =>
    workspaces.create(alice.caller, { kind: "enterprise", name, displayName: "Alice" });
  const a = (yield* create("A")).id;
  const b = (yield* create("B")).id;
  const { self } = yield* workspaces.get(alice.caller, { workspaceId: a });
  const agent = { ...alice, authorId: "agent-cos", onBehalfOf: [self.subjectId, "agent-cos"] };
  return { workspaces, board, a, b, aliceId: self.subjectId, agent };
});

it.layer(layer)("Telescope task board", (it) => {
  it.effect("records a commit per write and lands a stale write on other fields", () =>
    Effect.gen(function* () {
      const { workspaces, board, a, aliceId, agent } = yield* setup;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Ship invites" });
      assert.strictEqual(task.version, 1);
      const bob = { caller: session("bob") };
      const { code } = yield* workspaces.invite(alice.caller, { workspaceId: a, role: "member" });
      const bobId = (yield* workspaces.accept(bob.caller, { code, displayName: "Bob" })).subjectId;

      const moved = yield* board.updateTask(agent, {
        workspaceId: a,
        taskId: task.id,
        baseVersion: 1,
        set: {
          title: "Ship invites",
          status: "in_progress",
          ownerAgentId: Telescope.AgentId.make("agent-cos"),
        },
        note: "Picked this up.",
      });
      assert.strictEqual(moved.version, 2);
      assert.deepStrictEqual(
        moved.freeText.map((e) => [e.authorId, e.text]),
        [["agent-cos", "Picked this up."]],
      );

      const cleared = yield* board.updateTask(bob, {
        workspaceId: a,
        taskId: task.id,
        baseVersion: 2,
        set: { ownerAgentId: null },
        note: "Taking it back.",
      });
      assert.strictEqual(cleared.ownerAgentId, undefined);
      assert.deepStrictEqual(
        cleared.freeText.map((e) => e.authorId),
        ["agent-cos", bobId],
      );

      const late = yield* board.updateTask(alice, {
        workspaceId: a,
        taskId: task.id,
        baseVersion: 2,
        set: { status: "done" },
      });
      assert.deepStrictEqual(
        [late.version, late.status, late.ownerAgentId, late.freeText.length, late.overwrote],
        [4, "done", undefined, 2, undefined],
      );
      const ahead = yield* board
        .updateTask(alice, { workspaceId: a, taskId: task.id, baseVersion: 9, set: {} })
        .pipe(Effect.flip);
      assert.deepStrictEqual(isStale(ahead) && [ahead.baseVersion, ahead.currentVersion], [9, 4]);

      const { commits } = yield* board.listCommits(alice, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual(
        commits.map((c) => [c.baseVersion, c.authorId, c.onBehalfOf, c.parentId]),
        [
          [0, aliceId, undefined, undefined],
          [1, "agent-cos", [aliceId, "agent-cos"], commits[0]?.id],
          [2, bobId, undefined, commits[1]?.id],
          [3, aliceId, undefined, commits[2]?.id],
        ],
      );
      assert.deepStrictEqual(
        [commits[3]?.changedFields, commits[3]?.mergeLevel, commits[3]?.mergeReason],
        [{ status: "done" }, 0, "based on version 2"],
      );
      assert.deepStrictEqual(commits[1]?.changedFields, {
        status: "in_progress",
        ownerAgentId: "agent-cos",
        freeText: [{ authorId: "agent-cos", text: "Picked this up.", at: moved.updatedAt }],
      });
      assert.deepStrictEqual(Object.keys(commits[2]?.changedFields ?? {}), [
        "ownerAgentId",
        "freeText",
      ]);
      assert.strictEqual(commits[2]?.changedFields.ownerAgentId, null);
    }),
  );

  it.effect("supersedes decisions append-only with a commit per change", () =>
    Effect.gen(function* () {
      const { board, a, aliceId, agent } = yield* setup;
      const first = yield* board.createDecision(alice, {
        workspaceId: a,
        title: "Postgres",
        text: "",
      });
      assert.strictEqual(first.version, 1);
      const proposal = yield* board.createDecision(alice, {
        workspaceId: a,
        title: "pglite",
        text: "",
        status: "proposed",
        supersedes: first.id,
      });
      const sqlite = { workspaceId: a, title: "SQLite", text: "One engine.", supersedes: first.id };
      // D57: a decision that an open proposal would replace waits for a member.
      assert.strictEqual(
        reasonOf(yield* Effect.flip(board.createDecision(agent, sqlite))),
        "forbidden",
      );
      const second = yield* board.createDecision(alice, sqlite);
      const late = yield* board
        .createDecision(alice, {
          workspaceId: a,
          title: "pglite",
          text: "",
          supersedes: proposal.id,
        })
        .pipe(Effect.flip);
      assert.strictEqual(reasonOf(late), "conflict");
      const { decisions } = yield* board.listDecisions(alice, { workspaceId: a });
      assert.deepStrictEqual(
        decisions.map((d) => [d.title, d.status, d.version, d.supersedes]).toSorted(),
        [
          ["Postgres", "superseded", 2, undefined],
          ["SQLite", "decided", 1, first.id],
          ["pglite", "superseded", 2, first.id],
        ],
      );
      const again = yield* board
        .createDecision(alice, { workspaceId: a, title: "MySQL", text: "", supersedes: first.id })
        .pipe(Effect.flip);
      assert.strictEqual(reasonOf(again), "conflict");
      yield* board.createDecision(agent, {
        ...sqlite,
        title: "SQLite, WAL",
        supersedes: second.id,
      });

      const { commits } = yield* board.listCommits(alice, { workspaceId: a, taskId: first.id });
      assert.deepStrictEqual(
        commits.map((c) => [c.baseVersion, c.authorId, c.onBehalfOf, c.parentId, c.changedFields]),
        [
          [0, aliceId, undefined, undefined, { title: "Postgres", text: "", status: "decided" }],
          [1, aliceId, undefined, commits[0]?.id, { status: "superseded" }],
        ],
      );
      const replaced = yield* board.listCommits(alice, { workspaceId: a, taskId: second.id });
      assert.deepStrictEqual(
        replaced.commits.map((c) => [c.authorId, c.onBehalfOf, c.changedFields]).at(-1),
        ["agent-cos", [aliceId, "agent-cos"], { status: "superseded" }],
      );
      const proposed = yield* board.listCommits(alice, { workspaceId: a, taskId: proposal.id });
      assert.deepStrictEqual(
        proposed.commits.map((c) => [c.authorId, c.changedFields]),
        [
          [aliceId, { title: "pglite", text: "", status: "proposed", supersedes: first.id }],
          [aliceId, { status: "superseded" }],
        ],
      );
    }),
  );

  it.effect("deciding a proposal also retires the decision the proposal supersedes", () =>
    Effect.gen(function* () {
      const { board, a, b } = yield* setup;
      const decide = (title: string, supersedes: Telescope.DecisionId) =>
        board.createDecision(alice, { workspaceId: a, title, text: "", supersedes });
      const old = yield* board.createDecision(alice, {
        workspaceId: a,
        title: "Postgres",
        text: "",
      });
      const proposal = yield* board.createDecision(alice, {
        workspaceId: a,
        title: "pglite",
        text: "",
        status: "proposed",
        supersedes: old.id,
      });
      const propose = (title: string, supersedes: Telescope.DecisionId) =>
        board.createDecision(alice, {
          workspaceId: a,
          title,
          text: "",
          status: "proposed",
          supersedes,
        });
      const rival = yield* propose("pgvector", old.id);
      yield* propose("Neon", rival.id);
      yield* propose("WAL", proposal.id);
      yield* decide("SQLite", proposal.id);

      const foreign = yield* board.createDecision(alice, { workspaceId: b, title: "B", text: "" });
      const stray = yield* board.createDecision(alice, {
        workspaceId: a,
        title: "stray",
        text: "",
        status: "proposed",
      });
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE telescope_tasks SET supersedes = ${foreign.id} WHERE item_id = ${stray.id}`;
      yield* decide("Adopt stray", stray.id);

      const statuses = (workspaceId: Telescope.WorkspaceId) =>
        board
          .listDecisions(alice, { workspaceId })
          .pipe(
            Effect.map(({ decisions }) => decisions.map((d) => [d.title, d.status]).toSorted()),
          );
      assert.deepStrictEqual(yield* statuses(a), [
        ["Adopt stray", "decided"],
        ["Neon", "superseded"],
        ["Postgres", "superseded"],
        ["SQLite", "decided"],
        ["WAL", "superseded"],
        ["pglite", "superseded"],
        ["pgvector", "superseded"],
        ["stray", "superseded"],
      ]);
      assert.deepStrictEqual(yield* statuses(b), [["B", "decided"]]);
      const decided = yield* board.listCommits(alice, { workspaceId: a, taskId: proposal.id });
      assert.deepStrictEqual(
        decided.commits.map((c) => [c.baseVersion, c.changedFields.status]),
        [
          [0, "proposed"],
          [1, "superseded"],
        ],
      );
    }),
  );

  it.effect("lists only the latest free text, keeps the full history on get and caps entries", () =>
    Effect.gen(function* () {
      const { board, a } = yield* setup;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Chatty" });
      const limit = Telescope.BOARD_LIMITS.freeTextEntries;
      const notes = Array.from({ length: limit }, (_, i) => `note ${i}`);
      yield* Effect.forEach(notes, (note, i) =>
        board.updateTask(alice, { workspaceId: a, taskId: task.id, baseVersion: i + 1, note }),
      );
      const [listed] = (yield* board.listTasks(alice, { workspaceId: a })).tasks;
      assert.deepStrictEqual(
        listed?.freeText.map((e) => e.text),
        notes.slice(-Telescope.BOARD_LIMITS.listedFreeTextEntries),
      );
      const full = yield* board.getTask(alice, { workspaceId: a, taskId: task.id });
      assert.strictEqual(full.freeText.length, limit);

      const atCap = { workspaceId: a, taskId: task.id, baseVersion: limit + 1 };
      const overflow = yield* board
        .updateTask(alice, { ...atCap, note: "one too many" })
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        overflow,
        new Telescope.FreeTextLimitError({ taskId: task.id, limit }),
      );
      const done = yield* board.updateTask(alice, { ...atCap, set: { status: "done" } });
      assert.deepStrictEqual(
        [done.version, done.status, done.freeText.length],
        [limit + 2, "done", limit],
      );
    }),
  );

  it.effect("rejects non-members and keeps workspaces apart", () =>
    Effect.gen(function* () {
      const { board, a, b } = yield* setup;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Secret" });
      yield* board.createDecision(alice, { workspaceId: a, title: "Secret call", text: "" });

      const outsider = { caller: session("mallory") };
      const denied = yield* Effect.all([
        Effect.flip(board.listTasks(outsider, { workspaceId: a })),
        Effect.flip(board.getTask(outsider, { workspaceId: a, taskId: task.id })),
        Effect.flip(board.listDecisions(outsider, { workspaceId: a })),
        Effect.flip(board.listCommits(outsider, { workspaceId: a, taskId: task.id })),
        Effect.flip(board.createTask(outsider, { workspaceId: a, title: "x" })),
        Effect.flip(board.getLease(outsider, { workspaceId: a, taskId: task.id })),
      ]);
      assert.deepStrictEqual(denied.map(reasonOf), Array(6).fill("forbidden"));

      assert.deepStrictEqual((yield* board.listTasks(alice, { workspaceId: b })).tasks, []);
      assert.deepStrictEqual((yield* board.listDecisions(alice, { workspaceId: b })).decisions, []);
      assert.deepStrictEqual(
        (yield* board.listCommits(alice, { workspaceId: b, taskId: task.id })).commits,
        [],
      );
      const foreign = yield* board
        .getTask(alice, { workspaceId: b, taskId: task.id })
        .pipe(Effect.flip);
      assert.strictEqual(reasonOf(foreign), "not_found");
      const crossUpdate = yield* board
        .updateTask(alice, {
          workspaceId: b,
          taskId: task.id,
          baseVersion: 1,
          set: { status: "done" },
        })
        .pipe(Effect.flip);
      assert.strictEqual(reasonOf(crossUpdate), "not_found");
    }),
  );

  it.effect("links a thread to one task at a time and unlinks it without touching others", () =>
    Effect.gen(function* () {
      const { board, a, b, agent } = yield* setup;
      const thread = (id: string) => ({
        environmentId: EnvironmentId.make("env-laptop"),
        threadId: ThreadId.make(id),
      });
      const first = yield* board.createTask(alice, {
        workspaceId: a,
        title: "Gripper",
        threads: [thread("t-1"), thread("t-1")],
      });
      assert.deepStrictEqual(first.threads, [thread("t-1")]);
      const second = yield* board.createTask(alice, { workspaceId: a, title: "Casing" });
      const link = (taskId: Telescope.TaskId, id: string, workspaceId = a) =>
        board.linkThread(alice, { workspaceId, taskId, ...thread(id) });

      const linked = yield* link(second.id, "t-2");
      assert.deepStrictEqual([linked.version, linked.threads], [2, [thread("t-2")]]);
      assert.strictEqual((yield* link(second.id, "t-2")).version, 2, "relinking changes nothing");
      const both = yield* link(second.id, "t-3");
      assert.deepStrictEqual(both.threads, [thread("t-2"), thread("t-3")]);

      const taken = yield* link(second.id, "t-1").pipe(Effect.flip);
      assert.deepStrictEqual(
        [reasonOf(taken), taken.message],
        ["conflict", 'This thread already belongs to the task "Gripper".'],
      );
      const viaUpdate = yield* board
        .updateTask(agent, {
          workspaceId: a,
          taskId: second.id,
          baseVersion: both.version,
          set: { threads: [...both.threads, thread("t-1")] },
        })
        .pipe(Effect.flip);
      assert.strictEqual(reasonOf(viaUpdate), "conflict");
      const elsewhere = yield* board.createTask(alice, { workspaceId: b, title: "Other" });
      const crossed = yield* link(elsewhere.id, "t-2", b).pipe(Effect.flip);
      assert.strictEqual(reasonOf(crossed), "conflict");

      const unlinked = yield* board.unlinkThread(alice, {
        workspaceId: a,
        taskId: second.id,
        ...thread("t-2"),
      });
      assert.deepStrictEqual(unlinked.threads, [thread("t-3")]);
      assert.deepStrictEqual((yield* link(elsewhere.id, "t-2", b)).threads, [thread("t-2")]);
      const { tasks } = yield* board.listTasks(alice, { workspaceId: a });
      assert.deepStrictEqual(tasks.map((task) => [task.title, task.threads]).toSorted(), [
        ["Casing", [thread("t-3")]],
        ["Gripper", [thread("t-1")]],
      ]);
      const { commits } = yield* board.listCommits(alice, { workspaceId: a, taskId: second.id });
      assert.deepStrictEqual(
        commits.map((commit) => commit.changedFields.threads),
        [undefined, [thread("t-2")], [thread("t-2"), thread("t-3")], [thread("t-3")]],
      );

      // Resending the list it read is not a write, so it cannot unlink what a later write linked.
      const stale = yield* board.updateTask(agent, {
        workspaceId: a,
        taskId: second.id,
        baseVersion: 1,
        set: { status: "in_progress", threads: [] },
      });
      assert.deepStrictEqual(
        [stale.status, stale.threads, stale.overwrote],
        ["in_progress", [thread("t-3")], undefined],
      );

      // A task read without links: undoing the writer's own later link lands, as for any field.
      const third = yield* board.createTask(alice, { workspaceId: a, title: "Cover" });
      const own = (baseVersion: number, threads: ReadonlyArray<ReturnType<typeof thread>>) =>
        board.updateTask(agent, {
          workspaceId: a,
          taskId: third.id,
          baseVersion,
          set: { threads },
        });
      yield* own(1, [thread("t-9")]);
      yield* board.updateTask(alice, {
        workspaceId: a,
        taskId: third.id,
        baseVersion: 2,
        set: { title: "Cover v2" },
      });
      assert.deepStrictEqual((yield* own(1, [])).threads, []);
    }),
  );

  it.effect("stamps the threads migration 097 moved with this environment on start", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { board, a, agent } = yield* setup;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Moved" });
      yield* sql`INSERT INTO telescope_task_threads ${sql.insert({
        workspace_id: a,
        task_id: task.id,
        environment_id: "",
        thread_id: "t-moved",
        linked_by: "server",
        linked_at: task.createdAt,
      })}`;
      yield* Layer.build(Layer.fresh(TaskBoardService.layer)).pipe(
        Effect.provide(here),
        Effect.scoped,
      );
      const reread = yield* board.getTask(alice, { workspaceId: a, taskId: task.id });
      const moved = {
        environmentId: EnvironmentId.make("env-elsewhere"),
        threadId: ThreadId.make("t-moved"),
      };
      assert.deepStrictEqual(reread.threads, [moved]);

      // Before 097 the link was a `threadId` field, so the commit log still names it.
      yield* sql`UPDATE telescope_task_commits
        SET changed_fields_json = json_set(changed_fields_json, '$.threadId', 't-moved')
        WHERE task_id = ${task.id}`;
      const added = {
        environmentId: EnvironmentId.make("env-elsewhere"),
        threadId: ThreadId.make("t-added"),
      };
      const update = (baseVersion: number, set: object, actor: TaskBoardService.Actor = alice) =>
        board.updateTask(actor, { workspaceId: a, taskId: task.id, baseVersion, set });
      yield* board.linkThread(alice, { workspaceId: a, taskId: task.id, ...added });
      const keeps = yield* update(1, { status: "in_progress", threads: [moved] }, agent);
      assert.deepStrictEqual(keeps.threads, [moved, added]);

      // The writer read `[moved]`; resending it must not bring back what a member unlinked.
      yield* board.unlinkThread(alice, { workspaceId: a, taskId: task.id, ...moved });
      const resent = yield* update(1, { threads: [moved] }, agent);
      assert.deepStrictEqual(
        [resent.threads, resent.version, resent.overwrote],
        [[added], 4, undefined],
      );

      // A stale write that changes the list it read lands, so it can remove a link and swap it.
      const unlinkedStale = yield* update(1, { threads: [] });
      assert.deepStrictEqual(unlinkedStale.threads, []);
      const fresh = {
        environmentId: EnvironmentId.make("env-elsewhere"),
        threadId: ThreadId.make("t-new"),
      };
      const swapped = yield* update(1, { threads: [fresh] });
      assert.deepStrictEqual(swapped.threads, [fresh]);
    }),
  );

  it.effect("gives a task one lease holder, kept by heartbeats and released on expiry", () =>
    Effect.gen(function* () {
      const { workspaces, board, a, aliceId, agent } = yield* setup;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Contested" });
      const bob = { caller: session("bob") };
      const { code } = yield* workspaces.invite(alice.caller, { workspaceId: a, role: "member" });
      const bobId = (yield* workspaces.accept(bob.caller, { code, displayName: "Bob" })).subjectId;
      const claim = (actor: TaskBoardService.Actor, agent: string) =>
        board.acquireLease({ ...actor, authorId: agent }, { workspaceId: a, taskId: task.id });

      const [first, second] = yield* Effect.all(
        [Effect.result(claim(alice, "agent-a")), Effect.result(claim(bob, "agent-b"))],
        { concurrency: "unbounded" },
      );
      assert.isTrue(first._tag === "Success");
      assert.isTrue(second._tag === "Failure" && reasonOf(second.failure) === "conflict");
      const lease = first._tag === "Success" ? first.success : yield* Effect.die("no lease");
      const leased = yield* board.getTask(bob, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual([leased.leaseId, leased.version], [lease.id, 2]);
      const read = { workspaceId: a, taskId: task.id };
      assert.deepStrictEqual(yield* board.getLease(bob, read), { lease });

      yield* TestClock.adjust("90 seconds");
      const scoped = { workspaceId: a, leaseId: lease.id };
      const stolen = yield* board.heartbeatLease(bob, scoped).pipe(Effect.flip);
      assert.strictEqual(reasonOf(stolen), "forbidden");
      const renewed = yield* board.heartbeatLease(alice, scoped);
      assert.isTrue(renewed.expiresAt > lease.expiresAt);
      yield* TestClock.adjust("90 seconds");
      assert.strictEqual(reasonOf(yield* Effect.flip(claim(bob, "agent-b"))), "conflict");

      yield* TestClock.adjust("60 seconds");
      assert.deepStrictEqual(yield* board.getLease(bob, read), {});
      const lapsed = yield* board.getTask(bob, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual([lapsed.leaseId, lapsed.version], [undefined, 3]);
      const expired = yield* board.heartbeatLease(alice, scoped).pipe(Effect.flip);
      assert.strictEqual(reasonOf(expired), "not_found");

      const next = yield* claim(bob, "agent-b");
      yield* board.releaseLease(bob, { workspaceId: a, leaseId: next.id });
      const released = yield* board.getTask(alice, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual([released.leaseId, released.version], [undefined, 5]);
      const { commits } = yield* board.listCommits(alice, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual(
        commits.slice(1).map((c) => [c.authorId, c.changedFields]),
        [
          ["agent-a", { leaseId: lease.id }],
          ["server", { leaseId: null }],
          ["agent-b", { leaseId: next.id }],
          [bobId, { leaseId: null }],
        ],
      );

      // Over RPC the actor is only the session; a payload cannot name the author.
      const payload = decodeLeaseAcquire({
        workspaceId: a,
        taskId: task.id,
        agentId: "server",
      });
      const own = yield* board.acquireLease(alice, payload);
      assert.strictEqual(own.holderAgentId, aliceId);
      const signed = yield* board.listCommits(alice, { workspaceId: a, taskId: task.id });
      assert.strictEqual(signed.commits.at(-1)?.authorId, aliceId);
      const write = (actor: TaskBoardService.Actor, title: string) =>
        board.updateTask(actor, {
          workspaceId: a,
          taskId: task.id,
          baseVersion: 6,
          set: { title },
        });
      yield* write(bob, "Bob's");
      const kept = yield* write(alice, "Alice's");
      assert.deepStrictEqual([kept.title, kept.version], ["Alice's", 8]);

      // An agent renews only between tool calls, so its lease lasts 15 minutes (D59).
      const build = yield* board.createTask(alice, { workspaceId: a, title: "Long build" });
      const long = yield* board.acquireLease(agent, { workspaceId: a, taskId: build.id });
      yield* TestClock.adjust("14 minutes");
      const longer = yield* board.heartbeatLease(agent, { workspaceId: a, leaseId: long.id });
      const byMember = yield* board.heartbeatLease(alice, { workspaceId: a, leaseId: long.id });
      assert.deepStrictEqual(
        [longer, byMember].map((l) => Date.parse(l.expiresAt) - Date.parse(l.heartbeatAt)),
        [15 * 60_000, 15 * 60_000],
      );
    }),
  );

  it.effect("a stale write lands last-writer-wins and reports what it overwrote", () =>
    Effect.gen(function* () {
      const { workspaces, board, a, aliceId, agent } = yield* setup;
      const bob = { caller: session("bob") };
      const { code } = yield* workspaces.invite(alice.caller, { workspaceId: a, role: "member" });
      const bobId = (yield* workspaces.accept(bob.caller, { code, displayName: "Bob" })).subjectId;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Plan" });
      const update = (
        actor: TaskBoardService.Actor,
        baseVersion: number,
        set: object,
        note?: string,
      ) =>
        board.updateTask(actor, {
          workspaceId: a,
          taskId: task.id,
          baseVersion,
          set,
          ...(note === undefined ? {} : { note }),
        });
      const lastCommit = Effect.map(
        board.listCommits(alice, { workspaceId: a, taskId: task.id }),
        ({ commits }) => commits.at(-1),
      );

      const done = yield* update(alice, 1, { title: "Plan v2", status: "done" });
      yield* TestClock.adjust("1 minute");
      yield* update(alice, 2, { goalChain: ["Q4"] });
      const late = yield* board.updateTask(bob, {
        workspaceId: a,
        taskId: task.id,
        baseVersion: 1,
        set: { title: "Plan B", status: "in_progress", goalChain: ["Q4"] },
        note: "I renamed it first.",
      });
      assert.deepStrictEqual(
        [late.title, late.status, late.goalChain, late.version, late.conflictDecisionId],
        ["Plan B", "in_progress", ["Q4"], 4, undefined],
      );
      assert.deepStrictEqual(late.overwrote, [
        { key: "title", by: aliceId, name: "Alice", at: done.updatedAt },
        { key: "status", by: aliceId, name: "Alice", at: done.updatedAt },
      ]);
      const landed = yield* lastCommit;
      assert.deepStrictEqual(
        [Object.keys(landed?.changedFields ?? {}), landed?.mergeLevel, landed?.mergeReason],
        [["title", "status", "freeText"], 0, "based on version 1"],
      );
      const echoed = yield* update(agent, 1, { status: "todo", goalChain: [] });
      assert.deepStrictEqual(
        [echoed.status, echoed.goalChain, echoed.version],
        ["in_progress", ["Q4"], 4],
      );

      const holder = { ...alice, authorId: "agent-h" };
      yield* board.acquireLease(holder, { workspaceId: a, taskId: task.id });
      const held = yield* update(holder, 5, { title: "Holder's plan" });
      const over = yield* update(bob, 5, { title: "Bob's plan" });
      const again = yield* update(bob, 5, { title: "Bob's plan, again" });
      assert.deepStrictEqual(
        [held.overwrote, over.title, over.overwrote],
        [
          undefined,
          "Bob's plan",
          [{ key: "title", by: "agent-h", name: "agent-h", at: held.updatedAt }],
        ],
      );
      assert.deepStrictEqual(
        [again.title, again.version, again.overwrote],
        ["Bob's plan, again", 8, undefined],
      );

      yield* update(alice, 8, { status: "done" });
      const reopened = yield* update(agent, 8, { status: "in_review" });
      assert.deepStrictEqual(
        [reopened.status, reopened.version, reopened.overwrote],
        ["in_review", 10, [{ key: "status", by: aliceId, name: "Alice", at: reopened.updatedAt }]],
      );
      yield* update(agent, 10, { status: "needs_decision" });
      const answered = yield* update(bob, 10, { status: "in_progress" });
      assert.deepStrictEqual(
        [answered.status, answered.overwrote?.map((o) => o.by)],
        ["in_progress", ["agent-cos"]],
      );
      yield* update(agent, 12, { status: "needs_decision" });
      const moved = yield* Effect.all([
        Effect.flip(update(agent, 13, { status: "in_progress" })),
        Effect.flip(update(agent, 12, { status: "in_progress" })),
      ]);
      assert.deepStrictEqual(moved.map(reasonOf), ["forbidden", "forbidden"]);

      // A company agent serving two members is one author but writes for each of them.
      const forAlice = { ...alice, authorId: "agent-co", onBehalfOf: [aliceId, "agent-co"] };
      const forBob = { ...bob, authorId: "agent-co", onBehalfOf: [bobId, "agent-co"] };
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO telescope_agents ${sql.insert({
        agent_id: "agent-co",
        workspace_id: a,
        kind: "custom",
        name: "Ops",
        standing_powers_json: "{}",
        exposure: "hidden",
        sync_with_board: 0,
        dispatch_mode: "inbox",
        channels_json: "[]",
        created_at: task.createdAt,
        updated_at: task.createdAt,
      })}`;
      const viaCo = yield* update(forAlice, 13, { title: "Alice's via co" });
      const lateCo = yield* update(forBob, 13, { title: "Bob's via co" });
      assert.deepStrictEqual(
        [lateCo.title, lateCo.version, lateCo.overwrote],
        [
          "Bob's via co",
          15,
          [{ key: "title", by: "agent-co", name: "Ops for Alice", at: viaCo.updatedAt }],
        ],
      );
      const renamed = yield* update(bob, 15, { title: "Bob's title" });
      const resent = yield* update(agent, 15, { title: "Bob's via co", goalChain: ["Q1"] });
      assert.deepStrictEqual(
        [resent.title, resent.goalChain, resent.version, resent.overwrote],
        ["Bob's title", ["Q1"], 17, undefined],
      );
      const changed = yield* update(agent, 15, { title: "Agent's title" });
      assert.deepStrictEqual(
        [changed.title, changed.overwrote],
        ["Agent's title", [{ key: "title", by: bobId, name: "Bob", at: renamed.updatedAt }]],
      );

      yield* update(bob, 18, { status: "in_progress" });
      yield* update(agent, 19, { title: "Agent's title v2", status: "in_review" });
      const reverted = yield* update(agent, 19, { title: "Agent's title", status: "in_progress" });
      assert.deepStrictEqual(
        [reverted.title, reverted.status, reverted.version, reverted.overwrote],
        ["Agent's title", "in_progress", 21, undefined],
      );
      yield* update(agent, 21, { title: "Agent's title v3" });
      const noted = yield* update(agent, 21, { title: "Agent's title" }, "Put the title back.");
      assert.deepStrictEqual(
        [noted.title, noted.version, noted.freeText.at(-1)?.text, noted.overwrote],
        ["Agent's title", 23, "Put the title back.", undefined],
      );
      yield* update(bob, 23, { status: "needs_decision" });
      const resentHeld = yield* Effect.flip(update(agent, 23, { status: "in_progress" }));
      assert.strictEqual(reasonOf(resentHeld), "forbidden");
      assert.deepStrictEqual((yield* board.listDecisions(alice, { workspaceId: a })).decisions, []);

      yield* update(agent, 24, { title: "Agent's title v4" });
      const bobsAgain = yield* update(bob, 25, { title: "Bob's title v2" });
      const undone = yield* update(agent, 24, { title: "Agent's title" });
      assert.deepStrictEqual(
        [undone.title, undone.version, undone.overwrote],
        ["Agent's title", 27, [{ key: "title", by: bobId, name: "Bob", at: bobsAgain.updatedAt }]],
      );

      // Bob's personal agent stays hidden from Alice, so the result names only Bob.
      yield* sql`INSERT INTO telescope_agents ${sql.insert({
        agent_id: "agent-bob",
        workspace_id: a,
        owner_subject_id: bobId,
        kind: "chief_of_staff",
        name: "Bob's secret helper",
        standing_powers_json: "{}",
        exposure: "hidden",
        sync_with_board: 0,
        dispatch_mode: "inbox",
        channels_json: "[]",
        created_at: task.createdAt,
        updated_at: task.createdAt,
      })}`;
      const bobsAgent = { ...bob, authorId: "agent-bob", onBehalfOf: [bobId, "agent-bob"] };
      const secret = yield* update(bobsAgent, 27, { title: "Secret plan" });
      const unnamed = yield* update(alice, 27, { title: "Alice's plan" });
      assert.deepStrictEqual(unnamed.overwrote, [
        { key: "title", by: "agent-bob", name: "an agent for Bob", at: secret.updatedAt },
      ]);
      const wire = JSON.stringify(yield* encodeUpdateResult(unnamed));
      assert.notInclude(wire, "secret helper");
      const secretAgain = yield* update(bobsAgent, 29, { title: "Secret plan v2" });
      const named = yield* update(forBob, 29, { title: "Bob's plan via co" });
      assert.deepStrictEqual(named.overwrote, [
        {
          key: "title",
          by: "agent-bob",
          name: "Bob's secret helper for Bob",
          at: secretAgain.updatedAt,
        },
      ]);

      // Once shown, it is named only while its project is mounted and Bob is still a member.
      yield* sql`UPDATE telescope_agents SET kind = 'chief_agent', project_id = 'project-1',
        exposure = 'visible' WHERE agent_id = 'agent-bob'`;
      yield* sql`INSERT INTO telescope_project_mounts ${sql.insert({
        workspace_id: a,
        environment_id: "env-elsewhere",
        project_id: "project-1",
        telescope_project_id: "telescope-1",
      })}`;
      const shown = yield* update(bobsAgent, 31, { title: "Shown plan" });
      const shownOver = yield* update(alice, 31, { title: "Alice's plan v2" });
      yield* update(bobsAgent, 33, { title: "Last plan" });
      yield* workspaces.revoke(alice.caller, { workspaceId: a, subjectId: bobId });
      const former = yield* update(alice, 33, { title: "Alice's plan v3" });
      assert.deepStrictEqual(
        [shownOver.overwrote?.[0]?.name, shownOver.overwrote?.[0]?.at, former.overwrote?.[0]?.name],
        ["Bob's secret helper for Bob", shown.updatedAt, "an agent for Bob"],
      );
    }),
  );

  it.effect("settles old conflict proposals and keeps their marker from stale writes", () =>
    Effect.gen(function* () {
      const { board, a, aliceId, agent } = yield* setup;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Plan" });
      const update = (actor: TaskBoardService.Actor, baseVersion: number, set: object) =>
        board.updateTask(actor, { workspaceId: a, taskId: task.id, baseVersion, set });
      const decisions = Effect.map(
        board.listDecisions(alice, { workspaceId: a }),
        ({ decisions }) => decisions,
      );
      const current = board.getTask(alice, { workspaceId: a, taskId: task.id });
      const decide = (supersedes: Telescope.DecisionId | undefined, chosen: string) =>
        board.createDecision(alice, {
          workspaceId: a,
          title: "Settle",
          text: "",
          chosen,
          ...(supersedes === undefined ? {} : { supersedes }),
        });
      // Older servers opened these for stale writes; a write no longer does.
      const sql = yield* SqlClient.SqlClient;
      const seedConflict = (title: string, legacy: object = {}) =>
        Effect.gen(function* () {
          const proposal = yield* board.createDecision(alice, {
            workspaceId: a,
            title: "冲突：Plan",
            text: "",
            status: "proposed",
          });
          const conflict = JSON.stringify({ taskId: task.id, incoming: { title, ...legacy } });
          yield* sql`UPDATE telescope_tasks SET conflict_json = ${conflict} WHERE item_id = ${proposal.id}`;
          yield* sql`UPDATE telescope_tasks SET conflict_decision_id = ${proposal.id} WHERE item_id = ${task.id}`;
          return proposal.id;
        });

      yield* update(alice, 1, { title: "Plan A" });
      const d1 = yield* seedConflict("Plan B");
      const d2 = yield* seedConflict("Plan C");
      const staleClear = yield* update(alice, 1, { conflictDecisionId: null });
      assert.deepStrictEqual(
        [staleClear.conflictDecisionId, staleClear.conflict, (yield* decisions).length],
        [d2, undefined, 2],
      );
      const holder = { ...alice, authorId: "agent-h" };
      yield* board.acquireLease(holder, { workspaceId: a, taskId: task.id });
      yield* update(holder, 2, { conflictDecisionId: null });
      assert.strictEqual((yield* current).conflictDecisionId, d2);
      const { version } = yield* current;
      const agentSettle = { workspaceId: a, title: "Settle", text: "", supersedes: d2 };
      const refused = yield* Effect.all([
        Effect.flip(update(agent, version, { conflictDecisionId: null })),
        Effect.flip(update(agent, version, { title: "Agent plan" })),
        Effect.flip(board.createDecision(agent, { ...agentSettle, chosen: "incoming" })),
        Effect.flip(board.createDecision(agent, { ...agentSettle, status: "proposed" })),
      ]);
      assert.deepStrictEqual(refused.map(reasonOf), Array(4).fill("forbidden"));
      const other = yield* board.createTask(alice, { workspaceId: a, title: "Other" });
      const elsewhere = yield* board.updateTask(agent, {
        workspaceId: a,
        taskId: other.id,
        baseVersion: 1,
        set: { title: "Agent plan" },
      });
      assert.strictEqual(elsewhere.title, "Agent plan", "d2 holds title on its own task only");
      yield* update(agent, version, { status: "in_review" });
      yield* update(alice, version + 1, { goalChain: ["Q4"] });
      const late = yield* update(agent, version, { goalChain: ["Q1"] });
      assert.deepStrictEqual(
        [late.goalChain, late.conflictDecisionId, late.overwrote?.map((o) => [o.key, o.by])],
        [["Q1"], d2, [["goalChain", aliceId]]],
      );

      yield* decide(d2, "incoming");
      const applied = yield* current;
      assert.deepStrictEqual(
        [applied.title, applied.conflictDecisionId, applied.version],
        ["Plan C", undefined, 7],
      );
      const orphaned = yield* Effect.flip(update(agent, applied.version, { title: "Agent plan" }));
      assert.strictEqual(reasonOf(orphaned), "forbidden");
      yield* decide(d1, "incoming");
      assert.strictEqual((yield* current).title, "Plan C");

      yield* decide(yield* seedConflict("Plan D"), "keep");
      const kept = yield* current;
      assert.deepStrictEqual(
        [kept.title, kept.conflictDecisionId, kept.version],
        ["Plan C", undefined, 8],
      );
      const settled = yield* update(agent, kept.version, { title: "Agent plan" });
      assert.strictEqual(settled.title, "Agent plan");

      // Deciding a member's counter-proposal settles the marked proposal it replaces.
      const d4 = yield* seedConflict("Plan E");
      const counter = yield* board.createDecision(alice, {
        workspaceId: a,
        title: "Counter",
        text: "",
        status: "proposed",
        supersedes: d4,
        options: [
          { id: "keep", label: "Keep" },
          { id: "incoming", label: "Incoming" },
        ],
      });
      const answer = yield* decide(counter.id, "incoming");
      const adopted = yield* current;
      assert.deepStrictEqual([adopted.title, adopted.conflictDecisionId], ["Plan E", undefined]);
      const { commits } = yield* board.listCommits(alice, { workspaceId: a, taskId: task.id });
      assert.strictEqual(commits.at(-1)?.mergeReason, `settled by decision ${answer.id}`);
      assert.deepStrictEqual(
        (yield* decisions).filter((d) => d.status === "proposed"),
        [],
      );

      // An older server's proposal may carry `threadId`, a column migration 097 dropped.
      yield* decide(yield* seedConflict("Plan F", { threadId: "t-old" }), "incoming");
      const legacy = yield* current;
      assert.deepStrictEqual(
        [legacy.title, legacy.conflictDecisionId, legacy.threads],
        ["Plan F", undefined, [{ environmentId: "env-elsewhere", threadId: "t-old" }]],
      );

      // `threadId` is the link, so the proposal holds it against agents, and `null` unlinks.
      const unlink = yield* seedConflict("Plan G", { threadId: null });
      const held = yield* Effect.flip(update(agent, legacy.version, { threads: [] }));
      assert.strictEqual(reasonOf(held), "forbidden");
      yield* decide(unlink, "incoming");
      assert.deepStrictEqual((yield* current).threads, []);
    }),
  );
});
