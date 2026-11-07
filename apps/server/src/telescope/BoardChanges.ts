import { Telescope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const SYNCHRONIZED: Telescope.BoardWatchItem = { kind: "synchronized" };

/**
 * In-process notices of committed board writes. A notice names an item and its new version, never
 * its content, so each watcher re-reads what it shows under its own membership.
 */
export class BoardChanges extends Context.Service<
  BoardChanges,
  {
    /** Sends the notice once the enclosing transaction commits; a rollback drops it. */
    readonly publish: (change: Telescope.BoardChange) => Effect.Effect<void>;
    /**
     * A member's notices for one workspace, after `synchronized`. Membership is checked again
     * before each notice, so a revoked member's watch fails instead of receiving it.
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
  const changes = yield* PubSub.unbounded<Telescope.BoardChange>();

  const publish = (change: Telescope.BoardChange) =>
    sql.afterCommit(PubSub.publish(changes, change).pipe(Effect.asVoid));

  const watch: BoardChanges["Service"]["watch"] = (caller, { workspaceId }) => {
    const member = workspaces.get(caller, { workspaceId });
    return Stream.unwrap(
      Effect.gen(function* () {
        yield* member;
        // Subscribed before `synchronized` goes out, so no write can commit unseen in between.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.fromSubscription(subscription).pipe(
          Stream.filter((change) => change.workspaceId === workspaceId),
          Stream.mapEffect((change) => Effect.as(member, change)),
          Stream.prepend([SYNCHRONIZED]),
        );
      }),
    );
  };

  return BoardChanges.of({ publish, watch });
});

export const layer = Layer.effect(BoardChanges, make).pipe(Layer.provide(WorkspaceService.layer));
