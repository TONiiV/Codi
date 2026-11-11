import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** The tool gateway counts allowed tool calls against each budget level. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE telescope_budgets ADD COLUMN limit_calls INTEGER`;
  yield* sql`ALTER TABLE telescope_budgets ADD COLUMN used_calls INTEGER NOT NULL DEFAULT 0`;
});
