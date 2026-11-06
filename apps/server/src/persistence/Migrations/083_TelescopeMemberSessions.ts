import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Pairing sessions share one auth subject, so a Telescope member is its own id and each auth
 * session that acts as that member is linked here. `for_member_id` marks a device-link code.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE telescope_member_sessions (
    workspace_id TEXT NOT NULL, member_id TEXT NOT NULL, auth_session_id TEXT NOT NULL,
    linked_at TEXT NOT NULL
  )`;
  yield* sql`CREATE UNIQUE INDEX telescope_member_sessions_session
    ON telescope_member_sessions (workspace_id, auth_session_id)`;
  yield* sql`CREATE INDEX telescope_member_sessions_auth
    ON telescope_member_sessions (auth_session_id)`;
  yield* sql`ALTER TABLE telescope_invitations ADD COLUMN for_member_id TEXT`;
});
