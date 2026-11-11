import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** A project rule may narrow routing to an allowlist; routing rules tie in creation order. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE telescope_project_rules ADD COLUMN routing_json TEXT`;
  yield* sql`ALTER TABLE telescope_routing_rules ADD COLUMN created_at TEXT`;
});
