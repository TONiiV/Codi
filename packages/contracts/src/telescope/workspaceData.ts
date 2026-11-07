import * as Schema from "effect/Schema";

import { AgentRunId, Count, Text, Timestamp, WakeId, WorkspaceId } from "./common.ts";
import { Workspace } from "./workspace.ts";

/** The largest export the RPC returns; a larger one is written to files by `t3 org export`. */
export const WORKSPACE_EXPORT_MAX_BYTES = 10 * 1024 * 1024;

/** `workspace.json`, `README.md` and a Markdown file per area, each by its path in the bundle. */
export const WorkspaceExportResult = Schema.Struct({
  files: Schema.Array(Schema.Struct({ path: Text, text: Schema.String })),
});

/** `confirmName` is the workspace's name, typed out by the person deleting it. */
export const WorkspaceDeleteInput = Schema.Struct({ workspaceId: WorkspaceId, confirmName: Text });

/**
 * Every Telescope table and the rows deleted from it, named by their key (`/` joins a pair), and
 * the runs' context files removed or left behind, by their path under the server's state directory.
 */
export const WorkspaceDeleteManifest = Schema.Struct({
  workspace: Workspace,
  deletedAt: Timestamp,
  tables: Schema.Array(
    Schema.Struct({ table: Text, count: Count, ids: Schema.Array(Schema.String) }),
  ),
  contextFiles: Schema.Array(Schema.String),
  contextFilesLeft: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
});
export type WorkspaceDeleteManifest = typeof WorkspaceDeleteManifest.Type;

export class WorkspaceBusyError extends Schema.TaggedError<WorkspaceBusyError>()(
  "TelescopeWorkspaceBusyError",
  { runIds: Schema.Array(AgentRunId), wakeIds: Schema.Array(WakeId) },
) {
  override get message(): string {
    const work = [...this.runIds, ...this.wakeIds].join(", ");
    return `This workspace still has runs or wakes in flight: ${work}. Delete it once they end.`;
  }
}
