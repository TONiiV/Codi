import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
const at = "2026-01-01T00:00:00.000Z";

layer("096_TelescopeProjects", (it) => {
  it.effect("turns each binding into a project with a mount and points tasks at it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 95 });
      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "codi-app",
        title: "App",
        workspace_root: "/home/user/app",
        scripts_json: "[]",
        created_at: at,
        updated_at: at,
      })}`;
      const bindings = [
        ["ws-1", "env-local", "codi-app", "lena"],
        ["ws-1", "env-remote", "codi-site", null],
        // Tasks name only the Codi project id, so its bindings on two environments join one project.
        ["ws-1", "env-remote", "codi-app", null],
        ["ws-2", "env-local", "codi-app", null],
      ] as const;
      for (const [workspace, environment, project, lead] of bindings)
        yield* sql`INSERT INTO telescope_project_bindings ${sql.insert({
          workspace_id: workspace,
          environment_id: environment,
          project_id: project,
          lead_subject_id: lead,
        })}`;
      const tasks = [
        ["app-task", "ws-1", "codi-app"],
        ["other-workspace-task", "ws-2", "codi-app"],
        ["unbound-task", "ws-1", "codi-gone"],
        ["loose-task", "ws-1", null],
      ] as const;
      for (const [task, workspace, project] of tasks)
        yield* sql`INSERT INTO telescope_tasks ${sql.insert({
          item_id: task,
          workspace_id: workspace,
          kind: "task",
          project_id: project,
          title: task,
          status: "todo",
          created_at: at,
          updated_at: at,
        })}`;

      yield* runMigrations({ toMigrationInclusive: 96 });
      const projects = yield* sql<{
        readonly telescope_project_id: string;
        readonly workspace_id: string;
        readonly name: string;
        readonly lead_subject_id: string | null;
        readonly mounts: string | null;
      }>`
        SELECT p.telescope_project_id, p.workspace_id, p.name, p.lead_subject_id,
          group_concat(m.environment_id || '/' || m.project_id) AS mounts
        FROM telescope_projects p
        LEFT JOIN (SELECT * FROM telescope_project_mounts ORDER BY environment_id) m
          USING (telescope_project_id)
        GROUP BY p.telescope_project_id ORDER BY p.workspace_id, p.name
      `;
      assert.deepStrictEqual(
        projects.map((row) => [row.workspace_id, row.name, row.lead_subject_id, row.mounts]),
        [
          ["ws-1", "App", "lena", "env-local/codi-app,env-remote/codi-app"],
          ["ws-1", "codi-gone", null, null],
          ["ws-1", "codi-site", null, "env-remote/codi-site"],
          ["ws-2", "App", null, "env-local/codi-app"],
        ],
      );
      const idOf = (workspace: string, name: string) =>
        projects.find((row) => row.workspace_id === workspace && row.name === name)
          ?.telescope_project_id;
      const remapped = yield* sql<{ readonly item_id: string; readonly project_id: string | null }>`
        SELECT item_id, project_id FROM telescope_tasks ORDER BY item_id
      `;
      assert.deepStrictEqual(
        remapped.map((row) => [row.item_id, row.project_id]),
        [
          ["app-task", idOf("ws-1", "App")],
          ["loose-task", null],
          ["other-workspace-task", idOf("ws-2", "App")],
          ["unbound-task", idOf("ws-1", "codi-gone")],
        ],
      );
      const bindingTables = yield* sql<{ readonly n: number }>`
        SELECT count(*) AS n FROM sqlite_master WHERE name = 'telescope_project_bindings'
      `;
      assert.strictEqual(bindingTables[0]?.n, 0);
    }),
  );
});
