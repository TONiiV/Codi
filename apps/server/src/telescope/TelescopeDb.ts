import { Telescope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";
import type * as Statement from "effect/sql/Statement";

import {
  type PersistenceDecodeError,
  PersistenceSqlError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../persistence/Errors.ts";

/** Table names without the `telescope_` prefix. */
export type TelescopeTable =
  | "workspaces"
  | "members"
  | "member_sessions"
  | "invitations"
  | "project_bindings"
  | "agents"
  | "tasks"
  | "task_commits"
  | "leases"
  | "grants"
  | "audit"
  | "budgets"
  | "kill_switches"
  | "wakes"
  | "runs"
  | "run_calls"
  | "memories"
  | "routing_rules"
  | "channel_bindings"
  | "delegations";

type Row = Readonly<Record<string, string | number | null>>;
/** A module-level `Schema.decodeUnknownEffect(Schema.Array(RowSchema))`. */
export type RowsDecoder<A, R> = (rows: unknown) => Effect.Effect<A, Schema.SchemaError, R>;

/** `filter` is parenthesised and ANDed with the workspace filter, so it cannot widen a select. */
interface SelectOptions {
  readonly filter?: Statement.Fragment;
  readonly orderBy?: ReadonlyArray<string>;
  readonly descending?: boolean;
  readonly limit?: number;
}

/**
 * The only way Telescope code reaches its tables. Every statement is bound to one workspace, so a
 * caller that forgets to filter still cannot touch another workspace's rows.
 */
export class TelescopeDb extends Context.Service<
  TelescopeDb,
  {
    /** `where` is ANDed with the workspace filter: it can narrow the result, never widen it. */
    readonly select: <A, R>(
      workspaceId: Telescope.WorkspaceId,
      table: TelescopeTable,
      decodeRows: RowsDecoder<A, R>,
      where?: Row,
      options?: SelectOptions,
    ) => Effect.Effect<A, PersistenceSqlError | PersistenceDecodeError, R>;
    /** Keys of `row` and `set` must not name `workspace_id`; the repository writes it. */
    readonly insert: (
      workspaceId: Telescope.WorkspaceId,
      table: TelescopeTable,
      row: Row,
    ) => Effect.Effect<void, PersistenceSqlError>;
    readonly update: (
      workspaceId: Telescope.WorkspaceId,
      table: TelescopeTable,
      set: Row,
      where: Row,
    ) => Effect.Effect<void, PersistenceSqlError>;
    readonly remove: (
      workspaceId: Telescope.WorkspaceId,
      table: TelescopeTable,
      where: Row,
    ) => Effect.Effect<void, PersistenceSqlError>;
    /** Cross-workspace lookups, each keyed by something no workspace owns. */
    readonly workspaceIdsOf: (
      deviceKey: string,
    ) => Effect.Effect<ReadonlyArray<Telescope.WorkspaceId>, PersistenceSqlError>;
    readonly allWorkspaceIds: Effect.Effect<
      ReadonlyArray<Telescope.WorkspaceId>,
      PersistenceSqlError
    >;
    readonly workspaceIdForInvitation: (
      code: string,
    ) => Effect.Effect<Telescope.WorkspaceId | undefined, PersistenceSqlError>;
    readonly openRunsOnThread: (threadId: string) => Effect.Effect<
      ReadonlyArray<{
        readonly workspaceId: Telescope.WorkspaceId;
        readonly runId: Telescope.AgentRunId;
      }>,
      PersistenceSqlError
    >;
    /** Retention: drops every workspace's runs started before `cutoff`, with their calls. */
    readonly pruneRunsBefore: (cutoff: string) => Effect.Effect<void, PersistenceSqlError>;
    /** The wake queue is shared by the whole machine. */
    readonly workspaceIdsWithActiveWakes: Effect.Effect<
      ReadonlyArray<Telescope.WorkspaceId>,
      PersistenceSqlError
    >;
    readonly transaction: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | PersistenceSqlError, R>;
  }
>()("t3/telescope/TelescopeDb") {}

// SQLite matches column names case-insensitively, so only canonical names pass.
const COLUMN = /^[a-z][a-z0-9_]*$/;
const checkColumns = (operation: string, row: Row, owner: "repository" | "caller") => {
  const column = Object.keys(row).find(
    (key) => !COLUMN.test(key) || (owner === "repository" && key === "workspace_id"),
  );
  return column === undefined
    ? Effect.void
    : Effect.fail(
        new PersistenceSqlError({ operation, detail: `Column ${JSON.stringify(column)} refused` }),
      );
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tableName = (table: TelescopeTable) => sql(`telescope_${table}`);
  const scoped = (workspaceId: Telescope.WorkspaceId, where: Row) =>
    sql.and([
      sql`workspace_id = ${workspaceId}`,
      ...Object.entries(where).map(([column, value]) =>
        value === null ? sql`${sql(column)} IS NULL` : sql`${sql(column)} = ${value}`,
      ),
    ]);

  const select = Effect.fn("TelescopeDb.select")(function* <A, R>(
    workspaceId: Telescope.WorkspaceId,
    table: TelescopeTable,
    decodeRows: RowsDecoder<A, R>,
    where: Row = {},
    options: SelectOptions = {},
  ) {
    yield* checkColumns(`TelescopeDb.select.${table}`, where, "caller");
    const filter = options.filter === undefined ? sql`` : sql` AND (${options.filter})`;
    const direction = sql.literal(options.descending ? "DESC" : "ASC");
    const order =
      options.orderBy === undefined
        ? sql``
        : sql` ORDER BY ${sql.csv(options.orderBy.map((column) => sql`${sql(column)} ${direction}`))}`;
    const limit = options.limit === undefined ? sql`` : sql` LIMIT ${options.limit}`;
    const rows =
      yield* sql`SELECT * FROM ${tableName(table)} WHERE ${scoped(workspaceId, where)}${filter}${order}${limit}`.pipe(
        Effect.mapError(toPersistenceSqlError(`TelescopeDb.select.${table}`)),
      );
    return yield* decodeRows(rows).pipe(
      Effect.mapError(toPersistenceDecodeError(`TelescopeDb.select.${table}`)),
    );
  });
  const insert = Effect.fn("TelescopeDb.insert")(function* (
    workspaceId: Telescope.WorkspaceId,
    table: TelescopeTable,
    row: Row,
  ) {
    yield* checkColumns(`TelescopeDb.insert.${table}`, row, "repository");
    yield* sql`INSERT INTO ${tableName(table)} ${sql.insert({ ...row, workspace_id: workspaceId })}`.pipe(
      Effect.mapError(toPersistenceSqlError(`TelescopeDb.insert.${table}`)),
    );
  });
  const update = Effect.fn("TelescopeDb.update")(function* (
    workspaceId: Telescope.WorkspaceId,
    table: TelescopeTable,
    set: Row,
    where: Row,
  ) {
    yield* checkColumns(`TelescopeDb.update.${table}`, set, "repository");
    yield* checkColumns(`TelescopeDb.update.${table}`, where, "caller");
    yield* sql`UPDATE ${tableName(table)} SET ${sql.update(set)} WHERE ${scoped(workspaceId, where)}`.pipe(
      Effect.mapError(toPersistenceSqlError(`TelescopeDb.update.${table}`)),
    );
  });
  const remove = Effect.fn("TelescopeDb.remove")(function* (
    workspaceId: Telescope.WorkspaceId,
    table: TelescopeTable,
    where: Row,
  ) {
    yield* checkColumns(`TelescopeDb.remove.${table}`, where, "caller");
    yield* sql`DELETE FROM ${tableName(table)} WHERE ${scoped(workspaceId, where)}`.pipe(
      Effect.mapError(toPersistenceSqlError(`TelescopeDb.remove.${table}`)),
    );
  });
  const workspaceIdsOf = Effect.fn("TelescopeDb.workspaceIdsOf")(function* (deviceKey: string) {
    const rows = yield* sql<{ readonly workspace_id: string }>`
      SELECT s.workspace_id FROM telescope_member_sessions s
      JOIN telescope_members m ON m.workspace_id = s.workspace_id AND m.subject_id = s.member_id
      WHERE s.device_key = ${deviceKey} AND m.revoked_at IS NULL
    `.pipe(Effect.mapError(toPersistenceSqlError("TelescopeDb.workspaceIdsOf")));
    return rows.map((row) => Telescope.WorkspaceId.make(row.workspace_id));
  });
  const allWorkspaceIds = sql<{ readonly workspace_id: string }>`
    SELECT workspace_id FROM telescope_workspaces
  `.pipe(
    Effect.mapError(toPersistenceSqlError("TelescopeDb.allWorkspaceIds")),
    Effect.map((rows) => rows.map((row) => Telescope.WorkspaceId.make(row.workspace_id))),
    Effect.withSpan("TelescopeDb.allWorkspaceIds"),
  );
  const workspaceIdForInvitation = Effect.fn("TelescopeDb.workspaceIdForInvitation")(function* (
    code: string,
  ) {
    const rows = yield* sql<{ readonly workspace_id: string }>`
      SELECT workspace_id FROM telescope_invitations WHERE code = ${code}
    `.pipe(Effect.mapError(toPersistenceSqlError("TelescopeDb.workspaceIdForInvitation")));
    return rows[0] === undefined ? undefined : Telescope.WorkspaceId.make(rows[0].workspace_id);
  });
  const openRunsOnThread = Effect.fn("TelescopeDb.openRunsOnThread")(function* (threadId: string) {
    const rows = yield* sql<{ readonly workspace_id: string; readonly run_id: string }>`
      SELECT workspace_id, run_id FROM telescope_runs
      WHERE thread_id = ${threadId} AND finished_at IS NULL
    `.pipe(Effect.mapError(toPersistenceSqlError("TelescopeDb.openRunsOnThread")));
    return rows.map((row) => ({
      workspaceId: Telescope.WorkspaceId.make(row.workspace_id),
      runId: Telescope.AgentRunId.make(row.run_id),
    }));
  });
  const pruneRunsBefore = Effect.fn("TelescopeDb.pruneRunsBefore")(function* (cutoff: string) {
    yield* sql
      .withTransaction(
        Effect.all([
          sql`DELETE FROM telescope_run_calls WHERE run_id IN
          (SELECT run_id FROM telescope_runs WHERE started_at < ${cutoff})`,
          sql`DELETE FROM telescope_runs WHERE started_at < ${cutoff}`,
        ]),
      )
      .pipe(Effect.mapError(toPersistenceSqlError("TelescopeDb.pruneRunsBefore")));
  });
  const workspaceIdsWithActiveWakes = sql<{ readonly workspace_id: string }>`
    SELECT DISTINCT workspace_id FROM telescope_wakes WHERE status IN ('queued', 'running')
  `.pipe(
    Effect.map((rows) => rows.map((row) => Telescope.WorkspaceId.make(row.workspace_id))),
    Effect.mapError(toPersistenceSqlError("TelescopeDb.workspaceIdsWithActiveWakes")),
    Effect.withSpan("TelescopeDb.workspaceIdsWithActiveWakes"),
  );
  const transaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    sql
      .withTransaction(effect)
      .pipe(
        Effect.mapError((error) =>
          SqlError.isSqlError(error)
            ? toPersistenceSqlError("TelescopeDb.transaction")(error)
            : error,
        ),
      );

  return TelescopeDb.of({
    select,
    insert,
    update,
    remove,
    workspaceIdsOf,
    allWorkspaceIds,
    workspaceIdForInvitation,
    openRunsOnThread,
    pruneRunsBefore,
    workspaceIdsWithActiveWakes,
    transaction,
  });
});

export const layer = Layer.effect(TelescopeDb, make);
