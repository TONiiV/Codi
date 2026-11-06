import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const encodeSessionIds = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

/** Maps provider-native session ids to the Codi project whose thread ran them. */
export class UsageProjectResolver extends Context.Service<
  UsageProjectResolver,
  {
    readonly resolve: (
      sessionIds: ReadonlySet<string>,
    ) => Effect.Effect<ReadonlyMap<string, ProjectId>>;
  }
>()("t3/usage/UsageProjectResolver") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A thread never changes project, so hits stay valid; misses may resolve once Codi runs them.
  const resolved = new Map<string, ProjectId>();

  const resolve = Effect.fn("UsageProjectResolver.resolve")(function* (
    sessionIds: ReadonlySet<string>,
  ) {
    const unknown = [...sessionIds].filter((sessionId) => !resolved.has(sessionId));
    if (unknown.length > 0) {
      const rows = yield* sql<{ readonly native_thread_id: string; readonly project_id: string }>`
        SELECT DISTINCT json_extract(attempt.payload_json, '$.nativeThreadId') AS native_thread_id,
          thread.project_id AS project_id
        FROM orchestration_v2_projection_run_attempts AS attempt
        JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = attempt.thread_id
        WHERE json_extract(attempt.payload_json, '$.nativeThreadId') IN (
          SELECT value FROM json_each(${encodeSessionIds(unknown)})
        )
      `.pipe(
        NodeSqliteClient.readOnly,
        Effect.catch((cause) =>
          Effect.logWarning("Could not resolve usage sessions to projects", cause).pipe(
            Effect.as([]),
          ),
        ),
      );
      const projects = new Map<string, string | null>();
      for (const row of rows) {
        const seen = projects.get(row.native_thread_id);
        projects.set(
          row.native_thread_id,
          seen === undefined || seen === row.project_id ? row.project_id : null,
        );
      }
      for (const [sessionId, projectId] of projects) {
        if (projectId !== null) resolved.set(sessionId, ProjectId.make(projectId));
      }
    }
    const result = new Map<string, ProjectId>();
    for (const sessionId of sessionIds) {
      const projectId = resolved.get(sessionId);
      if (projectId !== undefined) result.set(sessionId, projectId);
    }
    return result;
  });

  return UsageProjectResolver.of({ resolve });
});

export const layer = Layer.effect(UsageProjectResolver, make);
