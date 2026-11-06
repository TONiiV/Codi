import { ProjectId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as Semaphore from "effect/Semaphore";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import { forkParked } from "../serverActivation.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const RUNNING_PER_SUBJECT = 3;
const HOLD = Duration.seconds(90);
const HELD_REASONS: ReadonlySet<typeof Telescope.WakeReason.Type> = new Set([
  "channel",
  "board_event",
  "scheduled",
]);

const WakeRow = Schema.Struct({
  wake_id: Telescope.WakeId,
  workspace_id: Telescope.WorkspaceId,
  reason: Telescope.WakeReason,
  agent_id: Telescope.AgentId,
  coalesce_key: Telescope.Text,
  priority: Schema.Literals([1, 2, 3]),
  subject_id: Telescope.SubjectId,
  thread_id: Schema.NullOr(ThreadId),
  task_id: Schema.NullOr(Telescope.TaskId),
  project_id: Schema.NullOr(ProjectId),
  payload_json: Schema.fromJsonString(Schema.Json),
  status: Telescope.WakeStatus,
  merged_into: Schema.NullOr(Telescope.WakeId),
  run_after: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  started_at: Schema.NullOr(Schema.String),
  finished_at: Schema.NullOr(Schema.String),
});
type WakeRow = typeof WakeRow.Type;

const decodeRawRows = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown));
const decodeWake = Schema.decodeUnknownEffect(WakeRow);
const decodeRowId = Schema.decodeUnknownOption(Schema.Struct({ wake_id: Telescope.WakeId }));
const encodePayload = Schema.encodeSync(Schema.fromJsonString(Schema.Json));

const toWake = (row: WakeRow): Telescope.Wake => ({
  id: row.wake_id,
  workspaceId: row.workspace_id,
  reason: row.reason,
  agentId: row.agent_id,
  coalesceKey: row.coalesce_key,
  priority: row.priority,
  subjectId: row.subject_id,
  ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
  ...(row.task_id === null ? {} : { taskId: row.task_id }),
  ...(row.project_id === null ? {} : { projectId: row.project_id }),
  payload: row.payload_json,
  status: row.status,
  createdAt: row.created_at,
  ...(row.started_at === null ? {} : { startedAt: row.started_at }),
  ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
});

const byAge = (a: WakeRow, b: WakeRow) =>
  a.created_at.localeCompare(b.created_at) || a.wake_id.localeCompare(b.wake_id);

const countBy = (rows: ReadonlyArray<WakeRow>, key: (row: WakeRow) => string | null) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
};

/** Priority first, then the subject served longest ago, then the oldest wake. */
const pick = (rows: ReadonlyArray<WakeRow>, lastServed: ReadonlyMap<string, number>) =>
  rows.reduce<WakeRow | undefined>((best, row) => {
    if (best === undefined) return row;
    const order =
      row.priority - best.priority ||
      (lastServed.get(row.subject_id) ?? -1) - (lastServed.get(best.subject_id) ?? -1) ||
      byAge(row, best);
    return order < 0 ? row : best;
  }, undefined);

/** `subjectId` is the Telescope member id the wake serves, never an auth subject. */
export type WakeRequest = Pick<
  Telescope.Wake,
  | "reason"
  | "agentId"
  | "coalesceKey"
  | "priority"
  | "subjectId"
  | "threadId"
  | "taskId"
  | "projectId"
> & { readonly payload: Schema.Json };
/** A started wake and, in arrival order, its own payload and those of the wakes merged into it. */
export interface WakeRun {
  readonly wake: Telescope.Wake;
  readonly payloads: ReadonlyArray<Schema.Json>;
}
interface WakeLimits {
  readonly perProject: number;
  readonly machine: number;
}
type Failure = PersistenceSqlError | PersistenceDecodeError;
type ListInput = Rpc.Payload<(typeof Telescope.WakeRpcs)[number]>;

/**
 * One queue for every reason an agent wakes, shared by the whole machine. A queued wake absorbs
 * later wakes with its coalesce key until it starts; each absorbed one stays as a `merged` row.
 * Channel, board and scheduled wakes below priority 1 are held for 90 seconds so a burst merges.
 */
