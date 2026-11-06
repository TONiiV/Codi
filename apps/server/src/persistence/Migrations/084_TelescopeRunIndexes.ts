import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE INDEX telescope_runs_thread ON telescope_runs (thread_id)
    WHERE thread_id IS NOT NULL AND finished_at IS NULL`;
  yield* sql`CREATE INDEX telescope_runs_started ON telescope_runs (workspace_id, started_at)`;
});
