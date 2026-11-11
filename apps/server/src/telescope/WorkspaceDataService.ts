import { Telescope } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as AgentService from "./AgentService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

/** The columns that name a row within its workspace; the delete manifest lists rows by them. */
const KEYS = {
  workspaces: ["workspace_id"],
  members: ["subject_id"],
  member_sessions: ["member_id", "device_key"],
  invitations: ["invitation_id"],
  projects: ["telescope_project_id"],
  project_mounts: ["environment_id", "project_id"],
  project_rules: ["project_id"],
  agents: ["agent_id"],
  tasks: ["item_id"],
  task_commits: ["commit_id"],
  task_threads: ["environment_id", "thread_id"],
  leases: ["lease_id"],
  grants: ["grant_id"],
  audit: ["audit_id"],
  budgets: ["scope", "scope_id"],
  kill_switches: ["agent_id"],
  wakes: ["wake_id"],
  runs: ["run_id"],
  run_calls: ["call_id"],
  memories: ["memory_id"],
  routing_rules: ["rule_id"],
  channel_bindings: ["binding_id"],
  delegations: ["delegation_id"],
} satisfies Record<TelescopeDb.TelescopeTable, ReadonlyArray<string>>;
const TABLES = Struct.keys(KEYS);

/** `telescope_` tables the export leaves out, and why. */
export const NOT_EXPORTED: Readonly<Record<string, string>> = {
  telescope_memories_fts: "the memory search index, rebuilt from telescope_memories",
};

const Row = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Null]));
type Row = typeof Row.Type;
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const decodeRunIds = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ run_id: Telescope.AgentRunId })),
);
const decodeWakeIds = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ wake_id: Telescope.WakeId })),
);
const encodeWorkspaceJson = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      formatVersion: Schema.Literal(1),
      exportedAt: Schema.String,
      workspace: Telescope.Workspace,
      withheld: Schema.Record(Schema.String, Schema.Number),
      tables: Schema.Record(Schema.String, Schema.Array(Row)),
    }),
    { space: 2 },
  ),
);
const encodeExport = Schema.encodeSync(Schema.fromJsonString(Telescope.WorkspaceExportResult));
const fromJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const json = (column: unknown) =>
  typeof column === "string" ? Option.getOrElse(fromJson(column), () => column) : column;
/** Lists are joined, by label when their items have one. */
const show = (value: unknown): string => {
  if (Array.isArray(value))
    return value
      .map((item: unknown) => show(Predicate.hasProperty(item, "label") ? item.label : item))
      .join(", ");
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
};
const fields = (values: Readonly<Record<string, unknown>>) =>
  Object.entries(values).flatMap(([label, value]) =>
    show(value) === "" ? [] : [`- ${label}: ${show(value)}`],
  );
const markdown = (title: string, sections: ReadonlyArray<ReadonlyArray<string>>) =>
  `# ${title}\n\n${sections.length === 0 ? "Nothing here yet." : sections.map((lines) => lines.join("\n")).join("\n\n")}\n`;

const tasksMarkdown = (items: ReadonlyArray<Row>, commits: ReadonlyArray<Row>) => {
  const history = Map.groupBy(commits, (commit) => commit.task_id);
  return markdown(
    "Tasks",
    items
      .filter((item) => item.kind === "task")
      .map((task) => [
        `## ${show(task.title)}`,
        ...fields({
          Status: task.status,
          Owner: task.owner_subject_id ?? task.owner_agent_id,
          Updated: task.updated_at,
        }),
        "",
        "History:",
        ...(history.get(task.item_id ?? null) ?? []).map((commit) => {
          const changed = json(commit.changed_fields_json);
          const changes = Predicate.isObject(changed)
            ? Object.entries(changed).map(([key, value]) => `${key} ${show(value)}`)
            : [show(changed)];
          return `- ${show(commit.created_at)} ${show(commit.author_id)}: ${changes.join("; ")}`;
        }),
      ]),
  );
};

const decisionsMarkdown = (items: ReadonlyArray<Row>) =>
  markdown(
    "Decisions",
    items
      .filter((item) => item.kind === "decision")
      .map((decision) => [
        `## ${show(decision.title)} (${show(decision.status)})`,
        ...(show(decision.text) === "" ? [] : [show(decision.text), ""]),
        ...fields({
          Options: json(decision.options_json),
          Chosen: decision.chosen,
          "Decided by": decision.decided_by,
          Decided: decision.decided_at,
          Supersedes: decision.supersedes,
        }),
      ]),
  );

