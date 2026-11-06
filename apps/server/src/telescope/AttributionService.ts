import { ProjectId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const TASK_LIMIT = 100;
const RUN_LIMIT = 50;

interface Rows<A> {
  readonly columns: ReadonlyArray<string>;
  readonly decode: TelescopeDb.RowsDecoder<A, never>;
}
/** Reads only the columns the decoder names. */
const rows = <Fields extends Schema.Struct.Fields>(fields: Fields) => ({
  columns: Object.keys(fields),
  decode: Schema.decodeUnknownEffect(Schema.Array(Schema.Struct(fields))),
});
const Tasks = rows({
  item_id: Telescope.TaskId,
  title: Telescope.Text,
  status: Telescope.OpenTaskStatus,
  project_id: Schema.NullOr(ProjectId),
  owner_subject_id: Schema.NullOr(Schema.String),
  owner_agent_id: Schema.NullOr(Schema.String),
  conflict_decision_id: Schema.NullOr(Telescope.DecisionId),
  created_at: Telescope.Timestamp,
});
const Leases = rows({
  task_id: Schema.String,
  holder_agent_id: Schema.String,
  holder_subject_id: Schema.String,
  expires_at: Schema.String,
});
const StatusCommits = rows({ task_id: Schema.String, created_at: Telescope.Timestamp });
const Runs = rows({
  run_id: Telescope.AgentRunId,
  agent_id: Telescope.AgentId,
  thread_id: Schema.NullOr(ThreadId),
  started_at: Telescope.Timestamp,
  input_tokens: Telescope.Count,
  cached_input_tokens: Telescope.Count,
  cache_creation_tokens: Telescope.Count,
  output_tokens: Telescope.Count,
});
const Calls = rows({ run_id: Schema.String, tool: Telescope.Text, at: Telescope.Timestamp });
const Members = rows({ subject_id: Schema.String, display_name: Telescope.Text });
const Agents = rows({ agent_id: Schema.String, name: Telescope.Text });
const Wakes = rows({ status: Telescope.WakeStatus, created_at: Telescope.Timestamp });
const Ids = rows({ item_id: Schema.String });

type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;

/** Read-only answers to where work is waiting: which step, in whose hands, for how long. */
export class AttributionService extends Context.Service<
  AttributionService,
  {
    readonly summary: (
      caller: WorkspaceService.Caller,
      input: typeof Telescope.WorkspaceScopedInput.Type,
    ) => Effect.Effect<Telescope.DashboardSummary, Failure>;
  }
>()("t3/telescope/AttributionService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const sql = yield* SqlClient.SqlClient;

  const summary = Effect.fn("AttributionService.summary")(function* (
    caller: WorkspaceService.Caller,
    { workspaceId }: typeof Telescope.WorkspaceScopedInput.Type,
  ) {
    yield* workspaces.get(caller, { workspaceId });
    const generatedAt = DateTime.formatIso(yield* DateTime.now);
    const select = <A>(
      table: TelescopeDb.TelescopeTable,
      { columns, decode }: Rows<A>,
      where: Readonly<Record<string, string | null>> = {},
      options: TelescopeDb.SelectOptions = {},
    ) => db.select(workspaceId, table, decode, where, { ...options, columns });

    const open = { filter: sql.in("status", Telescope.OpenTaskStatus.literals) };
    const tasks = yield* select("tasks", Tasks, { kind: "task" }, open);
    const taskIds = tasks.map((task) => task.item_id);
    const statusChanges =
      taskIds.length === 0
        ? []
        : yield* select(
            "task_commits",
            StatusCommits,
            {},
            {
              filter: sql.and([
                sql.in("task_id", taskIds),
                sql`json_extract(changed_fields_json, '$.status') IS NOT NULL`,
              ]),
              orderBy: ["created_at"],
            },
          );
    const statusSince = new Map(statusChanges.map((row) => [row.task_id, row.created_at]));
    const leases = new Map(
      (yield* select("leases", Leases))
        .filter((lease) => Date.parse(lease.expires_at) > Date.parse(generatedAt))
        .map((lease) => [lease.task_id, lease]),
    );
    const names = new Map<string, string>([
      ...(yield* select("members", Members)).map((m) => [m.subject_id, m.display_name] as const),
      ...(yield* select("agents", Agents)).map((a) => [a.agent_id, a.name] as const),
    ]);
    const nameOf = (id: string) => names.get(id) ?? id;
    const holderOf = (task: (typeof tasks)[number]): Telescope.DashboardTask["holder"] => {
      const lease = leases.get(task.item_id);
      if (lease !== undefined) {
        const id = names.has(lease.holder_agent_id)
          ? lease.holder_agent_id
          : lease.holder_subject_id;
        return { via: "lease", name: nameOf(id) };
      }
      const owner = task.owner_agent_id ?? task.owner_subject_id;
      return owner === null ? undefined : { via: "owner", name: nameOf(owner) };
    };
    const openTasks = { todo: 0, in_progress: 0, in_review: 0, needs_decision: 0 };
    for (const task of tasks) openTasks[task.status] += 1;
    const listed = tasks
      .map((task): Telescope.DashboardTask => {
        const holder = holderOf(task);
        return {
          id: task.item_id,
          title: task.title,
          status: task.status,
          statusSince: statusSince.get(task.item_id) ?? task.created_at,
          ...(task.project_id === null ? {} : { projectId: task.project_id }),
          ...(holder === undefined ? {} : { holder }),
          ...(task.conflict_decision_id === null
            ? {}
            : { conflictDecisionId: task.conflict_decision_id }),
        };
      })
      .toSorted((a, b) => a.statusSince.localeCompare(b.statusSince))
      .slice(0, TASK_LIMIT);

    const oldestFirst = { orderBy: ["started_at", "run_id"], limit: RUN_LIMIT };
    const runs = yield* select("runs", Runs, { finished_at: null }, oldestFirst);
    const calls =
      runs.length === 0
        ? []
        : yield* select(
            "run_calls",
            Calls,
            {},
            {
              filter: sql.in(
                "run_id",
                runs.map((run) => run.run_id),
              ),
              orderBy: ["seq"],
            },
          );
    const callsByRun = Map.groupBy(calls, (call) => call.run_id);

    const wakes = yield* select(
      "wakes",
      Wakes,
      {},
      {
        filter: sql.in("status", ["queued", "running"]),
      },
    );
    const queued = wakes.filter((wake) => wake.status === "queued");
    const oldestQueuedAt = queued.map((wake) => wake.created_at).toSorted()[0];
    const pending = yield* select("tasks", Ids, { kind: "decision", status: "proposed" });

    return {
      generatedAt,
      openTasks,
      tasks: listed,
      runs: runs.map((run): Telescope.DashboardRun => {
        const runCalls = callsByRun.get(run.run_id) ?? [];
        const last = runCalls.at(-1);
        return {
          id: run.run_id,
          agentId: run.agent_id,
          agentName: nameOf(run.agent_id),
          startedAt: run.started_at,
          calls: runCalls.length,
          tokens: {
            input: run.input_tokens,
            cachedInput: run.cached_input_tokens,
            cacheCreation: run.cache_creation_tokens,
            output: run.output_tokens,
          },
          ...(run.thread_id === null ? {} : { threadId: run.thread_id }),
          ...(last === undefined ? {} : { step: { tool: last.tool, at: last.at } }),
        };
      }),
      wakes: {
        queued: queued.length,
        running: wakes.length - queued.length,
        ...(oldestQueuedAt === undefined ? {} : { oldestQueuedAt }),
      },
      pendingDecisions: pending.length,
    };
  });

  return AttributionService.of({ summary });
});

export const layer = Layer.effect(AttributionService, make).pipe(
  Layer.provide(Layer.merge(TelescopeDb.layer, WorkspaceService.layer)),
);
