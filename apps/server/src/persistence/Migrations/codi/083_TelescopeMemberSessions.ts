import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Pairing sessions share one auth subject, so a Telescope member is its own id and each device
 * that acts as that member is linked here by `device_key`: its proof-key thumbprint, else its
 * auth session id. `for_member_id` marks a device-link code.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE telescope_member_sessions (
    workspace_id TEXT NOT NULL, member_id TEXT NOT NULL, device_key TEXT NOT NULL,
    linked_at TEXT NOT NULL
  )`;
  yield* sql`CREATE UNIQUE INDEX telescope_member_sessions_device
    ON telescope_member_sessions (workspace_id, device_key)`;
  yield* sql`CREATE INDEX telescope_member_sessions_key
    ON telescope_member_sessions (device_key)`;
  yield* sql`ALTER TABLE telescope_invitations ADD COLUMN for_member_id TEXT`;
});
