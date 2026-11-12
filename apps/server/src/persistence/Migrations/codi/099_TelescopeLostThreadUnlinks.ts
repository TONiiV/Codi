import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * 097 dropped a thread two tasks named from the older task without a commit, so that task's log
 * still names it. Each such task gets the unlink as its next version, so a stale write reads the
 * list the task showed. Every later thread change writes `threads`, so it marks a task 097 left.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const lost = yield* sql<{
    readonly item_id: string;
    readonly workspace_id: string;
    readonly version: number;
    readonly updated_at: string;
    readonly parent_id: string | null;
  }>`
    SELECT t.item_id, t.workspace_id, t.version, t.updated_at,
      (SELECT commit_id FROM telescope_task_commits p
        WHERE p.task_id = t.item_id AND p.base_version = t.version - 1) AS parent_id
    FROM telescope_tasks t
    WHERE t.kind = 'task'
      AND NOT EXISTS (SELECT 1 FROM telescope_task_threads l WHERE l.task_id = t.item_id)
      AND (
        SELECT json_type(c.changed_fields_json, '$.threadId') FROM telescope_task_commits c
        WHERE c.task_id = t.item_id
          AND (json_type(c.changed_fields_json, '$.threadId') IS NOT NULL
            OR json_type(c.changed_fields_json, '$.threads') IS NOT NULL)
        ORDER BY c.base_version DESC LIMIT 1
      ) = 'text'`;
  for (const task of lost) {
    yield* sql`INSERT INTO telescope_task_commits ${sql.insert({
      commit_id: `${task.item_id}-097-unlink`,
      parent_id: task.parent_id,
      workspace_id: task.workspace_id,
      task_id: task.item_id,
      author_id: "server",
      base_version: task.version,
      changed_fields_json: '{"threads":[]}',
      merge_level: 0,
      merge_reason: "migration 097 kept its thread on another task",
      created_at: task.updated_at,
    })}`;
    // `updated_at` stays, so the board keeps its order.
    yield* sql`UPDATE telescope_tasks SET version = ${task.version + 1}
      WHERE item_id = ${task.item_id}`;
  }
});
