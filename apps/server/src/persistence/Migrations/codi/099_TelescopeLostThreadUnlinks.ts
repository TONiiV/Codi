import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * 097 kept a thread two tasks named on the one updated last and dropped it from the other, whose
 * last `threadId` commit still names it, so a stale write read `[thread]`. That value becomes null.
 * Every write before 097 was a commit, so a task's `updated_at` then is its last commit before
 * 097's recorded second; a commit inside that second may fall on either side, so ties stay as is.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    WITH ran AS (
      SELECT julianday(created_at) AS at, julianday(created_at, '+1 second') AS after
      FROM codi_sql_migrations WHERE migration_id = 97
    ),
    named AS (
      SELECT commit_id, task_id, json_extract(changed_fields_json, '$.threadId') AS thread_id,
        ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY base_version DESC) AS n
      FROM telescope_task_commits WHERE json_type(changed_fields_json, '$.threadId') IS NOT NULL
    ),
    held AS (
      SELECT named.commit_id, named.thread_id,
        MAX(CASE WHEN julianday(c.created_at) < ran.at THEN julianday(c.created_at) END) AS surely,
        MAX(CASE WHEN julianday(c.created_at) < ran.after THEN julianday(c.created_at) END) AS maybe
      FROM named CROSS JOIN ran JOIN telescope_task_commits c ON c.task_id = named.task_id
      WHERE named.n = 1 AND named.thread_id IS NOT NULL
      GROUP BY named.commit_id
    )
    UPDATE telescope_task_commits
    SET changed_fields_json = json_set(changed_fields_json, '$.threadId', json('null'))
    WHERE commit_id IN (
      SELECT commit_id FROM (
        SELECT commit_id, maybe, MAX(surely) OVER (PARTITION BY thread_id) AS newest FROM held
      ) WHERE maybe < newest
    )`;
});
