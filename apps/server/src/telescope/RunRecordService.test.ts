import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, Telescope, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(RunRecordService.layer, WorkspaceService.layer).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
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
      yield* start(["memory-2"]);
      yield* TestClock.adjust("1 minute");
      const third = yield* start(["memory-2", memoryId]);

      const used = yield* runs.runsForMemory(alice, { workspaceId, memoryId });
      assert.deepStrictEqual(
        used.runs.map((run) => run.id),
        [third.id, first.id],
      );
      const page = yield* runs.list(alice, { workspaceId, limit: 2 });
      assert.strictEqual(page.runs[0]?.id, third.id);
      const older = yield* runs.list(alice, {
        workspaceId,
        before: page.runs[1]!.startedAt,
      });
      assert.deepStrictEqual(
        older.runs.map((run) => run.id),
        [first.id],
      );
    }),
  );

  it.effect("prunes runs and their calls started before the cutoff", () =>
    Effect.gen(function* () {
      const { runs, workspaceId } = yield* setup;
      const start = runs.start(alice, workspaceId, {
        agentId,
        inputSnapshot: snapshot([]),
      });
      const old = yield* start;
      yield* runs.recordCall(
        { workspaceId, runId: old.id },
        {
          tool: "board.read",
          argsRedacted: {},
          grantCheck: "allowed",
          durationMs: 3,
        },
      );
      yield* TestClock.adjust("2 days");
      const recent = yield* start;
      yield* runs.pruneBefore(DateTime.subtract(yield* DateTime.now, { days: 1 }));

      const gone = yield* runs.get(alice, { workspaceId, runId: old.id }).pipe(Effect.flip);
      assert.strictEqual(reason(gone), "not_found");
      assert.deepStrictEqual((yield* runs.calls(alice, { workspaceId, runId: old.id })).calls, []);
      assert.strictEqual((yield* runs.get(alice, { workspaceId, runId: recent.id })).id, recent.id);
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
        runs.start(mallory, workspaceId, { agentId, inputSnapshot: snapshot([]) }),
      ];
      for (const read of reads) {
        assert.strictEqual(reason(yield* Effect.flip(read)), "forbidden");
      }
    }),
  );
});