const memoryMarkdown = (memories: ReadonlyArray<Row>) =>
  markdown(
    "Memory",
    memories.map((memory) => [
      `## ${show(memory.kind)}${memory.pinned === 1 ? " (pinned)" : ""}`,
      show(memory.text),
      `- ${show(memory.layer)}, ${show(memory.scope)}, ${show(memory.level)}; agent ${show(memory.agent_id)}; valid from ${show(memory.valid_from)}${memory.invalid_at === null ? "" : ` until ${show(memory.invalid_at)}`}${memory.deleted === 1 ? "; deleted" : ""}.`,
    ]),
  );

const runsMarkdown = (runs: ReadonlyArray<Row>, calls: ReadonlyArray<Row>) => {
  const callsByRun = Map.groupBy(calls, (call) => call.run_id);
  return markdown(
    "Run records",
    runs.map((run) => [
      `## Run ${show(run.run_id)}`,
      `Agent ${show(run.agent_id)} for ${show(json(run.on_behalf_of_json))}, from ${show(run.started_at)} to ${show(run.finished_at) || "now"}. Tokens: ${show(run.input_tokens)} in (${show(run.cached_input_tokens)} cached), ${show(run.output_tokens)} out.`,
      ...fields({ Results: json(run.result_labels_json), Summary: run.output_summary }),
      ...(callsByRun.get(run.run_id ?? null) ?? []).map(
        (call) =>
          `- Call ${show(call.seq)}: ${show(call.tool)}, ${show(call.grant_check)}, ${show(call.duration_ms)} ms`,
      ),
    ]),
  );
};

const readme = (
  workspace: Telescope.Workspace,
  exportedAt: string,
  tables: ReadonlyArray<readonly [string, ReadonlyArray<Row>]>,
  withheld: Readonly<Record<string, number>>,
) => {
  const owned = Object.entries(withheld).filter(
    ([table]) => table !== "telescope_memories" && table !== "telescope_agents",
  );
  return [
    `# ${workspace.name}`,
    "",
    `Telescope workspace ${workspace.id} (${workspace.kind}), exported ${exportedAt}.`,
    "",
    "- `workspace.json`: every row of the workspace, by table, as stored.",
    "- `tasks.md`, `decisions.md`, `memory.md`, `runs.md`: the same, readable.",
    "",
    "Telescope keeps no files on disk for a workspace, so there is no `files` folder.",
    "",
    "| Table | Rows |",
    "| --- | --- |",
    ...tables.map(([table, rows]) => `| ${table} | ${rows.length} |`),
    "",
    "Left out:",
    "- Invitation codes: an unused one still lets someone join.",
    `- ${withheld.telescope_memories ?? 0} memories the exporting member cannot read: another member's private ones, or ones about another member.`,
    `- ${withheld.telescope_agents ?? 0} agents the app hides from the exporting member: another member's hidden agents, a former member's agents, and Chief Agents of projects no longer bound.`,
    ...(owned.length === 0
      ? []
      : [`- Rows of those agents: ${owned.map(([table, n]) => `${table} ${n}`).join(", ")}.`]),
    ...Object.entries(NOT_EXPORTED).map(([table, reason]) => `- \`${table}\`: ${reason}.`),
    "",
  ].join("\n");
};
const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

const fail = (reason: Telescope.WorkspaceError["reason"], message: string) =>
  Effect.fail(new Telescope.WorkspaceError({ reason, message }));
type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;

/** Takes a whole workspace out, as an export or as a deletion with a manifest. Admins only. */
export class WorkspaceDataService extends Context.Service<
  WorkspaceDataService,
  {
    /**
     * Leaves out invitation codes, and memories, agents and agents' rows the caller cannot see in
     * the app. Refused over `maxBytes` of JSON; the CLI, which writes files, lifts that cap.
     */
    readonly export: (
      caller: WorkspaceService.SessionCaller,
      input: typeof Telescope.WorkspaceScopedInput.Type,
      options?: { readonly maxBytes: number },
    ) => Effect.Effect<typeof Telescope.WorkspaceExportResult.Type, Failure>;
    /**
     * One transaction, refused while the workspace has runs or wakes in flight. The runs' context
     * files are removed after it commits; one that cannot be is listed in `contextFilesLeft`.
     */
    readonly delete: (
      caller: WorkspaceService.SessionCaller,
      input: typeof Telescope.WorkspaceDeleteInput.Type,
    ) => Effect.Effect<Telescope.WorkspaceDeleteManifest, Failure | Telescope.WorkspaceBusyError>;
  }
