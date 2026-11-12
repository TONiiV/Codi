import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("098_TelescopeTaskDetails", (it) => {
  it.effect("adds empty due date, priority and body columns to existing tasks", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 97 });
      const at = "2026-01-01T00:00:00.000Z";
      yield* sql`INSERT INTO telescope_tasks ${sql.insert({
        item_id: "task-a",
        workspace_id: "ws-1",
        kind: "task",
        title: "task-a",
        status: "todo",
        created_at: at,
        updated_at: at,
      })}`;

      yield* runMigrations({ toMigrationInclusive: 98 });
      const rows = yield* sql`SELECT due_date, priority, body FROM telescope_tasks`;
      assert.deepStrictEqual(rows, [{ due_date: null, priority: null, body: null }]);
    }),
  );
});
