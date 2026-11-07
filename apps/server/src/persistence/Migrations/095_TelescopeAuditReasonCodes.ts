import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Gateway refusals are audited by reason code; older rows held the message, matched by its start. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`UPDATE telescope_audit SET reason = CASE
    WHEN reason LIKE 'A Telescope budget is used up%' THEN 'budget'
    WHEN reason LIKE 'The agent''s grant does not allow%' THEN 'forbidden'
    WHEN reason LIKE 'An admin stopped this agent%' THEN 'stopped'
    WHEN reason LIKE 'Only a project''s agent opens Worker threads%' THEN 'project_only'
    WHEN reason LIKE 'Only an agent without a project hands work%' THEN 'no_project'
    WHEN reason LIKE 'An agent''s own thread does not open%' THEN 'resident'
    WHEN reason LIKE 'A Worker reports through its thread%' THEN 'worker'
    WHEN reason LIKE 'Telescope agents cannot act on a linked environment%' THEN 'linked'
  END WHERE reason IS NOT NULL`;
});
