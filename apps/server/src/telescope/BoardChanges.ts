import { Telescope } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const SYNCHRONIZED: Telescope.BoardWatchItem = { kind: "synchronized" };
/** Writes a watcher may fall behind by before its watch ends and its client reads again. */
export const WATCH_BACKLOG = 64;

/** The notices of the write running on this fiber, sent together once it commits. */
const PendingChanges = Context.Reference<Array<Telescope.BoardChange> | undefined>(
  "t3/telescope/BoardChanges/PendingChanges",
  { defaultValue: () => undefined },
);

/** One notice per item, at its newest version. */
const coalesce = (changes: ReadonlyArray<Telescope.BoardChange>) => {
  const newest = new Map<string, Telescope.BoardChange>();
  for (const change of changes) {
    const key = `${change.kind}:${change.id}`;
    if ((newest.get(key)?.version ?? 0) < change.version) newest.set(key, change);
  }
  return [...newest.values()];
};

interface Watcher {
  readonly workspaceId: Telescope.WorkspaceId;
  readonly writes: Queue.Queue<ReadonlyArray<Telescope.BoardChange>, Telescope.WorkspaceError>;
}

/**
 * In-process notices of committed board writes. A notice names an item and its new version, never
 * its content, so each watcher re-reads what it shows under its own membership.
 */
export class BoardChanges extends Context.Service<
  BoardChanges,
  {
    /** Joins the notice to the enclosing `batch`, else sends it alone once its transaction commits. */
    readonly publish: (change: Telescope.BoardChange) => Effect.Effect<void>;
    /** Runs one board write; the notices it publishes go out as one item once it commits. */
    readonly batch: <A, E, R>(write: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    /**
     * A member's notices for one workspace, after `synchronized`. Membership is checked again
     * before each item, so a revoked member's watch fails instead of receiving it. A watcher that
     * falls `WATCH_BACKLOG` writes behind fails with `expired`.
     */
    readonly watch: (
      caller: WorkspaceService.Caller,
      input: { readonly workspaceId: Telescope.WorkspaceId },
    ) => Stream.Stream<
      Telescope.BoardWatchItem,
      Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError
    >;
  }
>()("t3/telescope/BoardChanges") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const watchers = new Set<Watcher>();
  const behind = new Telescope.WorkspaceError({
    reason: "expired",
    message: "This board watch fell behind; watch again.",
  });

  const send = (changes: ReadonlyArray<Telescope.BoardChange>) =>
    Effect.sync(() => {
      for (const watcher of watchers) {
        const mine = changes.filter((change) => change.workspaceId === watcher.workspaceId);
        if (mine.length > 0 && !Queue.offerUnsafe(watcher.writes, mine))
          Queue.failCauseUnsafe(watcher.writes, Cause.fail(behind));
      }
    });

  // One per commit, inside the writer's `recordCommit` span.
  const publish = Effect.fnUntraced(function* (change: Telescope.BoardChange) {
    const pending = yield* PendingChanges;
    if (pending === undefined) yield* sql.afterCommit(send([change]));
    else pending.push(change);
  });

  const batch = Effect.fn("BoardChanges.batch")(function* <A, E, R>(write: Effect.Effect<A, E, R>) {
    if ((yield* PendingChanges) !== undefined) return yield* write;
    const pending: Array<Telescope.BoardChange> = [];
    const result = yield* Effect.provideService(write, PendingChanges, pending);
    if (pending.length > 0) yield* sql.afterCommit(send(pending));
    return result;
  });

  const watch: BoardChanges["Service"]["watch"] = (caller, { workspaceId }) => {
    const member = workspaces.get(caller, { workspaceId });
    return Stream.unwrap(
      Effect.gen(function* () {
        const writes = yield* Queue.bounded<
          ReadonlyArray<Telescope.BoardChange>,
          Telescope.WorkspaceError
        >(WATCH_BACKLOG);
        const watcher: Watcher = { workspaceId, writes };
        // Registered before the check and before `synchronized`, so no write can commit unseen.
        yield* Effect.acquireRelease(
          Effect.sync(() => watchers.add(watcher)),
          () => Effect.sync(() => watchers.delete(watcher)),
        );
        yield* member;
        const next = Effect.flatMap(Queue.takeAll(writes), (taken) =>
          Effect.as(member, { kind: "changes" as const, changes: coalesce(taken.flat()) }),
        );
        return Stream.fromEffectRepeat(next).pipe(Stream.prepend([SYNCHRONIZED]));
      }),
    );
  };

  return BoardChanges.of({ publish, batch, watch });
});

export const layer = Layer.effect(BoardChanges, make).pipe(Layer.provide(WorkspaceService.layer));
