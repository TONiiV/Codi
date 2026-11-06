import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, ProjectId, Telescope, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
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
const worker = (run: (wakeRun: WakeQueue.WakeRun) => Effect.Effect<void>) =>
  Layer.build(WakeQueue.layerWorker.pipe(Layer.provide(Layer.succeed(WakeQueue.WakeRunner, run))));

const ws = Telescope.WorkspaceId.make("ws-a");
const session = (name: string): WorkspaceService.Caller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
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

const StatusRow = Schema.Struct({
  wake_id: Schema.String,
  status: Schema.String,
  merged_into: Schema.NullOr(Schema.String),
});
const decodeStatuses = Schema.decodeUnknownEffect(Schema.Array(StatusRow));
const statuses = (where: Readonly<Record<string, string>> = {}) =>
  TelescopeDb.TelescopeDb.use((db) => db.select(ws, "wakes", decodeStatuses, where)).pipe(
    Effect.map((rows) => rows.map(({ wake_id, status }) => ({ wake_id, status }))),
  );
const mergedInto = (wakeId: string) =>
  TelescopeDb.TelescopeDb.use((db) =>
    db.select(ws, "wakes", decodeStatuses, { merged_into: wakeId, status: "merged" }),
  );
const sinceCreated = (wake: Telescope.Wake, later: Telescope.Wake) =>
  later.startedAt === undefined
    ? undefined
    : DateTime.distance(
        DateTime.makeUnsafe(wake.createdAt),
        DateTime.makeUnsafe(later.startedAt),
      ).pipe(Duration.toSeconds);

