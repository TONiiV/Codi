import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, Telescope, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(RunRecordService.layer, WorkspaceService.layer).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env-elsewhere")),
    }),
  ),
);

const agentId = Telescope.AgentId.make("agent-pm");
const memoryId = Telescope.MemoryId.make("memory-1");
const threadId = ThreadId.make("thread-1");
const snapshot = (memories: ReadonlyArray<string>) => ({
  promptVersion: "prompt@3",
  skillsVersions: { triage: "2" },
  powersVersion: "powers@1",
  model: "model-a",
  contextManifest: [
    { kind: "board" as const, id: "board-1", hash: "b1" },
    ...memories.map((id) => ({ kind: "memory" as const, id, hash: `h-${id}` })),
  ],
});
const noTokens = { input: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
const session = (name: string): WorkspaceService.Caller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const alice = session("alice");
const mallory = session("mallory");

const setup = Effect.gen(function* () {
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const runs = yield* RunRecordService.RunRecordService;
  const workspace = yield* workspaces.create(alice, {
    kind: "enterprise",
    name: "Acme",
    displayName: "Alice",
  });
  return { runs, workspaceId: workspace.id, aliceId: workspace.createdBy };
});

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);
const reason = (error: unknown) => (isWorkspaceError(error) ? error.reason : "unexpected");

