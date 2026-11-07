import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Memory tools need no power, so their audit rows have none; SQLite cannot drop NOT NULL. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE telescope_audit_next (
    audit_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, run_id TEXT, agent_id TEXT NOT NULL,
    on_behalf_of_json TEXT NOT NULL, project_id TEXT, power TEXT, tool TEXT,
    args_redacted_json TEXT, outcome TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL
  )`;
  yield* sql`INSERT INTO telescope_audit_next SELECT * FROM telescope_audit`;
  yield* sql`DROP TABLE telescope_audit`;
  yield* sql`ALTER TABLE telescope_audit_next RENAME TO telescope_audit`;
  yield* sql`CREATE INDEX telescope_audit_page
    ON telescope_audit (workspace_id, created_at, audit_id)`;
});