export class WakeQueueService extends Context.Service<
  WakeQueueService,
  {
    /** Returns the queued wake the request merged into, or the new one. */
    readonly enqueue: (
      workspaceId: Telescope.WorkspaceId,
      request: WakeRequest,
    ) => Effect.Effect<Telescope.Wake, Failure>;
    /** Starts the next due wake the running caps allow, if any. */
    readonly dequeue: Effect.Effect<Telescope.Wake | undefined, Failure>;
    /** Like `dequeue`, but waits until a wake can start. */
    readonly take: Effect.Effect<WakeRun, Failure>;
    readonly finish: (
      wake: Telescope.Wake,
      status: "done" | "failed" | "interrupted",
    ) => Effect.Effect<void, Failure>;
    /** Marks wakes left running by a previous process as interrupted. */
    readonly interruptRunning: Effect.Effect<void, Failure>;
    /** 1-based place among queued wakes on this machine, caps and holds ignored. */
    readonly position: (
      workspaceId: Telescope.WorkspaceId,
      wakeId: Telescope.Wake["id"],
    ) => Effect.Effect<number | undefined, Failure>;
    /** `caller` is the auth session; it must be a member of the workspace. */
    readonly list: (
      caller: WorkspaceService.Caller,
      input: ListInput,
    ) => Effect.Effect<typeof Telescope.WakeListResult.Type, Failure | Telescope.WorkspaceError>;
    readonly setLimits: (limits: Partial<WakeLimits>) => Effect.Effect<void>;
  }
>()("t3/telescope/WakeQueueService") {}

