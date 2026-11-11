import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Delegations name their hop, the thread working them and their open decision; agents get a resident thread. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE telescope_delegations ADD COLUMN hop TEXT NOT NULL DEFAULT 'agent'`;
  yield* sql`ALTER TABLE telescope_delegations ADD COLUMN thread_id TEXT`;
  yield* sql`ALTER TABLE telescope_delegations ADD COLUMN decision_id TEXT`;
  yield* sql`CREATE INDEX telescope_delegations_thread ON telescope_delegations (thread_id)`;
  yield* sql`CREATE INDEX telescope_delegations_parent ON telescope_delegations (parent_id)`;
  yield* sql`ALTER TABLE telescope_agents ADD COLUMN resident_thread_id TEXT`;
  yield* sql`CREATE INDEX telescope_agents_resident_thread ON telescope_agents (resident_thread_id)`;
});
