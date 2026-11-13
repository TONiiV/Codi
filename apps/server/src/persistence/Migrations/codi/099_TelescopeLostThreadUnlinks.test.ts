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
        const early = "2026-01-01T00:00:00.000Z";
        const newer = "2026-01-02T00:00:00.000Z";
        const later = "2026-01-05T00:00:00.000Z";
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
        const commit = (taskId: string, baseVersion: number, fields: object, at = early) =>
          sql`INSERT INTO telescope_task_commits ${sql.insert({
            commit_id: `${taskId}-${baseVersion}`,
            workspace_id: "ws-1",
            task_id: taskId,
            author_id: "member-bea",
            base_version: baseVersion,
            changed_fields_json: JSON.stringify(fields),
            merge_level: 0,
            created_at: at,
          })}`;
        const link = (taskId: string, threadId: string) =>
          sql`INSERT INTO telescope_task_threads ${sql.insert({
            workspace_id: "ws-1",
            task_id: taskId,
            environment_id: "env-1",
            thread_id: threadId,
            linked_by: "member-bea",
            linked_at: later,
          })}`;
        const threads = (threadId?: string) => ({
          threads: threadId === undefined ? [] : [{ environmentId: "env-1", threadId }],
        });
        /** A task that names the thread when created at `at` and was last updated at `updatedAt`. */
        const named = (id: string, threadId: string, at: string, updatedAt = at) =>
          Effect.andThen(task(id, threadId, updatedAt), commit(id, 0, { title: id, threadId }, at));
        // Each pair names one thread; 097 keeps it on the newer task.
        const pair = (lost: string, kept: string, threadId: string, at = newer) =>
          Effect.gen(function* () {
            yield* named(lost, threadId, early);
            yield* commit(lost, 1, { status: "in_progress" });
            yield* named(kept, threadId, at);
          });
        yield* pair("lost", "kept", "t-1");
        yield* pair("relinked", "relinked-winner", "t-3");
        yield* pair("winner-left", "left", "t-5");
        yield* pair("came-back", "gave-back", "t-8");
        yield* pair("tied", "tied-too", "t-12", early);
        yield* pair("unsure", "unsure-kept", "t-11");
        // A commit before 097 looks the same under a clock that ran ahead, so `unsure` stays.
        yield* commit("unsure", 2, { status: "done" }, "2026-01-04T00:00:00.500Z");
        // `renamed` named `t-old` first; only its last `threadId` commit is the one 097 read.
        yield* task("renamed", "t-new", early);
        yield* commit("renamed", 0, { title: "renamed", threadId: "t-old" });
        yield* commit("renamed", 1, { threadId: "t-new" });
        yield* named("renamed-kept", "t-new", newer);
        // The clock stepped back inside `clock-lost`, so its last commit is not its latest one.
        yield* named("clock-lost", "t-13", "2026-01-03T10:00:05.000Z", "2026-01-03T10:00:03.000Z");
        yield* commit("clock-lost", 1, { status: "done" }, "2026-01-03T10:00:03.000Z");
        yield* named("clock-kept", "t-13", "2026-01-03T10:00:04.000Z");
        // The clock ran ahead before 097: `ahead-kept`'s last commit is timed after 097's time.
        yield* named("ahead-kept", "t-14", early, "2026-01-04T00:00:05.000Z");
        yield* commit("ahead-kept", 1, { status: "done" }, "2026-01-04T00:00:05.000Z");
        yield* named("ahead-lost", "t-14", newer);
        yield* pair("back-lost", "back-kept", "t-15");
        // No server wrote `threadId` after `threads`, so when `odd` named its thread is unknown.
        yield* task("odd", null, early);
        yield* commit("odd", 0, { title: "odd" });
        yield* commit("odd", 1, threads("t-17"), newer);
        yield* commit("odd", 2, { threadId: "t-16" }, later);
        yield* named("alone", "t-2", early);
        yield* named("swapped", "t-6", early);
        yield* task("unlinked", null, early);
        yield* commit("unlinked", 0, { title: "unlinked", threadId: "t-4" });
        yield* commit("unlinked", 1, { threadId: null });
        yield* runMigrations({ toMigrationInclusive: 98 });
        yield* sql`UPDATE codi_sql_migrations SET created_at = '2026-01-04 00:00:00'
          WHERE migration_id = 97`;
        assert.deepStrictEqual(
          yield* sql`SELECT task_id FROM telescope_task_threads
            WHERE thread_id IN ('t-13', 't-14', 't-15') ORDER BY thread_id`,
          [{ task_id: "clock-kept" }, { task_id: "ahead-kept" }, { task_id: "back-kept" }],
        );
        // After 097: `relinked` gets another thread, `left` gives up the one it kept and
        // `winner-left` links another, `swapped` trades the one it kept for another, and
        // `gave-back` gives its thread to `came-back`, the task 097 took it from.
        yield* commit("relinked", 2, threads("t-9"), later);
        yield* link("relinked", "t-9");
        yield* commit("left", 1, threads(), later);
        yield* sql`DELETE FROM telescope_task_threads WHERE thread_id = 't-5'`;
        yield* commit("winner-left", 2, threads("t-10"), later);
        yield* link("winner-left", "t-10");
        yield* commit("swapped", 1, threads("t-7"), later);
        yield* sql`UPDATE telescope_task_threads SET thread_id = 't-7' WHERE thread_id = 't-6'`;
        yield* commit("gave-back", 1, threads(), later);
        yield* commit("came-back", 2, threads("t-8"), later);
        yield* sql`UPDATE telescope_task_threads SET task_id = 'came-back' WHERE thread_id = 't-8'`;
        // The clock stepped back after 097: this edit of `back-lost` is timed before 097's time.
        yield* commit("back-lost", 2, { status: "done" }, "2026-01-03T00:00:00.000Z");

        const commits = sql<{ readonly commit_id: string; readonly changed_fields_json: string }>`
        SELECT * FROM telescope_task_commits ORDER BY commit_id`;
        const links = sql`SELECT * FROM telescope_task_threads ORDER BY thread_id`;
        const tasks = sql`SELECT * FROM telescope_tasks ORDER BY item_id`;
        const [commitsBefore, linksBefore, tasksBefore] = [
          yield* commits,
          yield* links,
          yield* tasks,
        ];

        yield* runMigrations({ toMigrationInclusive: 99 });
        const after = yield* commits;
        const fields = (rows: typeof after) =>
          rows.map(({ commit_id, changed_fields_json }) => ({ commit_id, changed_fields_json }));
        assert.deepStrictEqual(
          fields(after).filter(
            (row, i) => row.changed_fields_json !== commitsBefore[i]?.changed_fields_json,
          ),
          [
            {
              commit_id: "came-back-0",
              changed_fields_json: '{"title":"came-back","threadId":null}',
            },
            { commit_id: "lost-0", changed_fields_json: '{"title":"lost","threadId":null}' },
            {
              commit_id: "relinked-0",
              changed_fields_json: '{"title":"relinked","threadId":null}',
            },
            { commit_id: "renamed-1", changed_fields_json: '{"threadId":null}' },
            {
              commit_id: "winner-left-0",
              changed_fields_json: '{"title":"winner-left","threadId":null}',
            },
          ],
        );
        const rest = (rows: typeof after) =>
          rows.map((row) => ({ ...row, changed_fields_json: "" }));
        assert.deepStrictEqual(rest(after), rest(commitsBefore));
        assert.deepStrictEqual([yield* links, yield* tasks], [linksBefore, tasksBefore]);

        yield* Migration0099;
        assert.deepStrictEqual(yield* commits, after);
      }),
  );
});
