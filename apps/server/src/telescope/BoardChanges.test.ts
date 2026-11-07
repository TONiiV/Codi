import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, Telescope } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as BoardChanges from "./BoardChanges.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
// The board publishes to the same hub the watchers read, as the server composes it.
const layer = Layer.mergeAll(
  TaskBoardService.layer,
  BoardChanges.layer,
  WorkspaceService.layer,
).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env-elsewhere")),
    }),
  ),
);

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);
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
  const changes = yield* BoardChanges.BoardChanges;
  const create = (name: string) =>
    workspaces.create(alice.caller, { kind: "enterprise", name, displayName: "Alice" });
  const a = (yield* create("A")).id;
  const b = (yield* create("B")).id;
  const { self } = yield* workspaces.get(alice.caller, { workspaceId: a });
  const agent = { ...alice, authorId: "agent-cos", onBehalfOf: [self.subjectId, "agent-cos"] };
  return { workspaces, board, changes, a, b, agent };
});

/** Returns once the watch is subscribed, so every later write reaches it. */
const watching = Effect.fn("BoardChangesTest.watching")(function* (
  caller: WorkspaceService.Caller,
  workspaceId: Telescope.WorkspaceId,
) {
  const changes = yield* BoardChanges.BoardChanges;
  const items = yield* Queue.unbounded<Telescope.BoardWatchItem>();
  const fiber = yield* changes.watch(caller, { workspaceId }).pipe(
    Stream.runForEach((item) => Queue.offer(items, item)),
    Effect.forkScoped({ startImmediately: true }),
  );
  assert.deepStrictEqual(yield* Queue.take(items), { kind: "synchronized" });
  // The next item, or the error that ended the watch instead.
  const next = Effect.raceFirst(
    Queue.take(items),
    Fiber.join(fiber).pipe(
      Effect.flip,
      Effect.map((error) => reasonOf(error)),
    ),
  );
  return { items, fiber, next };
});

const changes = (...list: ReadonlyArray<Telescope.BoardChange>): Telescope.BoardWatchItem => ({
  kind: "changes",
  changes: list,
});

