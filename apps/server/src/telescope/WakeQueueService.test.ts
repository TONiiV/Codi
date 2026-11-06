import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WakeQueue from "./WakeQueueService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(WakeQueue.layer, TelescopeDb.layer, WorkspaceService.layer).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
);
const worker = (run: (wake: Telescope.Wake) => Effect.Effect<void>) =>
  Layer.build(WakeQueue.layerWorker.pipe(Layer.provide(Layer.succeed(WakeQueue.WakeRunner, run))));

const ws = Telescope.WorkspaceId.make("ws-a");
const request = (
  subjectId: string,
  coalesceKey: string,
  overrides: Partial<WakeQueue.WakeRequest> = {},
): WakeQueue.WakeRequest => ({
  reason: "dispatch",
  agentId: Telescope.AgentId.make("agent-1"),
  priority: 2,
  payload: {},
  subjectId,
  coalesceKey,
  ...overrides,
});

const StatusRow = Schema.Struct({ wake_id: Schema.String, status: Schema.String });
const decodeStatuses = Schema.decodeUnknownEffect(Schema.Array(StatusRow));
const statuses = (where: Readonly<Record<string, string>> = {}) =>
  TelescopeDb.TelescopeDb.use((db) => db.select(ws, "wakes", decodeStatuses, where));

