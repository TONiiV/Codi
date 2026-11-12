import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import Migration0081 from "./Migrations/codi/081_RunAttemptNativeThreadIndex.ts";
import Migration0082 from "./Migrations/codi/082_Telescope.ts";
import Migration0083 from "./Migrations/codi/083_TelescopeMemberSessions.ts";
import Migration0084 from "./Migrations/codi/084_TelescopeRunIndexes.ts";
import Migration0086 from "./Migrations/codi/086_TelescopeTaskConflict.ts";
import Migration0087 from "./Migrations/codi/087_TelescopeWakeMergedInto.ts";
import Migration0088 from "./Migrations/codi/088_TelescopeDecisionConflict.ts";
import Migration0089 from "./Migrations/codi/089_TelescopeGrants.ts";
import Migration0090 from "./Migrations/codi/090_TelescopeBudgetCalls.ts";
import Migration0092 from "./Migrations/codi/092_TelescopeDelegationThreads.ts";
import Migration0093 from "./Migrations/codi/093_TelescopeRouting.ts";
import Migration0094 from "./Migrations/codi/094_TelescopeAuditOptionalPower.ts";
import Migration0095 from "./Migrations/codi/095_TelescopeStopMemberAgents.ts";
import Migration0096 from "./Migrations/codi/096_TelescopeProjects.ts";
import Migration0097 from "./Migrations/codi/097_TelescopeTaskThreads.ts";
import Migration0098 from "./Migrations/codi/098_TelescopeTaskDetails.ts";

// Codi's migrations have their own table: the migrator skips every id up to the highest one it
// recorded, so sharing upstream's table would skip each migration upstream adds below Codi's ids.
export const CODI_MIGRATIONS_TABLE = "codi_sql_migrations";

const codiMigrationEntries = [
  [81, "RunAttemptNativeThreadIndex", Migration0081],
  [82, "Telescope", Migration0082],
  [83, "TelescopeMemberSessions", Migration0083],
  [84, "TelescopeRunIndexes", Migration0084],
  [86, "TelescopeTaskConflict", Migration0086],
  [87, "TelescopeWakeMergedInto", Migration0087],
  [88, "TelescopeDecisionConflict", Migration0088],
  [89, "TelescopeGrants", Migration0089],
  [90, "TelescopeBudgetCalls", Migration0090],
  [92, "TelescopeDelegationThreads", Migration0092],
  [93, "TelescopeRouting", Migration0093],
  [94, "TelescopeAuditOptionalPower", Migration0094],
  [95, "TelescopeStopMemberAgents", Migration0095],
  [96, "TelescopeProjects", Migration0096],
  [97, "TelescopeTaskThreads", Migration0097],
  [98, "TelescopeTaskDetails", Migration0098],
] as const;

export const codiMigrationManifest = codiMigrationEntries.map(([id, name]) => [id, name] as const);

/** Builds before codi_sql_migrations recorded these rows in upstream's effect_sql_migrations. */
export const isLegacyCodiMigration = (id: number, name: string) =>
  codiMigrationEntries.some(([codiId, codiName]) => codiId === id && codiName === name);

export const moveLegacyCodiMigrations = Effect.fn("moveLegacyCodiMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;
  const recorded = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
    readonly created_at: string;
  }>`SELECT migration_id, name, created_at FROM effect_sql_migrations`;
  const legacy = recorded.filter((row) => isLegacyCodiMigration(row.migration_id, row.name));
  if (legacy.length === 0) return;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      // The schema Effect's migrator creates for SQLite.
      yield* sql`
        CREATE TABLE IF NOT EXISTS ${sql(CODI_MIGRATIONS_TABLE)} (
          migration_id integer PRIMARY KEY NOT NULL,
          created_at datetime NOT NULL DEFAULT current_timestamp,
          name VARCHAR(255) NOT NULL
        )
      `;
      for (const row of legacy) {
        yield* sql`
          INSERT OR IGNORE INTO ${sql(CODI_MIGRATIONS_TABLE)} (migration_id, created_at, name)
          VALUES (${row.migration_id}, ${row.created_at}, ${row.name})
        `;
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${row.migration_id}`;
      }
    }),
  );
});

const run = Migrator.make({});

export const runCodiMigrations = (throughId?: number) =>
  run({
    table: CODI_MIGRATIONS_TABLE,
    loader: Migrator.fromRecord(
      Object.fromEntries(
        codiMigrationEntries
          .filter(([id]) => throughId === undefined || id <= throughId)
          .map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ),
    ),
  });