/** Runs one wake; a failure is logged and recorded as `failed`. Provide the agent runtime here. */
export const WakeRunner = Context.Reference<(run: WakeRun) => Effect.Effect<void>>(
  "t3/telescope/WakeRunner",
  {
    defaultValue: () => (run) =>
      Effect.logInfo("Telescope wake ran", { wakeId: run.wake.id, reason: run.wake.reason }),
  },
);

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const random = yield* SecureRandom.SecureRandom;
  const lock = yield* Semaphore.make(1);
  const work = yield* Latch.make(false);
  const limits = yield* Ref.make<WakeLimits>({ perProject: 4, machine: 8 });
  // Round-robin state: when each subject last had a wake started. Guarded by `lock`.
  const lastServed = new Map<string, number>();
  let turn = 0;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  // One unreadable row must not stall the machine-wide queue: it is logged, marked failed and skipped.
  const selectWakes = Effect.fn("WakeQueueService.selectWakes")(function* (
    workspaceId: Telescope.WorkspaceId,
    where: Readonly<Record<string, string>>,
  ) {
    const rows = yield* db.select(workspaceId, "wakes", decodeRawRows, where);
    const wakes: Array<WakeRow> = [];
    for (const raw of rows) {
      const decoded = yield* Effect.result(decodeWake(raw));
      if (Result.isSuccess(decoded)) {
        wakes.push(decoded.success);
        continue;
      }
      const id = decodeRowId(raw);
      yield* Effect.logWarning("Telescope wake row skipped", {
        workspaceId,
        error: decoded.failure,
      });
      if (Option.isSome(id))
        yield* db.update(
          workspaceId,
          "wakes",
          { status: "failed", finished_at: yield* now },
          { wake_id: id.value.wake_id },
        );
    }
    return wakes;
  });
  const decodeMerged = (workspaceId: Telescope.WorkspaceId, wakeId: Telescope.Wake["id"]) =>
    selectWakes(workspaceId, { merged_into: wakeId, status: "merged" }).pipe(
      Effect.map((rows) => rows.toSorted(byAge)),
    );

  const active = Effect.fn("WakeQueueService.active")(function* () {
    const ids = yield* db.workspaceIdsWithActiveWakes;
    const byStatus = (status: "queued" | "running") =>
      Effect.forEach(ids, (id) => selectWakes(id, { status })).pipe(
        Effect.map((rows) => rows.flat()),
      );
    return { queued: yield* byStatus("queued"), running: yield* byStatus("running") };
  });

  const queueOrder = (queued: ReadonlyArray<WakeRow>) => {
    const served = new Map(lastServed);
    const rest = [...queued];
    const order: Array<WakeRow> = [];
    for (let next = pick(rest, served), at = turn; next !== undefined; next = pick(rest, served)) {
      order.push(next);
      rest.splice(rest.indexOf(next), 1);
      served.set(next.subject_id, at++);
    }
    return order;
  };

  const enqueue = Effect.fn("WakeQueueService.enqueue")(function* (
    workspaceId: Telescope.WorkspaceId,
    request: WakeRequest,
  ) {
    const [survivor] = yield* selectWakes(workspaceId, {
      coalesce_key: request.coalesceKey,
      status: "queued",
    });
    const createdAt = yield* DateTime.now;
    const row: WakeRow = {
      wake_id: Telescope.WakeId.make(yield* random.uuidV4()),
      workspace_id: workspaceId,
      reason: request.reason,
      agent_id: request.agentId,
      coalesce_key: request.coalesceKey,
      priority: request.priority,
      subject_id: request.subjectId,
      thread_id: request.threadId ?? null,
      task_id: request.taskId ?? null,
      project_id: request.projectId ?? null,
      payload_json: request.payload,
      status: survivor === undefined ? "queued" : "merged",
      merged_into: survivor?.wake_id ?? null,
      run_after:
        survivor === undefined && request.priority !== 1 && HELD_REASONS.has(request.reason)
          ? DateTime.formatIso(DateTime.addDuration(createdAt, HOLD))
          : null,
      created_at: DateTime.formatIso(createdAt),
      started_at: null,
      finished_at: null,
    };
    yield* db.insert(workspaceId, "wakes", {
      ...Struct.omit(row, ["workspace_id"]),
      payload_json: encodePayload(row.payload_json),
    });
    if (survivor === undefined) {
      yield* work.open;
      return toWake(row);
    }
    if (request.priority >= survivor.priority) return toWake(survivor);
    // Priority 1 is never held, so the raise also releases the hold.
    const raised = {
      priority: request.priority,
      run_after: request.priority === 1 ? null : survivor.run_after,
    };
    yield* db.update(workspaceId, "wakes", raised, { wake_id: survivor.wake_id });
    yield* work.open;
    return toWake({ ...survivor, ...raised });
  }, lock.withPermit);

  const step = Effect.gen(function* () {
    const { queued, running } = yield* active();
    const { perProject, machine } = yield* Ref.get(limits);
    const current = yield* now;
    const due = queued.filter((row) => row.run_after === null || row.run_after <= current);
    const heldUntil = queued
      .flatMap((row) => (row.run_after !== null && row.run_after > current ? [row.run_after] : []))
      .toSorted()[0];
    if (running.length >= machine) return { run: undefined, heldUntil };
    const bySubject = countBy(running, (row) => row.subject_id);
    const byProject = countBy(running, (row) => row.project_id);
    const busyThreads = new Set(running.map((row) => row.thread_id));
    const next = pick(
      due.filter(
        (row) =>
          (bySubject.get(row.subject_id) ?? 0) < RUNNING_PER_SUBJECT &&
          (row.thread_id === null || !busyThreads.has(row.thread_id)) &&
          (row.project_id === null || (byProject.get(row.project_id) ?? 0) < perProject),
      ),
      lastServed,
    );
    if (next === undefined) return { run: undefined, heldUntil };
    yield* db.update(
      next.workspace_id,
      "wakes",
      { status: "running", started_at: current },
      { wake_id: next.wake_id, status: "queued" },
    );
    lastServed.set(next.subject_id, turn++);
    const merged = yield* decodeMerged(next.workspace_id, next.wake_id);
    const run: WakeRun = {
      wake: toWake({ ...next, status: "running", started_at: current }),
      payloads: [next.payload_json, ...merged.map((row) => row.payload_json)],
    };
    return { run, heldUntil };
  }).pipe(lock.withPermit, Effect.withSpan("WakeQueueService.dequeue"));

  const dequeue = step.pipe(Effect.map((result) => result.run?.wake));

  const take = Effect.gen(function* () {
    while (true) {
      yield* work.close;
      const { run, heldUntil } = yield* step;
      if (run !== undefined) return run;
      if (heldUntil === undefined) {
        yield* work.await;
        continue;
      }
      const duration = DateTime.distance(yield* DateTime.now, DateTime.makeUnsafe(heldUntil));
      yield* work.await.pipe(Effect.timeoutOrElse({ duration, orElse: () => Effect.void }));
    }
  });

  const finish = Effect.fn("WakeQueueService.finish")(function* (
    wake: Telescope.Wake,
    status: "done" | "failed" | "interrupted",
  ) {
    yield* db
      .update(
        wake.workspaceId,
        "wakes",
        { status, finished_at: yield* now },
        { wake_id: wake.id, status: "running" },
      )
      .pipe(lock.withPermit);
    yield* work.open;
  });

  const interruptRunning = Effect.gen(function* () {
    const finishedAt = yield* now;
    const ids = yield* db.workspaceIdsWithActiveWakes;
    yield* Effect.forEach(ids, (id) =>
      db.update(
        id,
        "wakes",
        { status: "interrupted", finished_at: finishedAt },
        { status: "running" },
      ),
    );
  }).pipe(lock.withPermit, Effect.withSpan("WakeQueueService.interruptRunning"));

  const position = Effect.fn("WakeQueueService.position")(function* (
    workspaceId: Telescope.WorkspaceId,
    wakeId: Telescope.Wake["id"],
  ) {
    const { queued } = yield* active();
    const index = queueOrder(queued).findIndex(
      (row) => row.wake_id === wakeId && row.workspace_id === workspaceId,
    );
    return index < 0 ? undefined : index + 1;
  });

  const list = Effect.fn("WakeQueueService.list")(function* (
    caller: WorkspaceService.Caller,
    input: ListInput,
  ) {
    yield* workspaces.get(caller, input);
    const { queued, running } = yield* active();
    const own = (row: WakeRow) => row.workspace_id === input.workspaceId;
    return {
      wakes: [
        ...running.filter(own).map(toWake),
        ...queueOrder(queued).flatMap((row, index) =>
          own(row) ? [{ ...toWake(row), position: index + 1 }] : [],
        ),
      ],
    };
  });

  const setLimits = (next: Partial<WakeLimits>) =>
    Ref.update(limits, (current) => ({ ...current, ...next })).pipe(Effect.andThen(work.open));

  return WakeQueueService.of({
    enqueue,
    dequeue,
    take,
    finish,
    interruptRunning,
    position,
    list,
    setLimits,
  });
});

