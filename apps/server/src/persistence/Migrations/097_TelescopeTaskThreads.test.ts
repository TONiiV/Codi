import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("097_TelescopeTaskThreads", (it) => {
  it.effect("moves each task's thread into the link table, newest task first", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 96 });
      const tasks = [
        ["task-a", "thread-1", "2026-01-01T00:00:00.000Z"],
        ["task-b", "thread-1", "2026-01-03T00:00:00.000Z"],
        ["task-c", "thread-2", "2026-01-02T00:00:00.000Z"],
        ["task-d", null, "2026-01-02T00:00:00.000Z"],
      ] as const;
      for (const [itemId, threadId, at] of tasks)
        yield* sql`INSERT INTO telescope_tasks ${sql.insert({
          item_id: itemId,
          workspace_id: "ws-1",
          kind: "task",
          title: itemId,
          status: "todo",
          thread_id: threadId,
          created_at: at,
          updated_at: at,
        })}`;
      yield* sql`INSERT INTO telescope_task_commits ${sql.insert({
        commit_id: "commit-1",
        workspace_id: "ws-1",
        task_id: "task-c",
        author_id: "member-bea",
        base_version: 0,
        changed_fields_json: JSON.stringify({ title: "task-c", threadId: "thread-2" }),
        merge_level: 0,
        created_at: "2026-01-02T00:00:00.000Z",
      })}`;

      yield* runMigrations({ toMigrationInclusive: 97 });
      const links = yield* sql<Record<string, string>>`
        SELECT workspace_id, task_id, environment_id, thread_id, linked_by, linked_at
        FROM telescope_task_threads ORDER BY thread_id
      `;
      assert.deepStrictEqual(links, [
        {
          workspace_id: "ws-1",
          task_id: "task-b",
          environment_id: "",
          thread_id: "thread-1",
          linked_by: "server",
          linked_at: "2026-01-03T00:00:00.000Z",
        },
        {
          workspace_id: "ws-1",
          task_id: "task-c",
          environment_id: "",
          thread_id: "thread-2",
          linked_by: "member-bea",
          linked_at: "2026-01-02T00:00:00.000Z",
        },
      ]);
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(telescope_tasks)`;
      assert.isFalse(columns.some((column) => column.name === "thread_id"));
    }),
  );
});
