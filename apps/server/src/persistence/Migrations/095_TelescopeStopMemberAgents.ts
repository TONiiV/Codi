import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** D147, D152: other members' personal agents run on their own machines, so stop them here. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`INSERT OR REPLACE INTO telescope_kill_switches
      (workspace_id, agent_id, state, by_subject_id, at)
    SELECT workspace_id, agent_id, 'terminated', 'owner', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM telescope_agents
    WHERE owner_subject_id IS NOT NULL AND owner_subject_id <> 'owner'`;
});