export const layer = Layer.effect(WakeQueueService, make).pipe(
  Layer.provide(Layer.merge(TelescopeDb.layer, WorkspaceService.layer)),
);

/**
 * Starts wakes as the caps allow and hands each to `WakeRunner`. Shutdown interrupts running wakes,
 * which records them as interrupted.
 */
export const layerWorker = Layer.effectDiscard(
  Effect.gen(function* () {
    const queue = yield* WakeQueueService;
    const run = yield* WakeRunner;
    const scope = yield* Effect.scope;
    yield* queue.interruptRunning.pipe(
      Effect.catchCause((cause) => Effect.logWarning("Telescope wake recovery failed", { cause })),
    );
    const record = (wake: Telescope.Wake, exit: Exit.Exit<void>) => {
      if (Exit.isSuccess(exit)) return queue.finish(wake, "done");
      if (Cause.hasInterruptsOnly(exit.cause)) return queue.finish(wake, "interrupted");
      return Effect.logWarning("Telescope wake failed", {
        wakeId: wake.id,
        cause: exit.cause,
      }).pipe(Effect.andThen(queue.finish(wake, "failed")));
    };
    const start = (wakeRun: WakeRun) =>
      run(wakeRun).pipe(
        Effect.onExit((exit) =>
          record(wakeRun.wake, exit).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Telescope wake bookkeeping failed", {
                wakeId: wakeRun.wake.id,
                cause,
              }),
            ),
          ),
        ),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          () => Effect.void,
        ),
        Effect.forkIn(scope),
      );
    yield* forkParked(
      queue.take.pipe(
        Effect.flatMap(start),
        Effect.catchCause((cause) =>
          Effect.logWarning("Telescope wake queue failed", { cause }).pipe(
            Effect.andThen(Effect.sleep("1 second")),
          ),
        ),
        Effect.forever,
      ),
    );
  }),
);
