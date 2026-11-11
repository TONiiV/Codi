import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * A Telescope project holds mounts. Each workspace's bound Codi project becomes one project with a
 * mount per binding; a Codi project only tasks still name becomes a project with no mount. Tasks
 * then point at the Telescope project.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE telescope_projects (
    telescope_project_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
    lead_subject_id TEXT, created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX telescope_projects_workspace ON telescope_projects (workspace_id)`;
  // `project_id` is the mounted Codi project; a workspace mounts it at most once, as it bound it.
  yield* sql`CREATE TABLE telescope_project_mounts (
    workspace_id TEXT NOT NULL, environment_id TEXT NOT NULL, project_id TEXT NOT NULL,
    telescope_project_id TEXT NOT NULL, PRIMARY KEY (workspace_id, environment_id, project_id)
  )`;
  yield* sql`CREATE INDEX telescope_project_mounts_project
    ON telescope_project_mounts (telescope_project_id)`;

  yield* sql`CREATE TEMP TABLE telescope_project_ids AS
    SELECT workspace_id, project_id, lower(hex(randomblob(16))) AS telescope_project_id
    FROM (
      SELECT workspace_id, project_id FROM telescope_project_bindings
      UNION
      SELECT workspace_id, project_id FROM telescope_tasks WHERE project_id IS NOT NULL
    )`;
  yield* sql`INSERT INTO telescope_projects
      (telescope_project_id, workspace_id, name, lead_subject_id, created_at)
    SELECT ids.telescope_project_id, ids.workspace_id,
      COALESCE(NULLIF(trim(codi.title), ''), ids.project_id),
      (SELECT max(lead_subject_id) FROM telescope_project_bindings bound
        WHERE bound.workspace_id = ids.workspace_id AND bound.project_id = ids.project_id),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM telescope_project_ids ids
    LEFT JOIN projection_projects codi ON codi.project_id = ids.project_id`;
  yield* sql`INSERT INTO telescope_project_mounts
      (workspace_id, environment_id, project_id, telescope_project_id)
    SELECT bound.workspace_id, bound.environment_id, bound.project_id, ids.telescope_project_id
    FROM telescope_project_bindings bound
    JOIN telescope_project_ids ids USING (workspace_id, project_id)`;
  yield* sql`UPDATE telescope_tasks SET project_id = (
      SELECT ids.telescope_project_id FROM telescope_project_ids ids
      WHERE ids.workspace_id = telescope_tasks.workspace_id
        AND ids.project_id = telescope_tasks.project_id
    )
    WHERE project_id IS NOT NULL`;
  yield* sql`DROP TABLE telescope_project_ids`;
  yield* sql`DROP TABLE telescope_project_bindings`;
});
