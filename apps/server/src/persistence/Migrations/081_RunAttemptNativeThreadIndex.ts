import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX orchestration_v2_projection_run_attempts_native_thread_idx
    ON orchestration_v2_projection_run_attempts (json_extract(payload_json, '$.nativeThreadId'))
  `;
});
