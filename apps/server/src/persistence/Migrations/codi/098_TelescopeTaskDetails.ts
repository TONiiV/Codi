import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE telescope_tasks ADD COLUMN due_date TEXT`;
  yield* sql`ALTER TABLE telescope_tasks ADD COLUMN priority TEXT`;
  yield* sql`ALTER TABLE telescope_tasks ADD COLUMN body TEXT`;
});