it.effect("five emails within ten minutes while the thread is busy produce one run", () =>
  Effect.gen(function* () {
    const queue = yield* WakeQueue.WakeQueueService;
    const started = yield* Queue.unbounded<Telescope.Wake>();
    const release = yield* Deferred.make<void>();
    yield* worker((wake) =>
      Queue.offer(started, wake).pipe(
        Effect.andThen(wake.coalesceKey === "turn" ? Deferred.await(release) : Effect.void),
      ),
    );
    const threadId = ThreadId.make("thread-1");
    const turn = yield* queue.enqueue(ws, request("ann", "turn", { threadId, priority: 1 }));
    assert.strictEqual((yield* Queue.take(started)).id, turn.id);

    const emails = yield* Effect.forEach([1, 2, 3, 4, 5], (n) =>
      queue
        .enqueue(ws, request("ann", "mail:ann", { reason: "channel", threadId, payload: { n } }))
        .pipe(Effect.tap(() => TestClock.adjust("2 minutes"))),
    );
    assert.strictEqual(new Set(emails.map((wake) => wake.id)).size, 1);

    yield* Deferred.succeed(release, undefined);
    assert.strictEqual((yield* Queue.take(started)).id, emails[0]?.id);
    assert.strictEqual((yield* statuses({ coalesce_key: "mail:ann" })).length, 1);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("runs a waiting conversation before background work and rotates subjects", () =>
  Effect.gen(function* () {
    const queue = yield* WakeQueue.WakeQueueService;
    for (let n = 0; n < 10; n++) {
      yield* queue.enqueue(ws, request("ann", `background-${n}`, { priority: 3 }));
      yield* TestClock.adjust("1 second");
    }
    const cal = yield* queue.enqueue(ws, request("cal", "cal-background", { priority: 3 }));
    const bea = yield* queue.enqueue(ws, request("bea", "bea-chat", { priority: 1 }));

    assert.strictEqual(yield* queue.position(ws, bea.id), 1);
    assert.strictEqual(yield* queue.position(ws, cal.id), 3);
    const order = yield* Effect.forEach([1, 2, 3, 4], () => queue.dequeue);
    assert.deepStrictEqual(
      order.map((wake) => wake?.subjectId),
      ["bea", "ann", "cal", "ann"],
    );
    assert.strictEqual(yield* queue.position(ws, bea.id), undefined);
  }).pipe(Effect.provide(layer)),
);

it.effect("holds the subject, thread, machine and project caps", () =>
  Effect.gen(function* () {
    const queue = yield* WakeQueue.WakeQueueService;
    const subjectOf = queue.dequeue.pipe(Effect.map((wake) => wake?.subjectId));
    for (const n of [1, 2, 3, 4]) yield* queue.enqueue(ws, request("ann", `ann-${n}`));
    const annRuns = yield* Effect.forEach([1, 2, 3], () => queue.dequeue);
    assert.strictEqual(yield* subjectOf, undefined);

    const threadId = ThreadId.make("thread-1");
    for (const n of [1, 2]) yield* queue.enqueue(ws, request("bea", `bea-${n}`, { threadId }));
    assert.strictEqual(yield* subjectOf, "bea");
    assert.strictEqual(yield* subjectOf, undefined);

    yield* queue.setLimits({ machine: 4 });
    yield* queue.enqueue(ws, request("cal", "cal-1"));
    assert.strictEqual(yield* subjectOf, undefined);
    const [firstAnnRun] = annRuns;
    if (firstAnnRun !== undefined) yield* queue.finish(firstAnnRun, "done");
    assert.strictEqual(yield* subjectOf, "cal");

    yield* queue.setLimits({ machine: 8, perProject: 1 });
    const projectId = ProjectId.make("project-1");
    for (const n of [1, 2]) yield* queue.enqueue(ws, request("dan", `dan-${n}`, { projectId }));
    assert.strictEqual(yield* subjectOf, "dan");
    assert.strictEqual(yield* subjectOf, "ann");
    assert.strictEqual(yield* subjectOf, undefined);
  }).pipe(Effect.provide(layer)),
);

it.effect("marks wakes interrupted on shutdown and on restart", () =>
  Effect.gen(function* () {
    const queue = yield* WakeQueue.WakeQueueService;
    const started = yield* Deferred.make<void>();
    const live = yield* queue.enqueue(ws, request("ann", "live"));
    yield* Effect.scoped(
      worker(() => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))).pipe(
        Effect.andThen(Deferred.await(started)),
      ),
    );
    assert.deepStrictEqual(yield* statuses({ wake_id: live.id }), [
      { wake_id: live.id, status: "interrupted" },
    ]);

    const crashed = yield* queue.enqueue(ws, request("ann", "crashed"));
    assert.strictEqual((yield* queue.dequeue)?.id, crashed.id);
    yield* Effect.scoped(worker(() => Effect.void));
    assert.deepStrictEqual(yield* statuses({ wake_id: crashed.id }), [
      { wake_id: crashed.id, status: "interrupted" },
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("lists a workspace's wakes with machine-wide positions, for members only", () =>
  Effect.gen(function* () {
    const queue = yield* WakeQueue.WakeQueueService;
    const workspaces = yield* WorkspaceService.WorkspaceService;
    const own = yield* workspaces.create("ann", {
      kind: "personal",
      name: "Ann",
      displayName: "Ann",
    });
    const running = yield* queue.enqueue(own.id, request("ann", "first"));
    yield* TestClock.adjust("1 second");
    yield* queue.enqueue(own.id, request("ann", "second"));
    yield* queue.dequeue;
    yield* queue.enqueue(ws, request("zed", "elsewhere", { priority: 1 }));

    const { wakes } = yield* queue.list("ann", { workspaceId: own.id });
    assert.deepStrictEqual(
      wakes.map((wake) => [wake.coalesceKey, wake.status, wake.position]),
      [
        ["first", "running", undefined],
        ["second", "queued", 2],
      ],
    );
    assert.strictEqual(wakes[0]?.id, running.id);
    const denied = yield* queue.list("eve", { workspaceId: own.id }).pipe(Effect.flip);
    assert.strictEqual(denied._tag === "TelescopeWorkspaceError" && denied.reason, "forbidden");
  }).pipe(Effect.provide(layer)),
);

// An @mention on the board is not a dispatch: board modules never reach the queue.
it.effect("keeps board modules away from the wake queue", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const file of yield* fs.readDirectory(import.meta.dirname)) {
      if (!file.startsWith("Board") || file.includes(".test.")) continue;
      const source = yield* fs.readFileString(`${import.meta.dirname}/${file}`);
      assert.notMatch(source, /WakeQueue/);
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);
