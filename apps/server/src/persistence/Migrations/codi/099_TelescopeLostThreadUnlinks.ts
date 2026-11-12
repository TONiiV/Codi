import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * 097 dropped a thread two tasks named from the older one, whose last `threadId` commit still
 * names it, so a stale write read `[thread]` where the task showed `[]`. That value becomes null.
 * A task lost its thread if it does not link it, and either has no `threads` commit (the only way
 * a kept link leaves) or the other task whose last `threadId` names it still links it.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    WITH named AS (
      SELECT commit_id, task_id, json_extract(changed_fields_json, '$.threadId') AS thread_id,
        ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY base_version DESC) AS n
      FROM telescope_task_commits WHERE json_type(changed_fields_json, '$.threadId') IS NOT NULL
    ),
    last AS (SELECT commit_id, task_id, thread_id FROM named WHERE n = 1 AND thread_id IS NOT NULL),
    linked AS (
      SELECT last.* FROM last JOIN telescope_task_threads l
        ON l.task_id = last.task_id AND l.thread_id = last.thread_id
    )
    UPDATE telescope_task_commits
    SET changed_fields_json = json_set(changed_fields_json, '$.threadId', json('null'))
    WHERE commit_id IN (
      SELECT lost.commit_id FROM last lost
      WHERE lost.commit_id NOT IN (SELECT commit_id FROM linked)
        AND (
          NOT EXISTS (
            SELECT 1 FROM telescope_task_commits c
            WHERE c.task_id = lost.task_id AND json_type(c.changed_fields_json, '$.threads') IS NOT NULL
          )
          OR EXISTS (SELECT 1 FROM linked kept WHERE kept.thread_id = lost.thread_id)
        )
    )`;
});
