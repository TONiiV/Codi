import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_sessions)
  `;

  if (!columns.some((column) => column.name === "usage_limit_resets_at")) {
    yield* sql`
      ALTER TABLE projection_thread_sessions
      ADD COLUMN usage_limit_resets_at TEXT
    `;
  }

  if (!columns.some((column) => column.name === "usage_limit_message_id")) {
    yield* sql`
      ALTER TABLE projection_thread_sessions
      ADD COLUMN usage_limit_message_id TEXT
    `;
  }

  if (!columns.some((column) => column.name === "usage_limit_recorded_at")) {
    yield* sql`
      ALTER TABLE projection_thread_sessions
      ADD COLUMN usage_limit_recorded_at TEXT
    `;
  }

  // The auto-resume reactor rebuilds its schedule on boot by asking for every
  // parked session; without this it would scan the whole session table.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_sessions_usage_limit
    ON projection_thread_sessions(usage_limit_resets_at)
    WHERE usage_limit_resets_at IS NOT NULL
  `;
});
