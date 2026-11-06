import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, Telescope } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AttributionService from "./AttributionService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as WakeQueueService from "./WakeQueueService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(
  AttributionService.layer,
  TaskBoardService.layer,
  RunRecordService.layer,
  WakeQueueService.layer,
  WorkspaceService.layer,
).pipe(Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)));

const session = (name: string): WorkspaceService.Caller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const alice = session("alice");
const agentId = Telescope.AgentId.make("agent-pm");
const hour = 60 * 60 * 1000;
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const snapshot = {
  promptVersion: "prompt@1",
  skillsVersions: {},
  powersVersion: "powers@1",
  model: "model-a",
  contextManifest: [],
};
const noTokens = { input: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
const isWorkspaceError = Schema.is(Telescope.WorkspaceError);

it.layer(layer)("Telescope attribution", (it) => {
  it.effect(
    "summarises where one workspace's work waits, whose hands it is in and since when",
    () =>
      Effect.gen(function* () {
        const workspaces = yield* WorkspaceService.WorkspaceService;
        const board = yield* TaskBoardService.TaskBoardService;
        const runs = yield* RunRecordService.RunRecordService;
        const wakes = yield* WakeQueueService.WakeQueueService;
        const attribution = yield* AttributionService.AttributionService;
        const sql = yield* SqlClient.SqlClient;
        const create = (name: string) =>
          workspaces.create(alice, { kind: "enterprise", name, displayName: "Alice" });
        const { id: workspaceId } = yield* create("A");
        const { id: otherId } = yield* create("B");
        yield* sql`INSERT INTO telescope_agents (agent_id, workspace_id, kind, name,
        standing_powers_json, exposure, sync_with_board, dispatch_mode, channels_json,
        created_at, updated_at)
        VALUES (${agentId}, ${workspaceId}, 'custom', 'PM 助理', '{}', 'private', 0, 'manual',
        '[]', ${iso(0)}, ${iso(0)})`;
        const me = { caller: alice };
        const agent = { caller: alice, authorId: agentId };
        const wake = (inWorkspace: Telescope.WorkspaceId, key: string) =>
          wakes.enqueue(inWorkspace, {
            reason: "message",
            agentId,
            coalesceKey: key,
            priority: 1,
            subjectId: "alice",
            payload: {},
          });

        yield* TestClock.setTime(0);
        yield* board.createTask(me, { workspaceId, title: "Old todo" });
        yield* board.createTask(me, { workspaceId: otherId, title: "Elsewhere" });
        yield* wake(workspaceId, "first");
        yield* TestClock.setTime(hour);
        yield* board.createTask(me, {
          workspaceId,
          title: "Owned",
          status: "in_progress",
          ownerAgentId: agentId,
        });
        yield* board.createTask(me, { workspaceId, title: "Shipped", status: "done" });
        const open = yield* runs.start(alice, workspaceId, { agentId, inputSnapshot: snapshot });
        const finished = yield* runs.start(alice, workspaceId, {
          agentId,
          inputSnapshot: snapshot,
        });
        yield* runs.finish(
          { workspaceId, runId: finished.id },
          { outputSummary: "done", tokens: noTokens, resultLabels: [] },
        );
        yield* runs.start(alice, otherId, { agentId, inputSnapshot: snapshot });
        yield* wake(workspaceId, "second");
        yield* wake(otherId, "other");
        yield* TestClock.setTime(2 * hour);
        const leased = yield* board.createTask(me, { workspaceId, title: "Leased" });
        for (const tool of ["board.read", "board.commit"])
          yield* runs.recordCall(
            { workspaceId, runId: open.id },
            { tool, argsRedacted: {}, grantCheck: "allowed", durationMs: 5 },
          );
        yield* board.createDecision(me, {
          workspaceId,
          title: "Pick one",
          text: "",
          status: "proposed",
        });
        yield* board.createDecision(me, { workspaceId, title: "Settled", text: "" });
        yield* TestClock.setTime(3 * hour);
        yield* board.updateTask(me, {
          workspaceId,
          taskId: leased.id,
          baseVersion: leased.version,
          set: { status: "in_review" },
        });
        yield* board.acquireLease(agent, { workspaceId, taskId: leased.id });
        const started = yield* wakes.dequeue;
        assert.strictEqual(started?.coalesceKey, "first");
        yield* TestClock.adjust("1 minute");

        const summary = yield* attribution.summary(alice, { workspaceId });
        assert.deepStrictEqual(
          summary.tasks.map(({ id: _, ...task }) => task),
          [
            { title: "Old todo", status: "todo", statusSince: iso(0) },
            {
              title: "Owned",
              status: "in_progress",
              statusSince: iso(hour),
              holder: { via: "owner", name: "PM 助理" },
            },
            {
              title: "Leased",
              status: "in_review",
              statusSince: iso(3 * hour),
              holder: { via: "lease", name: "PM 助理" },
            },
          ],
        );
        assert.deepStrictEqual(summary.openTasks, {
          todo: 1,
          in_progress: 1,
          in_review: 1,
          needs_decision: 0,
        });
        assert.deepStrictEqual(summary.runs, [
          {
            id: open.id,
            agentId,
            agentName: "PM 助理",
            startedAt: iso(hour),
            calls: 2,
            tokens: noTokens,
            step: { tool: "board.commit", at: iso(2 * hour) },
          },
        ]);
        assert.deepStrictEqual(summary.wakes, { queued: 1, running: 1, oldestQueuedAt: iso(hour) });
        assert.strictEqual(summary.pendingDecisions, 1);
        assert.strictEqual(summary.generatedAt, iso(3 * hour + 60_000));

        // Once the lease lapses the task has no holder; the board's next read clears it.
        yield* TestClock.adjust("5 minutes");
        const lapsed = yield* attribution.summary(alice, { workspaceId });
        assert.isUndefined(lapsed.tasks.find((task) => task.id === leased.id)?.holder);

        const denied = yield* Effect.flip(attribution.summary(session("mallory"), { workspaceId }));
        assert.strictEqual(isWorkspaceError(denied) ? denied.reason : denied._tag, "forbidden");
      }),
  );
});