>()("t3/telescope/WorkspaceDataService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const requireAdmin = (
    caller: WorkspaceService.SessionCaller,
    workspaceId: Telescope.WorkspaceId,
  ) =>
    workspaces.get(caller, { workspaceId }).pipe(
      Effect.filterOrElse(
        (access) => access.self.role === "admin",
        () => fail("forbidden", "Only workspace admins can export or delete a workspace."),
      ),
    );

  const exportWorkspace = Effect.fn("WorkspaceDataService.export")(function* (
    caller: WorkspaceService.SessionCaller,
    { workspaceId }: typeof Telescope.WorkspaceScopedInput.Type,
    { maxBytes } = { maxBytes: Telescope.WORKSPACE_EXPORT_MAX_BYTES },
  ) {
    const { workspace, self } = yield* requireAdmin(caller, workspaceId);
    // One read transaction, so every table comes from the same moment.
    const reads = Effect.forEach(TABLES, (table) =>
      db.select(workspaceId, table, decodeRows, {}, { orderBy: ["rowid"] }),
    );
    const read = yield* db.transaction(reads).pipe(NodeSqliteClient.readOnly);
    const stored = new Map(TABLES.map((table, index) => [table, read[index] ?? []]));
    const all = (table: TelescopeDb.TelescopeTable) => stored.get(table) ?? [];
    const owners = new Map(all("agents").map((agent) => [agent.agent_id, agent.owner_subject_id]));
    const active = all("members").filter((member) => member.revoked_at === null);
    const reach = {
      roles: new Set(active.map((member) => member.subject_id)),
      leads: new Set(all("project_mounts").map((mount) => mount.project_id)),
    };
    const text = (column: Row[string] | undefined) => (typeof column === "string" ? column : null);
    const hiddenAgents = new Set<unknown>(
      all("agents")
        .filter(
          (agent) =>
            !AgentService.visibleTo(self.subjectId, reach, {
              ownerSubjectId: text(agent.owner_subject_id),
              kind: String(agent.kind),
              projectId: text(agent.project_id) ?? undefined,
              exposure: String(agent.exposure),
            }),
        )
        .map((agent) => agent.agent_id),
    );
    const hidden = (...agentIds: ReadonlyArray<unknown>) =>
      agentIds.some((agentId) => hiddenAgents.has(agentId));
    const chain = (row: Row): ReadonlyArray<unknown> => {
      const onBehalfOf = json(row.on_behalf_of_json);
      return Array.isArray(onBehalfOf) ? onBehalfOf : [];
    };
    // Only agents the app hides leave, with the rows reachable through no other read path:
    // delegations (D68), grants and channel bindings. Everything else stays as the app shows it
    // to an admin (D76). Memories follow memory search's rule for the member's own session.
    const withheldRow: Partial<Record<TelescopeDb.TelescopeTable, (row: Row) => boolean>> = {
      agents: (agent) => hidden(agent.agent_id),
      delegations: (delegation) => hidden(delegation.from_agent_id, delegation.to_agent_id),
      grants: (grant) => hidden(...chain(grant)),
      channel_bindings: (binding) => hidden(binding.agent_id),
      memories: (memory) =>
        (memory.level === "private" && owners.get(memory.agent_id) !== self.subjectId) ||
        (memory.scope === "person" && memory.about_subject_id !== self.subjectId),
    };
    const rows = new Map(
      TABLES.map((table) => {
        const withhold = withheldRow[table];
        return [
          table,
          withhold === undefined ? all(table) : all(table).filter((row) => !withhold(row)),
        ];
      }),
    );
    rows.set(
      "invitations",
      all("invitations").map((row) => Struct.omit(row, ["code"])),
    );
    const of = (table: TelescopeDb.TelescopeTable) => rows.get(table) ?? [];
    const withheld = Object.fromEntries(
      TABLES.flatMap((table) => {
        const count = all(table).length - of(table).length;
        return count === 0 ? [] : [[`telescope_${table}`, count] as const];
      }),
    );
    const exportedAt = yield* now;
    const tables = TABLES.map((table) => [`telescope_${table}`, of(table)] as const);
    const bundle = encodeWorkspaceJson({
      formatVersion: 1,
      exportedAt,
      workspace,
      withheld,
      tables: Object.fromEntries(tables),
    });
    const result = {
      files: [
        { path: "README.md", text: readme(workspace, exportedAt, tables, withheld) },
        { path: "workspace.json", text: `${bundle}\n` },
        { path: "tasks.md", text: tasksMarkdown(of("tasks"), of("task_commits")) },
        { path: "decisions.md", text: decisionsMarkdown(of("tasks")) },
        { path: "memory.md", text: memoryMarkdown(of("memories")) },
        { path: "runs.md", text: runsMarkdown(of("runs"), of("run_calls")) },
      ],
    };
    const bytes = Buffer.byteLength(encodeExport(result));
    if (bytes > maxBytes)
      return yield* fail(
        "invalid",
        `This export is ${mib(bytes)} MiB, over the ${mib(maxBytes)} MiB the app downloads. On the server's machine, run \`t3 org export ${workspaceId} --out <directory>\` to write it to files instead.`,
      );
    return result;
  });

  const deleteWorkspace = Effect.fn("WorkspaceDataService.delete")(function* (
    caller: WorkspaceService.SessionCaller,
    input: typeof Telescope.WorkspaceDeleteInput.Type,
  ) {
    const { workspace } = yield* requireAdmin(caller, input.workspaceId);
    if (input.confirmName !== workspace.name)
      return yield* fail("invalid", "The name typed does not match this workspace's name.");
    const workspaceId = workspace.id;
    const inFlight = { filter: sql.in("status", ["queued", "running"]) };
    const deleted = yield* db.transaction(
      Effect.gen(function* () {
        const runs = yield* db.select(workspaceId, "runs", decodeRunIds, { finished_at: null });
        const wakes = yield* db.select(workspaceId, "wakes", decodeWakeIds, {}, inFlight);
        if (runs.length > 0 || wakes.length > 0)
          return yield* new Telescope.WorkspaceBusyError({
            runIds: runs.map((run) => run.run_id),
            wakeIds: wakes.map((wake) => wake.wake_id),
          });
        const tables = yield* Effect.forEach(TABLES, (table) =>
          Effect.gen(function* () {
            const columns = KEYS[table];
            const rows = yield* db.select(workspaceId, table, decodeRows, {}, { columns });
            yield* table === "memories"
              ? db.removeAllMemories(workspaceId)
              : db.remove(workspaceId, table, {});
            const ids = rows.map((row) => columns.map((column) => String(row[column])).join("/"));
            return { table: `telescope_${table}`, count: rows.length, ids };
          }),
        );
        return { workspace, deletedAt: yield* now, tables };
      }),
    );
    // After the commit, so a file that stays never keeps the rows; the manifest lists it instead.
    const runIds = deleted.tables.find(({ table }) => table === "telescope_runs")?.ids ?? [];
    const outcomes = yield* Effect.forEach(runIds, (runId) => {
      const file = RunRecordService.contextFile(path, stateDir, runId);
      const relative = path.relative(stateDir, file);
      return fs.exists(file).pipe(
        Effect.flatMap((exists) =>
          exists ? fs.remove(file).pipe(Effect.as(true)) : Effect.succeed(false),
        ),
        Effect.match({
          onSuccess: (removed) => ({ removed: removed ? [relative] : [], left: [] }),
          onFailure: (error) => ({
            removed: [],
            left: [{ path: relative, reason: error.message }],
          }),
        }),
      );
    });
    return {
      ...deleted,
      contextFiles: outcomes.flatMap((outcome) => outcome.removed),
      contextFilesLeft: outcomes.flatMap((outcome) => outcome.left),
    };
  });

  return WorkspaceDataService.of({ export: exportWorkspace, delete: deleteWorkspace });
});

export const layer = Layer.effect(WorkspaceDataService, make).pipe(
  Layer.provide(Layer.merge(TelescopeDb.layer, WorkspaceService.layer)),
);