it.layer(layer)("Telescope run records", (it) => {
  it.effect("stores the input snapshot, ordered calls, tokens and appended labels", () =>
    Effect.gen(function* () {
      const { runs, workspaceId, aliceId } = yield* setup;
      const started = yield* runs.start(alice, workspaceId, {
        agentId,
        via: ["agent-lead"],
        inputSnapshot: snapshot([memoryId]),
      });
      yield* runs.attachThread({ workspaceId, runId: started.id }, threadId);
      for (const tool of ["memory.search", "board.read", "board.commit"]) {
        yield* runs.recordCall(
          { workspaceId, runId: started.id },
          {
            tool,
            argsRedacted: { query: "[redacted]" },
            grantCheck: tool === "board.commit" ? "denied" : "allowed",
            durationMs: 12,
          },
        );
      }
      yield* runs.recordThreadTurn(threadId, { ...noTokens, input: 100, output: 20 });
      yield* runs.recordThreadTurn(ThreadId.make("other-thread"), { ...noTokens, input: 999 });
      yield* runs.finish(
        { workspaceId, runId: started.id },
        {
          outputSummary: "Triaged 3 tasks",
          tokens: { ...noTokens, input: 5, cachedInput: 4 },
          resultLabels: ["completed"],
        },
      );
      yield* runs.label({ workspaceId, runId: started.id }, "approved");
      yield* runs.label({ workspaceId, runId: started.id }, "reverted");

      const run = yield* runs.get(alice, { workspaceId, runId: started.id });
      assert.deepStrictEqual(run.inputSnapshot, snapshot([memoryId]));
      assert.deepStrictEqual(run.onBehalfOf, [aliceId, "agent-lead"]);
      assert.strictEqual(run.threadId, threadId);
      assert.strictEqual(run.outputSummary, "Triaged 3 tasks");
      assert.deepStrictEqual(run.tokens, {
        input: 105,
        cachedInput: 4,
        cacheCreation: 0,
        output: 20,
      });
      assert.deepStrictEqual(run.resultLabels, ["completed", "approved", "reverted"]);

      const { calls } = yield* runs.calls(alice, { workspaceId, runId: started.id });
      assert.deepStrictEqual(
        calls.map((call) => [call.seq, call.tool, call.grantCheck]),
        [
          [0, "memory.search", "allowed"],
          [1, "board.read", "allowed"],
          [2, "board.commit", "denied"],
        ],
      );
      assert.deepStrictEqual(calls[0]?.args, { query: "[redacted]" });

      // A finished run takes no more calls or thread tokens.
      const late = yield* runs
        .recordCall(
          { workspaceId, runId: started.id },
          {
            tool: "late",
            argsRedacted: null,
            grantCheck: "allowed",
            durationMs: 1,
          },
        )
        .pipe(Effect.flip);
      assert.strictEqual(reason(late), "conflict");
      yield* runs.recordThreadTurn(threadId, { ...noTokens, input: 50 });
      assert.strictEqual(
        (yield* runs.get(alice, { workspaceId, runId: started.id })).tokens.input,
        105,
      );
    }),
  );

  it.effect("finds the runs that used a memory, newest first", () =>
    Effect.gen(function* () {
      const { runs, workspaceId } = yield* setup;
      const start = (memories: ReadonlyArray<string>) =>
        runs.start(alice, workspaceId, {
          agentId,
          inputSnapshot: snapshot(memories),
        });
      const first = yield* start([memoryId]);
      yield* TestClock.adjust("1 minute");
      const sameIdOtherKind = snapshot(["memory-2"]);
      const second = yield* runs.start(alice, workspaceId, {
        agentId,
        inputSnapshot: {
          ...sameIdOtherKind,
          contextManifest: [
            ...sameIdOtherKind.contextManifest,
            { kind: "diary", id: memoryId, hash: "d1" },
          ],
        },
      });
      yield* TestClock.adjust("1 minute");
      const third = yield* start(["memory-2", memoryId]);
      const sameInstant = yield* start([]);

      const used = yield* runs.runsForMemory(alice, { workspaceId, memoryId });
      assert.deepStrictEqual(
        used.runs.map((run) => run.id),
        [third.id, first.id],
      );
      const paged: Array<Telescope.AgentRunId> = [];
      let before: (typeof Telescope.RunListInput.Type)["before"];
      for (let page = 0; page < 5; page++) {
        const [run] = (yield* runs.list(alice, {
          workspaceId,
          limit: 1,
          ...(before && { before }),
        })).runs;
        if (run === undefined) break;
        paged.push(run.id);
        before = { startedAt: run.startedAt, runId: run.id };
      }
      assert.strictEqual(third.startedAt, sameInstant.startedAt);
      assert.sameMembers(paged.slice(0, 2), [third.id, sameInstant.id]);
      assert.deepStrictEqual(paged.slice(2), [second.id, first.id]);
    }),
  );

  it.effect("prunes finished runs and their calls ended before the cutoff, never open ones", () =>
    Effect.gen(function* () {
      const { runs, workspaceId } = yield* setup;
      const start = runs.start(alice, workspaceId, {
        agentId,
        inputSnapshot: snapshot([]),
      });
      const call = {
        tool: "board.read",
        argsRedacted: {},
        grantCheck: "allowed" as const,
        durationMs: 3,
      };
      const old = yield* start;
      const stillOpen = yield* start;
      yield* runs.recordCall({ workspaceId, runId: old.id }, call);
      yield* runs.recordCall({ workspaceId, runId: stillOpen.id }, call);
      yield* runs.finish(
        { workspaceId, runId: old.id },
        { outputSummary: "done", tokens: noTokens, resultLabels: [] },
      );
      yield* TestClock.adjust("2 days");
      const recent = yield* start;
      yield* runs.pruneBefore(DateTime.subtract(yield* DateTime.now, { days: 1 }));

      const scoped = { workspaceId, runId: old.id };
      assert.strictEqual(reason(yield* Effect.flip(runs.get(alice, scoped))), "not_found");
      assert.strictEqual(reason(yield* Effect.flip(runs.calls(alice, scoped))), "not_found");
      const sql = yield* SqlClient.SqlClient;
      const calls = yield* sql`SELECT 1 FROM telescope_run_calls WHERE run_id = ${old.id}`;
      assert.strictEqual(calls.length, 0);
      assert.strictEqual((yield* runs.get(alice, { workspaceId, runId: recent.id })).id, recent.id);
      const open = { workspaceId, runId: stillOpen.id };
      assert.lengthOf((yield* runs.calls(alice, open)).calls, 1);
      yield* runs.recordCall(open, call);
      yield* runs.finish(open, { outputSummary: "late", tokens: noTokens, resultLabels: [] });
    }),
  );

  it.effect("lists a run's memories in manifest order with the run each came from", () =>
    Effect.gen(function* () {
      const { runs, workspaceId } = yield* setup;
      const writer = yield* runs.start(alice, workspaceId, {
        agentId,
        inputSnapshot: snapshot([]),
      });
      const sql = yield* SqlClient.SqlClient;
      const memory = (id: string, source: object) =>
        sql`INSERT INTO telescope_memories (memory_id, workspace_id, agent_id, scope, layer, level,
          kind, text, source_json, valid_from)
          VALUES (${id}, ${workspaceId}, ${agentId}, 'personal', 'long_term', 'internal', 'fact',
          'text', ${JSON.stringify(source)}, '2026-01-01T00:00:00.000Z')`;
      yield* memory("memory-2", { runId: writer.id });
      yield* memory(memoryId, { threadId: "thread-x" });
      const reader = yield* runs.start(alice, workspaceId, {
        agentId,
        inputSnapshot: snapshot(["memory-2", "memory-gone", memoryId]),
      });

      const { memories } = yield* runs.memoriesForRun(alice, { workspaceId, runId: reader.id });
      assert.deepStrictEqual(memories, [
        {
          memoryId: Telescope.MemoryId.make("memory-2"),
          hash: "h-memory-2",
          stored: true,
          sourceRunId: writer.id,
        },
        { memoryId: Telescope.MemoryId.make("memory-gone"), hash: "h-memory-gone", stored: false },
        { memoryId, hash: `h-${memoryId}`, stored: true },
      ]);
      const none = yield* runs.memoriesForRun(alice, { workspaceId, runId: writer.id });
      assert.deepStrictEqual(none.memories, []);
    }),
  );

  it.effect("exports the provider name on the run span only when the snapshot has one", () =>
    Effect.gen(function* () {
      const { runs, workspaceId } = yield* setup;
      const providers: Array<unknown> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          const end = span.end.bind(span);
          span.end = (endTime, exit) => {
            end(endTime, exit);
            if (options.name === "invoke_agent")
              providers.push(span.attributes.get("gen_ai.provider.name"));
          };
          return span;
        },
      });
      for (const provider of ["anthropic", undefined]) {
        const run = yield* runs.start(alice, workspaceId, {
          agentId,
          inputSnapshot: { ...snapshot([]), ...(provider === undefined ? {} : { provider }) },
        });
        yield* runs
          .finish(
            { workspaceId, runId: run.id },
            { outputSummary: "done", tokens: noTokens, resultLabels: [] },
          )
          .pipe(Effect.withTracer(tracer));
      }
      assert.deepStrictEqual(providers, ["anthropic", undefined]);
    }),
  );

  it.effect("rejects non-members on reads and as the member a run acts for", () =>
    Effect.gen(function* () {
      const { runs, workspaceId } = yield* setup;
      const run = yield* runs.start(alice, workspaceId, {
        agentId,
        inputSnapshot: snapshot([]),
      });
      const scoped = { workspaceId, runId: run.id };
      const reads: ReadonlyArray<Effect.Effect<object, { readonly _tag: string }>> = [
        runs.get(mallory, scoped),
        runs.calls(mallory, scoped),
        runs.list(mallory, { workspaceId }),
        runs.runsForMemory(mallory, { workspaceId, memoryId }),
        runs.memoriesForRun(mallory, scoped),
        runs.start(mallory, workspaceId, { agentId, inputSnapshot: snapshot([]) }),
      ];
      for (const read of reads) {
        assert.strictEqual(reason(yield* Effect.flip(read)), "forbidden");
      }
    }),
  );
});