it.effect("five emails to an idle agent within the hold window produce one run after 90s", () =>
  Effect.gen(function* () {
    const queue = yield* WakeQueue.WakeQueueService;
    const started = yield* Queue.unbounded<WakeQueue.WakeRun>();
    yield* worker((wakeRun) => Queue.offer(started, wakeRun));
    const email = (n: number) =>
      queue.enqueue(ws, request("ann", "mail:ann", { reason: "channel", payload: { n } }));

    const emails: Array<Telescope.Wake> = [];
    for (const n of [1, 2, 3, 4, 5]) {
      emails.push(yield* email(n));
      yield* TestClock.adjust(n < 5 ? "20 seconds" : "10 seconds");
    }
    assert.strictEqual(new Set(emails.map((wake) => wake.id)).size, 1);
    const [first] = emails;
    assert(first !== undefined);

    const run = yield* Queue.take(started);
    assert.strictEqual(run.wake.id, first.id);
    assert.strictEqual(sinceCreated(first, run.wake), 90);
    assert.deepStrictEqual(run.payloads, [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }]);
    const merged = yield* mergedInto(first.id);
    assert.strictEqual(merged.length, 4);
    assert.isTrue(merged.every((row) => row.merged_into === first.id));

    const late = yield* email(6);
    assert.notStrictEqual(late.id, first.id);
    yield* TestClock.adjust("90 seconds");
    const lateRun = yield* Queue.take(started);
    assert.strictEqual(lateRun.wake.id, late.id);
    assert.deepStrictEqual(lateRun.payloads, [{ n: 6 }]);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("holds channel, board and scheduled wakes for 90s unless they reach priority 1", () =>
  Effect.gen(function* () {
    const queue = yield* WakeQueue.WakeQueueService;
    const chat = yield* queue.enqueue(
      ws,
      request("ann", "chat:ann", { reason: "channel", priority: 1 }),
    );
    assert.strictEqual((yield* queue.dequeue)?.id, chat.id);

    const held = yield* queue.enqueue(ws, request("bea", "mail:bea", { reason: "channel" }));
    assert.strictEqual(yield* queue.dequeue, undefined);
    const raised = yield* queue.enqueue(
      ws,
      request("bea", "mail:bea", { reason: "channel", priority: 1 }),
    );
    assert.deepStrictEqual([raised.id, raised.priority], [held.id, 1]);
    assert.strictEqual((yield* queue.dequeue)?.id, held.id);

    const board = yield* queue.enqueue(ws, request("cal", "board:cal", { reason: "board_event" }));
    const scheduled = yield* queue.enqueue(ws, request("dan", "cron:dan", { reason: "scheduled" }));
    yield* TestClock.adjust("89 seconds");
    assert.strictEqual(yield* queue.dequeue, undefined);
    yield* TestClock.adjust("1 second");
    const due = yield* Effect.forEach([1, 2], () => queue.dequeue);
    assert.sameMembers(
      due.map((wake) => wake?.id),
      [board.id, scheduled.id],
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps merging into a wake whose thread is busy past its hold", () =>
  Effect.gen(function* () {
    const queue = yield* WakeQueue.WakeQueueService;
    const started = yield* Queue.unbounded<WakeQueue.WakeRun>();
    const release = yield* Deferred.make<void>();
    yield* worker((wakeRun) =>
      Queue.offer(started, wakeRun).pipe(
        Effect.andThen(wakeRun.wake.coalesceKey === "turn" ? Deferred.await(release) : Effect.void),
      ),
    );
    const threadId = ThreadId.make("thread-1");
    const turn = yield* queue.enqueue(ws, request("ann", "turn", { threadId, priority: 1 }));
    assert.strictEqual((yield* Queue.take(started)).wake.id, turn.id);

    const emails = yield* Effect.forEach([1, 2, 3, 4, 5], (n) =>
      queue
        .enqueue(ws, request("ann", "mail:ann", { reason: "channel", threadId, payload: { n } }))
        .pipe(Effect.tap(() => TestClock.adjust("2 minutes"))),
    );
    assert.strictEqual(new Set(emails.map((wake) => wake.id)).size, 1);

    yield* Deferred.succeed(release, undefined);
    const run = yield* Queue.take(started);
    assert.strictEqual(run.wake.id, emails[0]?.id);
    assert.strictEqual(run.payloads.length, 5);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("records a failed run as failed", () =>
  Effect.gen(function* () {
    const queue = yield* WakeQueue.WakeQueueService;
    const threadId = ThreadId.make("thread-1");
    const wake = yield* queue.enqueue(ws, request("ann", "boom", { threadId }));
    yield* TestClock.adjust("1 second");
    yield* queue.enqueue(ws, request("ann", "after", { threadId }));
    const next = yield* Deferred.make<void>();
    yield* worker(({ wake: { coalesceKey } }) =>
      coalesceKey === "boom" ? Effect.die("boom") : Deferred.succeed(next, undefined),
    );
    // The thread cap starts "after" only once "boom" is recorded.
    yield* Deferred.await(next);
    assert.deepStrictEqual(yield* statuses({ wake_id: wake.id }), [
      { wake_id: wake.id, status: "failed" },
    ]);
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

    const urgent = yield* queue.enqueue(ws, request("ann", "ann-urgent", { priority: 3 }));
    const raised = yield* queue.enqueue(ws, request("ann", "ann-urgent", { priority: 1 }));
    assert.deepStrictEqual([raised.id, raised.priority], [urgent.id, 1]);
    assert.strictEqual(yield* queue.position(ws, urgent.id), 1);
    assert.strictEqual((yield* queue.dequeue)?.id, urgent.id);
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

it.effect(
  "lists a workspace's wakes with machine-wide positions, for members only, past unreadable rows",
  () =>
    Effect.gen(function* () {
      const queue = yield* WakeQueue.WakeQueueService;
      const workspaces = yield* WorkspaceService.WorkspaceService;
      const own = yield* workspaces.create(session("ann"), {
        kind: "personal",
        name: "Ann",
        displayName: "Ann",
      });
      const db = yield* TelescopeDb.TelescopeDb;
      yield* db.insert(ws, "wakes", {
        wake_id: "unreadable",
        reason: "bogus",
        agent_id: "agent-1",
        coalesce_key: "bogus",
        priority: 2,
        subject_id: "zed",
        payload_json: "{}",
        status: "queued",
        created_at: "2026-01-01T00:00:00.000Z",
      });
      const ann = own.createdBy;
      const running = yield* queue.enqueue(own.id, request(ann, "first"));
      yield* TestClock.adjust("1 second");
      yield* queue.enqueue(own.id, request(ann, "second"));
      yield* queue.dequeue;
      yield* queue.enqueue(ws, request("zed", "elsewhere", { priority: 1 }));

      const { wakes } = yield* queue.list(session("ann"), { workspaceId: own.id });
      assert.deepStrictEqual(
        wakes.map((wake) => [wake.coalesceKey, wake.status, wake.position]),
        [
          ["first", "running", undefined],
          ["second", "queued", 2],
        ],
      );
      assert.strictEqual(wakes[0]?.id, running.id);
      assert.deepStrictEqual(yield* statuses({ wake_id: "unreadable" }), [
        { wake_id: "unreadable", status: "failed" },
      ]);
      const denied = yield* queue.list(session("eve"), { workspaceId: own.id }).pipe(Effect.flip);
      assert.strictEqual(denied._tag === "TelescopeWorkspaceError" && denied.reason, "forbidden");
    }).pipe(Effect.provide(layer)),
);

// An @mention on the board is not a dispatch.
it.effect("keeps board modules away from the wake queue", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs.readDirectory(import.meta.dirname);
    assert.include(files, "WakeQueueService.ts");
    const boardFiles = files.filter((file) => /Board/.test(file) && !file.includes(".test."));
    assert.isNotEmpty(boardFiles);
    for (const file of boardFiles) {
      const source = yield* fs.readFileString(`${import.meta.dirname}/${file}`);
      assert.notMatch(source, /import[^;]*WakeQueueService/, file);
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);
