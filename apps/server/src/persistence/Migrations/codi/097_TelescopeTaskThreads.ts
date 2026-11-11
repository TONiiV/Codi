import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * A task links many Code threads; a thread belongs to at most one task. A migration cannot read
 * this environment's id, so moved links get `''` until `TaskBoardService` starts and stamps it.
 * When two tasks named one thread, the most recently updated keeps it.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE telescope_task_threads (
    workspace_id TEXT NOT NULL, task_id TEXT NOT NULL, environment_id TEXT NOT NULL,
    thread_id TEXT NOT NULL, linked_by TEXT NOT NULL, linked_at TEXT NOT NULL,
    UNIQUE (environment_id, thread_id)
  )`;
  yield* sql`CREATE INDEX telescope_task_threads_task
    ON telescope_task_threads (workspace_id, task_id)`;
  yield* sql`INSERT OR IGNORE INTO telescope_task_threads
    (workspace_id, task_id, environment_id, thread_id, linked_by, linked_at)
    SELECT workspace_id, item_id, '', thread_id,
      COALESCE((
        SELECT author_id FROM telescope_task_commits c
        WHERE c.task_id = t.item_id
          AND json_extract(c.changed_fields_json, '$.threadId') IS NOT NULL
        ORDER BY c.base_version DESC LIMIT 1
      ), 'server'),
      updated_at
    FROM telescope_tasks t WHERE kind = 'task' AND thread_id IS NOT NULL
    ORDER BY updated_at DESC`;
  yield* sql`ALTER TABLE telescope_tasks DROP COLUMN thread_id`;
});
