import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * 097 kept a thread two tasks named on the one updated last; the other's last `threadId` commit
 * still names it, so a stale write read `[thread]`. That value becomes null. Clocks step, so 097's
 * own time is not read: a task's `updated_at` then was the time of a commit from that one up to
 * the last before a `threads` commit (written only since 097). Text compare, as 097 compared.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    WITH commits AS (
      SELECT commit_id, task_id, base_version, created_at,
        json_type(changed_fields_json, '$.threadId') IS NOT NULL AS names_thread,
        json_extract(changed_fields_json, '$.threadId') AS thread_id,
        created_at < LAG(created_at) OVER versions AS clock_went_back,
        MAX(json_type(changed_fields_json, '$.threads') IS NOT NULL) OVER versions AS after_097
      FROM telescope_task_commits
      WINDOW versions AS (PARTITION BY task_id ORDER BY base_version)
    ),
    last_named AS (
      SELECT commit_id, task_id, thread_id, created_at, after_097,
        ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY base_version DESC) AS n
      FROM commits WHERE names_thread
    ),
    tasks AS (
      SELECT last_named.commit_id, last_named.thread_id,
        last_named.created_at AS updated_at_least,
        MAX(CASE WHEN NOT c.after_097 THEN c.created_at END) AS updated_at_most,
        TOTAL(c.clock_went_back) AS clock_went_back
      FROM last_named JOIN commits c ON c.task_id = last_named.task_id
      WHERE last_named.n = 1 AND last_named.thread_id IS NOT NULL AND NOT last_named.after_097
      GROUP BY last_named.commit_id
    )
    UPDATE telescope_task_commits
    SET changed_fields_json = json_set(changed_fields_json, '$.threadId', NULL)
    WHERE commit_id IN (
      SELECT commit_id FROM (
        SELECT commit_id, updated_at_most,
          MAX(updated_at_least) OVER same_thread AS rival_updated_at_least,
          TOTAL(clock_went_back) OVER same_thread AS clock_went_back
        FROM tasks WINDOW same_thread AS (PARTITION BY thread_id)
      ) WHERE updated_at_most < rival_updated_at_least AND clock_went_back = 0
    )`;
});
