import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Nothing wrote `telescope_audit` before this, so it is rebuilt keyed by run and power rather
 * than by a persisted grant. Project rules cap the powers any agent holds in that project.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP TABLE telescope_audit`;
  yield* sql`CREATE TABLE telescope_audit (
    audit_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, run_id TEXT, agent_id TEXT NOT NULL,
    on_behalf_of_json TEXT NOT NULL, project_id TEXT, power TEXT NOT NULL, tool TEXT,
    args_redacted_json TEXT, outcome TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX telescope_audit_page
    ON telescope_audit (workspace_id, created_at, audit_id)`;
  yield* sql`CREATE TABLE telescope_project_rules (
    workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, powers_json TEXT NOT NULL,
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, project_id)
  )`;
});
