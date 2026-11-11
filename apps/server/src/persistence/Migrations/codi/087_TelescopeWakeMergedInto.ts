import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE telescope_wakes ADD COLUMN merged_into TEXT`;
  yield* sql`ALTER TABLE telescope_wakes ADD COLUMN run_after TEXT`;
  yield* sql`CREATE INDEX telescope_wakes_merged_into ON telescope_wakes (merged_into)`;
});