it.effect("the retention pass prunes runs past the configured days once a day", () =>
  Effect.gen(function* () {
    const { runs, workspaceId } = yield* setup;
    const day = 24 * 60 * 60 * 1000;
    const exists = (runId: Telescope.AgentRunId) =>
      runs
        .get(alice, { workspaceId, runId })
        .pipe(
          Effect.as(true),
          Effect.catchTags({ TelescopeWorkspaceError: () => Effect.succeed(false) }),
        );
    const start = runs.start(alice, workspaceId, { agentId, inputSnapshot: snapshot([]) });
    const finish = (runId: Telescope.AgentRunId) =>
      runs.finish(
        { workspaceId, runId },
        { outputSummary: "done", tokens: noTokens, resultLabels: [] },
      );
    yield* TestClock.setTime(0);
    const old = yield* start;
    yield* finish(old.id);
    const stillOpen = yield* start;
    yield* TestClock.setTime(5 * day);
    const recent = yield* start;
    yield* finish(recent.id);
    const pass = yield* RunRecordService.makeRetentionPass;

    yield* TestClock.setTime(7 * day);
    yield* pass;
    assert.deepStrictEqual(
      [yield* exists(old.id), yield* exists(stillOpen.id), yield* exists(recent.id)],
      [false, true, true],
    );

    // The next check waits a day, so a run that ages out meanwhile survives until then.
    yield* TestClock.setTime(8 * day - 1);
    const late = yield* start;
    yield* pass;
    assert.isTrue(yield* exists(recent.id));
    yield* TestClock.setTime(9 * day);
    yield* pass;
    assert.deepStrictEqual(
      [yield* exists(recent.id), yield* exists(late.id), yield* exists(stillOpen.id)],
      [false, true, true],
    );

    // Retention counts from the finish: a run open longer than the window survives its finish.
    yield* TestClock.setTime(10 * day);
    yield* finish(stillOpen.id);
    yield* TestClock.setTime(10 * day + 60_000);
    yield* pass;
    assert.isTrue(yield* exists(stillOpen.id));
    yield* TestClock.setTime(12 * day + 60_000);
    yield* pass;
    assert.isFalse(yield* exists(stillOpen.id));
  }).pipe(
    Effect.provide(
      layer.pipe(
        Layer.provideMerge(ServerSettings.layerTest({ telescope: { runRetentionDays: 2 } })),
      ),
    ),
  ),
);
