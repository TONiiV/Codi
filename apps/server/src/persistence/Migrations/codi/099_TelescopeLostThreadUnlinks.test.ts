import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../../Migrations.ts";
import Migration0099 from "./099_TelescopeLostThreadUnlinks.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("099_TelescopeLostThreadUnlinks", (it) => {
  it.effect(
    "clears the thread each task lost in 097 from its last threadId commit, nothing else",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 96 });
        const task = (id: string, threadId: string | null, at: string) =>
          sql`INSERT INTO telescope_tasks ${sql.insert({
            item_id: id,
            workspace_id: "ws-1",
            kind: "task",
            title: id,
            status: "todo",
            thread_id: threadId,
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
        const link = (taskId: string, threadId: string) =>
          sql`INSERT INTO telescope_task_threads ${sql.insert({
            workspace_id: "ws-1",
            task_id: taskId,
            environment_id: "env-1",
            thread_id: threadId,
            linked_by: "member-bea",
            linked_at: "2026-01-05T00:00:00.000Z",
          })}`;
        // Each pair names one thread; 097 keeps it on the newer task.
        const pair = (lost: string, kept: string, threadId: string) =>
          Effect.gen(function* () {
            yield* task(lost, threadId, "2026-01-01T00:00:00.000Z");
            yield* commit(lost, 0, { title: lost, threadId });
            yield* commit(lost, 1, { status: "in_progress" });
            yield* task(kept, threadId, "2026-01-02T00:00:00.000Z");
            yield* commit(kept, 0, { title: kept, threadId });
          });
        yield* pair("lost", "kept", "t-1");
        yield* pair("relinked", "relinked-winner", "t-3");
        yield* pair("winner-left", "left", "t-5");
        yield* task("alone", "t-2", "2026-01-01T00:00:00.000Z");
        yield* commit("alone", 0, { title: "alone", threadId: "t-2" });
        yield* task("swapped", "t-6", "2026-01-01T00:00:00.000Z");
        yield* commit("swapped", 0, { title: "swapped", threadId: "t-6" });
        yield* task("unlinked", null, "2026-01-01T00:00:00.000Z");
        yield* commit("unlinked", 0, { title: "unlinked", threadId: "t-4" });
        yield* commit("unlinked", 1, { threadId: null });
        yield* runMigrations({ toMigrationInclusive: 98 });
        // After 097: `relinked` gets another thread, `left` gives up the one it kept, and `swapped`
        // trades the one it kept for another.
        yield* commit("relinked", 2, { threads: [{ environmentId: "env-1", threadId: "t-9" }] });
        yield* link("relinked", "t-9");
        yield* commit("left", 1, { threads: [] });
        yield* sql`DELETE FROM telescope_task_threads WHERE thread_id = 't-5'`;
        yield* commit("swapped", 1, { threads: [{ environmentId: "env-1", threadId: "t-7" }] });
        yield* sql`UPDATE telescope_task_threads SET thread_id = 't-7' WHERE thread_id = 't-6'`;

        const commits = sql<{ readonly commit_id: string; readonly changed_fields_json: string }>`
        SELECT commit_id, changed_fields_json FROM telescope_task_commits ORDER BY commit_id`;
        const links = sql`SELECT * FROM telescope_task_threads ORDER BY thread_id`;
        const tasks = sql`SELECT * FROM telescope_tasks ORDER BY item_id`;
        const [commitsBefore, linksBefore, tasksBefore] = [
          yield* commits,
          yield* links,
          yield* tasks,
        ];

        yield* runMigrations({ toMigrationInclusive: 99 });
        const after = yield* commits;
        const changed = after.filter(
          (row, i) => row.changed_fields_json !== commitsBefore[i]?.changed_fields_json,
        );
        assert.deepStrictEqual(changed, [
          { commit_id: "lost-0", changed_fields_json: '{"title":"lost","threadId":null}' },
          { commit_id: "relinked-0", changed_fields_json: '{"title":"relinked","threadId":null}' },
          {
            commit_id: "winner-left-0",
            changed_fields_json: '{"title":"winner-left","threadId":null}',
          },
        ]);
        assert.deepStrictEqual(
          after.map((row) => row.commit_id),
          commitsBefore.map((row) => row.commit_id),
        );
        assert.deepStrictEqual([yield* links, yield* tasks], [linksBefore, tasksBefore]);

        yield* Migration0099;
        assert.deepStrictEqual(yield* commits, after);
      }),
  );
});
