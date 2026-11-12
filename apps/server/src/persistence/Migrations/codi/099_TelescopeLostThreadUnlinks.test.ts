import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("099_TelescopeLostThreadUnlinks", (it) => {
  it.effect("records the unlink on each task 097 dropped a thread from, and nothing else", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 96 });
      const task = (id: string, threadId: string | null, version: number, at: string) =>
        sql`INSERT INTO telescope_tasks ${sql.insert({
          item_id: id,
          workspace_id: "ws-1",
          kind: "task",
          title: id,
          status: "todo",
          thread_id: threadId,
          version,
          created_at: at,
          updated_at: at,
        })}`;
      const commit = (taskId: string, baseVersion: number, fields: object) =>
        sql`INSERT INTO telescope_task_commits ${sql.insert({
          commit_id: `${taskId}-${baseVersion}`,
          workspace_id: "ws-1",
          task_id: taskId,
          author_id: "member-bea",
          base_version: baseVersion,
          changed_fields_json: JSON.stringify(fields),
          merge_level: 0,
          created_at: "2026-01-01T00:00:00.000Z",
        })}`;
      // `lost` and `kept` both name t-1; 097 keeps it on `kept`, the newer one.
      yield* task("lost", "t-1", 2, "2026-01-02T00:00:00.000Z");
      yield* commit("lost", 0, { title: "lost", threadId: "t-1" });
      yield* commit("lost", 1, { status: "in_progress" });
      yield* task("kept", "t-1", 1, "2026-01-03T00:00:00.000Z");
      yield* commit("kept", 0, { title: "kept", threadId: "t-1" });
      yield* task("alone", "t-2", 1, "2026-01-01T00:00:00.000Z");
      yield* commit("alone", 0, { title: "alone", threadId: "t-2" });
      yield* task("unlinked", null, 2, "2026-01-01T00:00:00.000Z");
      yield* commit("unlinked", 0, { title: "unlinked", threadId: "t-4" });
      yield* commit("unlinked", 1, { threadId: null });
      // `relinked` lost t-3 too, but a member changed its threads after 097, which wrote a commit.
      yield* task("relinked", "t-3", 1, "2026-01-01T00:00:00.000Z");
      yield* commit("relinked", 0, { title: "relinked", threadId: "t-3" });
      yield* task("relinked-winner", "t-3", 1, "2026-01-02T00:00:00.000Z");
      yield* commit("relinked-winner", 0, { title: "relinked-winner", threadId: "t-3" });
      yield* runMigrations({ toMigrationInclusive: 98 });
      yield* commit("relinked", 1, { threads: [] });
      yield* sql`UPDATE telescope_tasks SET version = 2 WHERE item_id = 'relinked'`;
      const links = sql`SELECT task_id, thread_id FROM telescope_task_threads ORDER BY thread_id`;
      const linksBefore = yield* links;

      yield* runMigrations({ toMigrationInclusive: 99 });
      assert.deepStrictEqual(yield* links, linksBefore);
      const written = yield* sql`
        SELECT commit_id, parent_id, task_id, author_id, base_version, changed_fields_json,
          created_at
        FROM telescope_task_commits WHERE author_id = 'server'
      `;
      assert.deepStrictEqual(written, [
        {
          commit_id: "lost-097-unlink",
          parent_id: "lost-1",
          task_id: "lost",
          author_id: "server",
          base_version: 2,
          changed_fields_json: '{"threads":[]}',
          created_at: "2026-01-02T00:00:00.000Z",
        },
      ]);
      const tasks = yield* sql`
        SELECT item_id, version, updated_at FROM telescope_tasks ORDER BY item_id
      `;
      assert.deepStrictEqual(tasks, [
        { item_id: "alone", version: 1, updated_at: "2026-01-01T00:00:00.000Z" },
        { item_id: "kept", version: 1, updated_at: "2026-01-03T00:00:00.000Z" },
        { item_id: "lost", version: 3, updated_at: "2026-01-02T00:00:00.000Z" },
        { item_id: "relinked", version: 2, updated_at: "2026-01-01T00:00:00.000Z" },
        { item_id: "relinked-winner", version: 1, updated_at: "2026-01-02T00:00:00.000Z" },
        { item_id: "unlinked", version: 2, updated_at: "2026-01-01T00:00:00.000Z" },
      ]);
    }),
  );
});
