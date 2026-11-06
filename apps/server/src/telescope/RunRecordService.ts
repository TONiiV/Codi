import { EventId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/sql/SqlClient";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const DEFAULT_LIST_LIMIT = 50;

const RunRow = Schema.Struct({
  run_id: Telescope.AgentRunId,
  workspace_id: Telescope.WorkspaceId,
  agent_id: Telescope.AgentId,
  on_behalf_of_json: Schema.fromJsonString(Telescope.OnBehalfOf),
  input_snapshot_json: Schema.fromJsonString(Telescope.RunInputSnapshot),
  started_at: Schema.String,
  finished_at: Schema.NullOr(Schema.String),
  orchestration_event_id: Schema.NullOr(EventId),
  thread_id: Schema.NullOr(ThreadId),
  result_labels_json: Schema.fromJsonString(Schema.Array(Telescope.RunResultLabel)),
  input_tokens: Schema.Int,
  cached_input_tokens: Schema.Int,
  cache_creation_tokens: Schema.Int,
  output_tokens: Schema.Int,
  output_summary: Schema.NullOr(Schema.String),
});
const CallRow = Schema.Struct({
  call_id: Telescope.RunCallId,
  workspace_id: Telescope.WorkspaceId,
  run_id: Telescope.AgentRunId,
  seq: Schema.Int,
  tool: Schema.String,
  args_json: Schema.fromJsonString(Schema.Json),
  grant_check: Schema.Literals(["allowed", "denied"]),
  tokens: Schema.NullOr(Schema.Int),
  duration_ms: Schema.Int,
  at: Schema.String,
});

const MemorySourceRow = Schema.Struct({
  memory_id: Telescope.MemoryId,
  source_json: Schema.fromJsonString(Telescope.Memory.fields.source),
});

const decodeRuns = Schema.decodeUnknownEffect(Schema.Array(RunRow));
const decodeCalls = Schema.decodeUnknownEffect(Schema.Array(CallRow));
const decodeMemorySources = Schema.decodeUnknownEffect(Schema.Array(MemorySourceRow));
// The repository writes workspace_id itself and refuses rows that carry it.
const encodeRun = Schema.encodeSync(RunRow.mapFields(Struct.omit(["workspace_id"])));
const encodeCall = Schema.encodeSync(CallRow.mapFields(Struct.omit(["workspace_id"])));

const toRun = (row: typeof RunRow.Type): Telescope.AgentRun => ({
  id: row.run_id,
  workspaceId: row.workspace_id,
  agentId: row.agent_id,
  onBehalfOf: row.on_behalf_of_json,
  inputSnapshot: row.input_snapshot_json,
  startedAt: row.started_at,
  resultLabels: row.result_labels_json,
  tokens: {
    input: row.input_tokens,
    cachedInput: row.cached_input_tokens,
    cacheCreation: row.cache_creation_tokens,
    output: row.output_tokens,
  },
  ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
  ...(row.orchestration_event_id === null
    ? {}
    : { orchestrationEventId: row.orchestration_event_id }),
  ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
  ...(row.output_summary === null ? {} : { outputSummary: row.output_summary }),
});
const toCall = (row: typeof CallRow.Type): Telescope.RunCall => ({
  id: row.call_id,
  workspaceId: row.workspace_id,
  runId: row.run_id,
  seq: row.seq,
  tool: row.tool,
  args: row.args_json,
  grantCheck: row.grant_check,
  durationMs: row.duration_ms,
  at: row.at,
  ...(row.tokens === null ? {} : { tokens: row.tokens }),
});

const withTokens = (row: typeof RunRow.Type, tokens: Tokens): typeof RunRow.Type => ({
  ...row,
  input_tokens: row.input_tokens + tokens.input,
  cached_input_tokens: row.cached_input_tokens + tokens.cachedInput,
  cache_creation_tokens: row.cache_creation_tokens + tokens.cacheCreation,
  output_tokens: row.output_tokens + tokens.output,
});

const fail = (reason: Telescope.WorkspaceError["reason"], message: string) =>
  Effect.fail(new Telescope.WorkspaceError({ reason, message }));

type Tokens = typeof Telescope.RunTokens.Type;
type ResultLabel = typeof Telescope.RunResultLabel.Type;
type Out<A> = Effect.Effect<
  A,
  Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError
>;
type Caller = WorkspaceService.Caller;
type WorkspaceId = Telescope.WorkspaceId;
type RunRef = typeof Telescope.RunScopedInput.Type;
type RunList = typeof Telescope.RunListResult.Type;

interface RunStartInput {
  readonly agentId: Telescope.AgentRun["agentId"];
  /** Agents between the session's member and this run, outermost first. */
  readonly via?: ReadonlyArray<string>;
  readonly inputSnapshot: Telescope.AgentRun["inputSnapshot"];
  readonly threadId?: ThreadId;
  readonly orchestrationEventId?: EventId;
}
interface RunCallInput {
  readonly tool: string;
  readonly argsRedacted: Schema.Json;
  readonly grantCheck: Telescope.RunCall["grantCheck"];
  readonly tokens?: number;
  readonly durationMs: number;
}
interface RunFinishInput {
  readonly outputSummary: string;
  /** Added to the tokens already recorded from the run's thread turns. */
  readonly tokens: Tokens;
  readonly resultLabels: ReadonlyArray<ResultLabel>;
}

/**
 * Run records: what shaped a run, every tool call it made, its tokens and its result labels.
 * Writes come from the agent runtime and gateway; reads take the auth session and are
 * member-only.
 */
export class RunRecordService extends Context.Service<
  RunRecordService,
  {
    /** `onBehalfOf[0]` is the active member the session acts as. */
    readonly start: (
      caller: Caller,
      workspaceId: WorkspaceId,
      input: RunStartInput,
    ) => Out<Telescope.AgentRun>;
    /** Later turns on the thread add their tokens to the run until it finishes. */
    readonly attachThread: (run: RunRef, threadId: ThreadId) => Out<void>;
    readonly recordCall: (run: RunRef, call: RunCallInput) => Out<Telescope.RunCall>;
    /** Adds a finished provider turn's tokens to every open run attached to its thread. */
    readonly recordThreadTurn: (threadId: ThreadId, tokens: Tokens) => Out<void>;
    readonly finish: (run: RunRef, input: RunFinishInput) => Out<Telescope.AgentRun>;
    readonly label: (run: RunRef, label: ResultLabel) => Out<Telescope.AgentRun>;
    readonly get: (caller: Caller, run: RunRef) => Out<Telescope.AgentRun>;
    readonly list: (caller: Caller, input: typeof Telescope.RunListInput.Type) => Out<RunList>;
    readonly calls: (caller: Caller, run: RunRef) => Out<typeof Telescope.RunCallsResult.Type>;
    /** Runs whose context manifest lists this memory, newest first. */
    readonly runsForMemory: (
      caller: Caller,
      input: { readonly workspaceId: WorkspaceId; readonly memoryId: Telescope.Memory["id"] },
    ) => Out<RunList>;
    /** The memories a run's context manifest lists, in manifest order, with where each came from. */
    readonly memoriesForRun: (
      caller: Caller,
      run: RunRef,
    ) => Out<typeof Telescope.RunMemorySourcesResult.Type>;
    readonly pruneBefore: (cutoff: DateTime.Utc) => Effect.Effect<void, PersistenceSqlError>;
  }
>()("t3/telescope/RunRecordService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const random = yield* SecureRandom.SecureRandom;
  const sql = yield* SqlClient.SqlClient;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const requireMember = (workspaceId: WorkspaceId, caller: Caller) =>
    workspaces.get(caller, { workspaceId });

  const runRow = Effect.fn("RunRecordService.runRow")(function* (run: RunRef, open?: "open") {
    const [row] = yield* db.select(run.workspaceId, "runs", decodeRuns, { run_id: run.runId });
    if (row === undefined) return yield* fail("not_found", "Run not found.");
    if (open !== undefined && row.finished_at !== null)
      return yield* fail("conflict", "This run has already finished.");
    return row;
  });
  const saveRun = (row: typeof RunRow.Type) =>
    db.update(row.workspace_id, "runs", encodeRun(row), { run_id: row.run_id });

  const start = Effect.fn("RunRecordService.start")(function* (
    caller: Caller,
    workspaceId: WorkspaceId,
    input: RunStartInput,
  ) {
    const { self } = yield* requireMember(workspaceId, caller);
    const row: typeof RunRow.Type = {
      run_id: Telescope.AgentRunId.make(yield* random.uuidV4()),
      workspace_id: workspaceId,
      agent_id: input.agentId,
      on_behalf_of_json: [self.subjectId, ...(input.via ?? [])],
      input_snapshot_json: input.inputSnapshot,
      started_at: yield* now,
      finished_at: null,
      orchestration_event_id: input.orchestrationEventId ?? null,
      thread_id: input.threadId ?? null,
      result_labels_json: [],
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_tokens: 0,
      output_tokens: 0,
      output_summary: null,
    };
    yield* db.insert(workspaceId, "runs", encodeRun(row));
    return toRun(row);
  });

  const attachThread = Effect.fn("RunRecordService.attachThread")(function* (
    run: RunRef,
    threadId: ThreadId,
  ) {
    yield* saveRun({ ...(yield* runRow(run, "open")), thread_id: threadId });
  });

  const recordCall = Effect.fn("RunRecordService.recordCall")(function* (
    run: RunRef,
    call: RunCallInput,
  ) {
    return yield* db.transaction(
      Effect.gen(function* () {
        yield* runRow(run, "open");
        const last = { orderBy: ["seq"], descending: true, limit: 1 } as const;
        const [previous] = yield* db.select(
          run.workspaceId,
          "run_calls",
          decodeCalls,
          { run_id: run.runId },
          last,
        );
        const row: typeof CallRow.Type = {
          call_id: Telescope.RunCallId.make(yield* random.uuidV4()),
          workspace_id: run.workspaceId,
          run_id: run.runId,
          seq: previous === undefined ? 0 : previous.seq + 1,
          tool: call.tool,
          args_json: call.argsRedacted,
          grant_check: call.grantCheck,
          tokens: call.tokens ?? null,
          duration_ms: call.durationMs,
          at: yield* now,
        };
        yield* db.insert(run.workspaceId, "run_calls", encodeCall(row));
        return toCall(row);
      }),
    );
  });

  const recordThreadTurn = Effect.fn("RunRecordService.recordThreadTurn")(function* (
    threadId: ThreadId,
    tokens: Tokens,
  ) {
    const open = (run: RunRef) =>
      db.transaction(
        runRow(run, "open").pipe(Effect.flatMap((row) => saveRun(withTokens(row, tokens)))),
      );
    yield* Effect.forEach(yield* db.openRunsOnThread(threadId), open, { discard: true });
  });

  const exportSpan = (run: Telescope.AgentRun) =>
    Effect.void.pipe(
      Effect.withSpan("invoke_agent", {
        kind: "internal",
        attributes: {
          "gen_ai.operation.name": "invoke_agent",
          "gen_ai.agent.id": run.agentId,
          "gen_ai.request.model": run.inputSnapshot.model,
          ...(run.inputSnapshot.provider === undefined
            ? {}
            : { "gen_ai.provider.name": run.inputSnapshot.provider }),
          "gen_ai.usage.input_tokens": run.tokens.input,
          "gen_ai.usage.output_tokens": run.tokens.output,
          "gen_ai.usage.cache_read.input_tokens": run.tokens.cachedInput,
          "gen_ai.usage.cache_creation.input_tokens": run.tokens.cacheCreation,
          ...(run.threadId === undefined ? {} : { "gen_ai.conversation.id": run.threadId }),
          "telescope.workspace.id": run.workspaceId,
          "telescope.run.id": run.id,
          "telescope.run.started_at": run.startedAt,
          "telescope.run.result_labels": run.resultLabels.join(","),
        },
      }),
    );

  const finish = Effect.fn("RunRecordService.finish")(function* (
    ref: RunRef,
    input: RunFinishInput,
  ) {
    const run = yield* db.transaction(
      Effect.gen(function* () {
        const row = yield* runRow(ref, "open");
        const finished = {
          ...withTokens(row, input.tokens),
          finished_at: yield* now,
          output_summary: input.outputSummary,
          result_labels_json: [...row.result_labels_json, ...input.resultLabels],
        };
        yield* saveRun(finished);
        return toRun(finished);
      }),
    );
    yield* exportSpan(run);
    return run;
  });

  const label = Effect.fn("RunRecordService.label")(function* (
    run: RunRef,
    resultLabel: ResultLabel,
  ) {
    return yield* db.transaction(
      Effect.gen(function* () {
        const row = yield* runRow(run);
        const labelled = { ...row, result_labels_json: [...row.result_labels_json, resultLabel] };
        yield* saveRun(labelled);
        return toRun(labelled);
      }),
    );
  });

  const get = Effect.fn("RunRecordService.get")(function* (caller: Caller, run: RunRef) {
    yield* requireMember(run.workspaceId, caller);
    return toRun(yield* runRow(run));
  });

  const newestFirst = { orderBy: ["started_at", "run_id"], descending: true } as const;

  const list = Effect.fn("RunRecordService.list")(function* (
    caller: Caller,
    input: typeof Telescope.RunListInput.Type,
  ) {
    yield* requireMember(input.workspaceId, caller);
    const rows = yield* db.select(
      input.workspaceId,
      "runs",
      decodeRuns,
      {
        ...(input.agentId === undefined ? {} : { agent_id: input.agentId }),
        ...(input.threadId === undefined ? {} : { thread_id: input.threadId }),
      },
      {
        ...newestFirst,
        limit: input.limit ?? DEFAULT_LIST_LIMIT,
        ...(input.before === undefined
          ? {}
          : {
              filter: sql`(started_at, run_id) < (${input.before.startedAt}, ${input.before.runId})`,
            }),
      },
    );
    return { runs: rows.map(toRun) };
  });

  const calls = Effect.fn("RunRecordService.calls")(function* (caller: Caller, run: RunRef) {
    yield* requireMember(run.workspaceId, caller);
    yield* runRow(run);
    const where = { run_id: run.runId };
    const rows = yield* db.select(run.workspaceId, "run_calls", decodeCalls, where, {
      orderBy: ["seq"],
    });
    return { calls: rows.map(toCall) };
  });

  const runsForMemory = Effect.fn("RunRecordService.runsForMemory")(function* (
    caller: Caller,
    input: { readonly workspaceId: WorkspaceId; readonly memoryId: Telescope.Memory["id"] },
  ) {
    yield* requireMember(input.workspaceId, caller);
    const rows = yield* db.select(input.workspaceId, "runs", decodeRuns, undefined, {
      ...newestFirst,
      filter: sql`EXISTS (
        SELECT 1 FROM json_each(input_snapshot_json, '$.contextManifest')
        WHERE json_extract(value, '$.kind') = 'memory'
          AND json_extract(value, '$.id') = ${input.memoryId}
      )`,
    });
    return { runs: rows.map(toRun) };
  });

  const memoriesForRun = Effect.fn("RunRecordService.memoriesForRun")(function* (
    caller: Caller,
    run: RunRef,
  ) {
    yield* requireMember(run.workspaceId, caller);
    const used = (yield* runRow(run)).input_snapshot_json.contextManifest.filter(
      (entry) => entry.kind === "memory",
    );
    if (used.length === 0) return { memories: [] };
    const stored = yield* db.select(run.workspaceId, "memories", decodeMemorySources, undefined, {
      columns: ["memory_id", "source_json"],
      filter: sql.in("memory_id", [...new Set(used.map((entry) => entry.id))]),
    });
    const sources = new Map(stored.map((row) => [row.memory_id, row.source_json.runId]));
    return {
      memories: used.map((entry) => {
        const memoryId = Telescope.MemoryId.make(entry.id);
        const sourceRunId = sources.get(memoryId);
        return {
          memoryId,
          hash: entry.hash,
          stored: sources.has(memoryId),
          ...(sourceRunId === undefined ? {} : { sourceRunId }),
        };
      }),
    };
  });

  const pruneBefore = (cutoff: DateTime.Utc) => db.pruneRunsBefore(DateTime.formatIso(cutoff));

  return RunRecordService.of({
    start,
    attachThread,
    recordCall,
    recordThreadTurn,
    finish,
    label,
    get,
    list,
    calls,
    runsForMemory,
    memoriesForRun,
    pruneBefore,
  });
});

export const layer = Layer.effect(RunRecordService, make).pipe(
  Layer.provide(Layer.merge(TelescopeDb.layer, WorkspaceService.layer)),
);

const DAY_MS = 24 * 60 * 60 * 1000;

/** One pass of the daily retention job: drops finished runs older than `telescope.runRetentionDays`. */
export const makeRetentionPass = Effect.gen(function* () {
  const runs = yield* RunRecordService;
  const settings = yield* ServerSettingsService;
  let nextCheckMs = 0;
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (now < nextCheckMs) return;
    const { runRetentionDays } = (yield* settings.getSettings).telescope;
    yield* runs.pruneBefore(DateTime.makeUnsafe(now - runRetentionDays * DAY_MS));
    nextCheckMs = now + DAY_MS;
  });
});

export const layerRetention = Layer.effectDiscard(
  Effect.gen(function* () {
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("telescope.runRetention", yield* makeRetentionPass);
  }),
).pipe(Layer.provide(Scheduler.layer));
