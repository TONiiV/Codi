import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, Telescope } from "@t3tools/contracts";
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
  return { items, fiber };
});

it.layer(layer)("Telescope board changes", (it) => {
  it.effect("sends each committed write once, to watchers of its workspace only", () =>
    Effect.gen(function* () {
      const { board, changes, a, b, agent } = yield* setup;
      const inA = yield* watching(alice.caller, a);
      const inB = yield* watching(alice.caller, b);
      const next = Queue.take(inA.items);

      const task = yield* board.createTask(alice, { workspaceId: a, title: "Ship invites" });
      const notice = (version: number): Telescope.BoardChange => ({
        kind: "task",
        workspaceId: a,
        id: task.id,
        version,
      });
      assert.deepStrictEqual(yield* next, notice(1));
      const input = { workspaceId: a, taskId: task.id, baseVersion: 1 };
      yield* board.updateTask(agent, { ...input, set: { status: "in_progress" } });
      assert.deepStrictEqual(yield* next, notice(2));

      // A write that changes nothing, and one that rolls back, send nothing.
      yield* board.updateTask(alice, { ...input, baseVersion: 2, set: { status: "in_progress" } });
      const sql = yield* SqlClient.SqlClient;
      const rolledBack = changes.publish(notice(9)).pipe(Effect.andThen(Effect.fail("rollback")));
      assert.strictEqual(yield* Effect.flip(sql.withTransaction(rolledBack)), "rollback");
      yield* board.acquireLease(agent, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual(yield* next, notice(3));
      yield* TestClock.adjust("16 minutes");
      yield* board.listTasks(alice, { workspaceId: a });
      assert.deepStrictEqual(yield* next, notice(4));

      // B's watcher saw none of A's writes: the first notice it gets is B's own.
      const decision = yield* board.createDecision(alice, {
        workspaceId: b,
        title: "Postgres",
        text: "",
      });
      assert.deepStrictEqual(yield* Queue.take(inB.items), {
        kind: "decision",
        workspaceId: b,
        id: decision.id,
        version: 1,
      });
    }),
  );

  it.effect("refuses a watch to anyone who is not a member", () =>
    Effect.gen(function* () {
      const { changes, a } = yield* setup;
      const denied = yield* changes
        .watch(session("mallory"), { workspaceId: a })
        .pipe(Stream.runDrain, Effect.flip);
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
      const ended = yield* Fiber.join(watch.fiber).pipe(Effect.flip);
      assert.strictEqual(reasonOf(ended), "forbidden");
      assert.strictEqual(yield* Queue.size(watch.items), 0);
    }),
  );
});