it.layer(layer)("Telescope board changes", (it) => {
  it.effect("sends each committed write once, to watchers of its workspace only", () =>
    Effect.gen(function* () {
      const { board, changes: hub, a, b, agent } = yield* setup;
      const inA = yield* watching(alice.caller, a);
      const inB = yield* watching(alice.caller, b);

      const task = yield* board.createTask(alice, { workspaceId: a, title: "Ship invites" });
      const decision = yield* board.createDecision(alice, {
        workspaceId: b,
        title: "Postgres",
        text: "",
      });
      const notice = (version: number): Telescope.BoardChange => ({
        kind: "task",
        workspaceId: a,
        id: task.id,
        version,
      });
      // Each watcher's first item is its own workspace's write, though B's committed in between.
      assert.deepStrictEqual(yield* inA.next, changes(notice(1)));
      assert.deepStrictEqual(
        yield* inB.next,
        changes({ kind: "decision", workspaceId: b, id: decision.id, version: 1 }),
      );
      const input = { workspaceId: a, taskId: task.id, baseVersion: 1 };
      yield* board.updateTask(agent, { ...input, set: { status: "in_progress" } });
      assert.deepStrictEqual(yield* inA.next, changes(notice(2)));

      // A write that changes nothing, and ones that roll back, send nothing.
      yield* board.updateTask(alice, { ...input, baseVersion: 2, set: { status: "in_progress" } });
      const sql = yield* SqlClient.SqlClient;
      const rollback = <A>(write: Effect.Effect<A>) =>
        Effect.flip(sql.withTransaction(write.pipe(Effect.andThen(Effect.fail("rollback")))));
      assert.strictEqual(yield* rollback(hub.publish(notice(9))), "rollback");
      assert.strictEqual(yield* rollback(hub.batch(hub.publish(notice(9)))), "rollback");
      yield* board.acquireLease(agent, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual(yield* inA.next, changes(notice(3)));
      yield* TestClock.adjust("16 minutes");
      yield* board.listTasks(alice, { workspaceId: a });
      yield* board.listTasks(alice, { workspaceId: a });
      assert.deepStrictEqual(yield* inA.next, changes(notice(4)));
      // The expiry went out exactly once: the next item is the next write's.
      const after = yield* board.createTask(alice, { workspaceId: a, title: "After expiry" });
      assert.deepStrictEqual(
        yield* inA.next,
        changes({ kind: "task", workspaceId: a, id: after.id, version: 1 }),
      );
      // Taking over an expired lease commits the task twice in one write: one notice, the newest.
      yield* board.acquireLease(agent, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual(yield* inA.next, changes(notice(5)));
      yield* TestClock.adjust("16 minutes");
      yield* board.acquireLease(agent, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual(yield* inA.next, changes(notice(7)));
    }),
  );

  it.effect("sends one item for a decide that retires a proposal and its target", () =>
    Effect.gen(function* () {
      const { board, a } = yield* setup;
      const create = (input: Omit<typeof Telescope.DecisionCreateInput.Type, "workspaceId">) =>
        board.createDecision(alice, { workspaceId: a, ...input });
      const first = yield* create({ title: "Postgres", text: "" });
      const proposal = yield* create({
        title: "SQLite",
        text: "",
        status: "proposed",
        supersedes: first.id,
      });
      const watch = yield* watching(alice.caller, a);

      const decided = yield* create({ title: "SQLite", text: "", supersedes: proposal.id });
      const notice = (id: Telescope.DecisionId, version: number): Telescope.BoardChange => ({
        kind: "decision",
        workspaceId: a,
        id,
        version,
      });
      assert.deepStrictEqual(
        yield* watch.next,
        changes(notice(proposal.id, 2), notice(first.id, 2), notice(decided.id, 1)),
      );
      const later = yield* create({ title: "Later", text: "" });
      assert.deepStrictEqual(yield* watch.next, changes(notice(later.id, 1)));
    }),
  );

  it.effect("queues a watcher one entry per write, and ends its watch when it falls behind", () =>
    Effect.gen(function* () {
      const { board, changes: hub, a } = yield* setup;
      const first = yield* board.createDecision(alice, {
        workspaceId: a,
        title: "Postgres",
        text: "",
      });
      const proposal = yield* board.createDecision(alice, {
        workspaceId: a,
        title: "SQLite",
        text: "",
        status: "proposed",
        supersedes: first.id,
      });
      const pull = yield* Stream.toPull(hub.watch(alice.caller, { workspaceId: a }));
      assert.deepStrictEqual(yield* pull, [{ kind: "synchronized" }]);
      // A decide commits three items in one write, so it takes one of the backlog's places.
      yield* board.createDecision(alice, {
        workspaceId: a,
        title: "SQLite",
        text: "",
        supersedes: proposal.id,
      });
      for (let index = 1; index <= BoardChanges.WATCH_BACKLOG; index++)
        yield* board.createTask(alice, { workspaceId: a, title: `Task ${index}` });
      const [queued] = yield* pull;
      assert.strictEqual(
        queued?.kind === "changes" && queued.changes.length,
        BoardChanges.WATCH_BACKLOG + 2,
      );
      // It stays ended, though its backlog has room again.
      yield* board.createTask(alice, { workspaceId: a, title: "Once drained" });
      assert.strictEqual(reasonOf(yield* Effect.flip(pull)), "expired");
    }),
  );

  it.effect("delivers a write that commits while the watch checks membership", () =>
    Effect.gen(function* () {
      const { board, changes: hub, a } = yield* setup;
      const sql = yield* SqlClient.SqlClient;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Held" });
      const inTransaction = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const held: Telescope.BoardChange = { kind: "task", workspaceId: a, id: task.id, version: 9 };
      const writer = yield* sql
        .withTransaction(
          hub.batch(
            Effect.gen(function* () {
              yield* hub.publish(held);
              yield* Deferred.succeed(inTransaction, undefined);
              yield* Deferred.await(release);
            }),
          ),
        )
        .pipe(Effect.forkScoped({ startImmediately: true }));
      yield* Deferred.await(inTransaction);
      // The watch's membership read waits behind the open transaction until the write commits.
      const items = yield* Queue.unbounded<Telescope.BoardWatchItem>();
      yield* hub.watch(alice.caller, { workspaceId: a }).pipe(
        Stream.runForEach((item) => Queue.offer(items, item)),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(writer);
      assert.deepStrictEqual(yield* Queue.take(items), { kind: "synchronized" });
      yield* board.createTask(alice, { workspaceId: a, title: "Sentinel" });
      assert.deepStrictEqual(yield* Queue.take(items), changes(held));
    }),
  );

  it.effect("refuses a watch to anyone who is not a member", () =>
    Effect.gen(function* () {
      const { changes: hub, a } = yield* setup;
      const denied = yield* hub
        .watch(session("mallory"), { workspaceId: a })
        .pipe(Stream.runHead, Effect.flip);
      assert.strictEqual(reasonOf(denied), "forbidden");
    }),
  );

  it.effect("ends a revoked member's watch before it sees another notice", () =>
    Effect.gen(function* () {
      const { workspaces, board, a } = yield* setup;
      const bob = session("bob");
      const { code } = yield* workspaces.invite(alice.caller, { workspaceId: a, role: "member" });
      const bobId = (yield* workspaces.accept(bob, { code, displayName: "Bob" })).subjectId;
      const watch = yield* watching(bob, a);

      yield* workspaces.revoke(alice.caller, { workspaceId: a, subjectId: bobId });
      yield* board.createTask(alice, { workspaceId: a, title: "After Bob left" });
      assert.strictEqual(yield* watch.next, "forbidden");
    }),
  );
});
