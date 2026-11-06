import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(TaskBoardService.layer, WorkspaceService.layer).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
);

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);
const isStale = Schema.is(Telescope.StaleTaskVersionError);
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
  it.effect("records a commit per write and merges a stale write on other fields", () =>
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

      const merged = yield* board.updateTask(alice, {
        workspaceId: a,
        taskId: task.id,
        baseVersion: 2,
        set: { status: "done" },
      });
      assert.deepStrictEqual(
        [merged.version, merged.status, merged.ownerAgentId, merged.freeText.length],
        [4, "done", undefined, 2],
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
        [{ status: "done" }, 0, "rebased from version 2"],
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
      const second = yield* board.createDecision(agent, {
        workspaceId: a,
        title: "SQLite",
        text: "One engine.",
        supersedes: first.id,
      });
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
          ["pglite", "proposed", 1, first.id],
        ],
      );
      const again = yield* board
        .createDecision(alice, { workspaceId: a, title: "MySQL", text: "", supersedes: first.id })
        .pipe(Effect.flip);
      assert.strictEqual(reasonOf(again), "conflict");
      assert.strictEqual(second.authorId, "agent-cos");

      const { commits } = yield* board.listCommits(alice, { workspaceId: a, taskId: first.id });
      assert.deepStrictEqual(
        commits.map((c) => [c.baseVersion, c.authorId, c.onBehalfOf, c.parentId, c.changedFields]),
        [
          [0, aliceId, undefined, undefined, { title: "Postgres", text: "", status: "decided" }],
          [1, "agent-cos", [aliceId, "agent-cos"], commits[0]?.id, { status: "superseded" }],
        ],
      );
      const proposed = yield* board.listCommits(alice, { workspaceId: a, taskId: proposal.id });
      assert.deepStrictEqual(
        proposed.commits.map((c) => c.changedFields),
        [{ title: "pglite", text: "", status: "proposed", supersedes: first.id }],
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
        ["Postgres", "superseded"],
        ["SQLite", "decided"],
        ["pglite", "superseded"],
        ["stray", "superseded"],
      ]);
      assert.deepStrictEqual(yield* statuses(b), [["B", "decided"]]);
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
      ]);
      assert.deepStrictEqual(denied.map(reasonOf), Array(5).fill("forbidden"));

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

  it.effect("gives a task one lease holder, kept by heartbeats and released on expiry", () =>
    Effect.gen(function* () {
      const { workspaces, board, a } = yield* setup;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Contested" });
      const bob = { caller: session("bob") };
      const { code } = yield* workspaces.invite(alice.caller, { workspaceId: a, role: "member" });
      const bobId = (yield* workspaces.accept(bob.caller, { code, displayName: "Bob" })).subjectId;
      const claim = (actor: TaskBoardService.Actor, agent: string) =>
        board.acquireLease(actor, {
          workspaceId: a,
          taskId: task.id,
          agentId: Telescope.AgentId.make(agent),
        });

      const [first, second] = yield* Effect.all(
        [Effect.result(claim(alice, "agent-a")), Effect.result(claim(bob, "agent-b"))],
        { concurrency: "unbounded" },
      );
      assert.isTrue(first._tag === "Success");
      assert.isTrue(second._tag === "Failure" && reasonOf(second.failure) === "conflict");
      const lease = first._tag === "Success" ? first.success : yield* Effect.die("no lease");
      const leased = yield* board.getTask(bob, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual([leased.leaseId, leased.version], [lease.id, 2]);

      yield* TestClock.adjust("90 seconds");
      const scoped = { workspaceId: a, leaseId: lease.id };
      const stolen = yield* board.heartbeatLease(bob, scoped).pipe(Effect.flip);
      assert.strictEqual(reasonOf(stolen), "forbidden");
      const renewed = yield* board.heartbeatLease(alice, scoped);
      assert.isTrue(renewed.expiresAt > lease.expiresAt);
      yield* TestClock.adjust("90 seconds");
      assert.strictEqual(reasonOf(yield* Effect.flip(claim(bob, "agent-b"))), "conflict");

      yield* TestClock.adjust("60 seconds");
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
    }),
  );

  it.effect("merges stale writes by rule and sends unsettled conflicts to a decision", () =>
    Effect.gen(function* () {
      const { workspaces, board, a } = yield* setup;
      const bob = { caller: session("bob") };
      const { code } = yield* workspaces.invite(alice.caller, { workspaceId: a, role: "member" });
      yield* workspaces.accept(bob.caller, { code, displayName: "Bob" });
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Plan" });
      const update = (actor: TaskBoardService.Actor, baseVersion: number, set: object) =>
        board.updateTask(actor, { workspaceId: a, taskId: task.id, baseVersion, set });
      const lastCommit = Effect.map(
        board.listCommits(alice, { workspaceId: a, taskId: task.id }),
        ({ commits }) => commits.at(-1),
      );

      yield* update(alice, 1, { title: "Plan v2", status: "done" });
      const kept = yield* update(bob, 1, { title: "Plan", status: "in_progress" });
      assert.deepStrictEqual([kept.title, kept.status, kept.version], ["Plan v2", "done", 3]);
      const ruled = yield* lastCommit;
      assert.deepStrictEqual(
        [ruled?.changedFields, ruled?.mergeLevel, ruled?.mergeReason],
        [{}, 1, 'rebased from version 1; status: status only moves forward, kept "done"'],
      );

      const conflicted = yield* board.updateTask(bob, {
        workspaceId: a,
        taskId: task.id,
        baseVersion: 1,
        set: { title: "Plan B" },
        note: "I renamed it first.",
      });
      assert.deepStrictEqual(
        [conflicted.title, conflicted.status, conflicted.freeText.map((e) => e.text)],
        ["Plan v2", "needs_decision", ["I renamed it first."]],
      );
      const [decision] = (yield* board.listDecisions(alice, { workspaceId: a })).decisions;
      assert.strictEqual(decision?.status, "proposed");
      assert.deepStrictEqual(JSON.parse(decision?.text ?? "{}").conflicts, {
        title: { current: "Plan v2", incoming: "Plan B" },
      });
      const escalated = yield* lastCommit;
      assert.deepStrictEqual(
        [escalated?.changedFields.status, escalated?.mergeLevel, escalated?.mergeReason],
        ["needs_decision", 2, `no rule settles title; decision ${decision?.id}`],
      );

      const holder = { ...alice, authorId: "agent-h" };
      yield* board.acquireLease(alice, {
        workspaceId: a,
        taskId: task.id,
        agentId: Telescope.AgentId.make("agent-h"),
      });
      yield* update(bob, 5, { title: "Bob's plan" });
      const won = yield* update(holder, 5, { title: "Holder's plan" });
      assert.deepStrictEqual([won.title, won.version], ["Holder's plan", 7]);
      assert.strictEqual(
        (yield* lastCommit)?.mergeReason,
        'rebased from version 5; title: lease holder wins, kept "Holder\'s plan"',
      );

      const race = yield* board.createTask(alice, { workspaceId: a, title: "Race" });
      const write = (actor: TaskBoardService.Actor, baseVersion: number, set: object) =>
        board.updateTask(actor, { workspaceId: a, taskId: race.id, baseVersion, set });
      const raceCommit = Effect.map(
        board.listCommits(alice, { workspaceId: a, taskId: race.id }),
        ({ commits }) => commits.at(-1),
      );
      yield* board.acquireLease(alice, {
        workspaceId: a,
        taskId: race.id,
        agentId: Telescope.AgentId.make("agent-h"),
      });
      yield* write(bob, 2, { status: "done" });
      const forward = yield* write(holder, 2, { status: "in_progress" });
      assert.deepStrictEqual([forward.status, forward.version], ["done", 4]);
      assert.strictEqual(
        (yield* raceCommit)?.mergeReason,
        'rebased from version 2; status: status only moves forward, kept "done"',
      );

      yield* write(alice, 4, { status: "needs_decision" });
      const held = yield* write(bob, 4, { status: "in_progress" });
      assert.deepStrictEqual([held.status, held.version], ["needs_decision", 6]);
      assert.strictEqual((yield* raceCommit)?.mergeLevel, 1);
      const { decisions } = yield* board.listDecisions(alice, { workspaceId: a });
      assert.strictEqual(decisions.length, 1);
    }),
  );
});
