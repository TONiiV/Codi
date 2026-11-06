import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(TaskBoardService.layer, WorkspaceService.layer).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
);

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);
const isStale = Schema.is(Telescope.StaleTaskVersionError);
const reasonOf = (error: { readonly _tag: string }) =>
  isWorkspaceError(error) ? error.reason : error._tag;

const session = (name: string): WorkspaceService.Caller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const alice = { caller: session("alice") };
const setup = Effect.gen(function* () {
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const board = yield* TaskBoardService.TaskBoardService;
  const create = (name: string) =>
    workspaces.create(alice.caller, { kind: "enterprise", name, displayName: "Alice" });
  const a = (yield* create("A")).id;
  const b = (yield* create("B")).id;
  const { self } = yield* workspaces.get(alice.caller, { workspaceId: a });
  const agent = { ...alice, authorId: "agent-cos", onBehalfOf: [self.subjectId, "agent-cos"] };
  return { workspaces, board, a, b, aliceId: self.subjectId, agent };
});

it.layer(layer)("Telescope task board", (it) => {
  it.effect("records a commit per write and rejects a stale base version", () =>
    Effect.gen(function* () {
      const { workspaces, board, a, aliceId, agent } = yield* setup;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Ship invites" });
      assert.strictEqual(task.version, 1);
      const bob = { caller: session("bob") };
      const { code } = yield* workspaces.invite(alice.caller, { workspaceId: a, role: "member" });
      const bobId = (yield* workspaces.accept(bob.caller, { code, displayName: "Bob" })).subjectId;

      const moved = yield* board.updateTask(agent, {
        workspaceId: a,
        taskId: task.id,
        baseVersion: 1,
        set: {
          title: "Ship invites",
          status: "in_progress",
          ownerAgentId: Telescope.AgentId.make("agent-cos"),
        },
        note: "Picked this up.",
      });
      assert.strictEqual(moved.version, 2);
      assert.deepStrictEqual(
        moved.freeText.map((e) => [e.authorId, e.text]),
        [["agent-cos", "Picked this up."]],
      );

      const cleared = yield* board.updateTask(bob, {
        workspaceId: a,
        taskId: task.id,
        baseVersion: 2,
        set: { ownerAgentId: null },
        note: "Taking it back.",
      });
      assert.strictEqual(cleared.ownerAgentId, undefined);
      assert.deepStrictEqual(
        cleared.freeText.map((e) => e.authorId),
        ["agent-cos", bobId],
      );

      const stale = yield* board
        .updateTask(alice, {
          workspaceId: a,
          taskId: task.id,
          baseVersion: 2,
          set: { status: "done" },
        })
        .pipe(Effect.flip);
      assert.deepStrictEqual(isStale(stale) && [stale.baseVersion, stale.currentVersion], [2, 3]);
      assert.strictEqual(
        (yield* board.getTask(alice, { workspaceId: a, taskId: task.id })).status,
        "in_progress",
      );

      const { commits } = yield* board.listCommits(alice, { workspaceId: a, taskId: task.id });
      assert.deepStrictEqual(
        commits.map((c) => [c.baseVersion, c.authorId, c.onBehalfOf, c.parentId]),
        [
          [0, aliceId, undefined, undefined],
          [1, "agent-cos", [aliceId, "agent-cos"], commits[0]?.id],
          [2, bobId, undefined, commits[1]?.id],
        ],
      );
      assert.deepStrictEqual(commits[1]?.changedFields, {
        status: "in_progress",
        ownerAgentId: "agent-cos",
        freeText: [{ authorId: "agent-cos", text: "Picked this up.", at: moved.updatedAt }],
      });
      assert.deepStrictEqual(Object.keys(commits[2]?.changedFields ?? {}), [
        "ownerAgentId",
        "freeText",
      ]);
      assert.strictEqual(commits[2]?.changedFields.ownerAgentId, null);
    }),
  );

  it.effect("supersedes decisions append-only with a commit per change", () =>
    Effect.gen(function* () {
      const { board, a, aliceId, agent } = yield* setup;
      const first = yield* board.createDecision(alice, {
        workspaceId: a,
        title: "Postgres",
        text: "",
      });
      assert.strictEqual(first.version, 1);
      const proposal = yield* board.createDecision(alice, {
        workspaceId: a,
        title: "pglite",
        text: "",
        status: "proposed",
        supersedes: first.id,
      });
      const second = yield* board.createDecision(agent, {
        workspaceId: a,
        title: "SQLite",
        text: "One engine.",
        supersedes: first.id,
      });
      const { decisions } = yield* board.listDecisions(alice, { workspaceId: a });
      assert.deepStrictEqual(
        decisions.map((d) => [d.title, d.status, d.version, d.supersedes]).toSorted(),
        [
          ["Postgres", "superseded", 2, undefined],
          ["SQLite", "decided", 1, first.id],
          ["pglite", "proposed", 1, first.id],
        ],
      );
      const again = yield* board
        .createDecision(alice, { workspaceId: a, title: "MySQL", text: "", supersedes: first.id })
        .pipe(Effect.flip);
      assert.strictEqual(reasonOf(again), "conflict");
      assert.strictEqual(second.authorId, "agent-cos");

      const { commits } = yield* board.listCommits(alice, { workspaceId: a, taskId: first.id });
      assert.deepStrictEqual(
        commits.map((c) => [c.baseVersion, c.authorId, c.onBehalfOf, c.parentId, c.changedFields]),
        [
          [0, aliceId, undefined, undefined, { title: "Postgres", text: "", status: "decided" }],
          [1, "agent-cos", [aliceId, "agent-cos"], commits[0]?.id, { status: "superseded" }],
        ],
      );
      const proposed = yield* board.listCommits(alice, { workspaceId: a, taskId: proposal.id });
      assert.deepStrictEqual(
        proposed.commits.map((c) => c.changedFields),
        [{ title: "pglite", text: "", status: "proposed", supersedes: first.id }],
      );
    }),
  );

  it.effect("lists only the latest free text and keeps the full history on get", () =>
    Effect.gen(function* () {
      const { board, a } = yield* setup;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Chatty" });
      const notes = Array.from({ length: 21 }, (_, i) => `note ${i}`);
      yield* Effect.forEach(notes, (note, i) =>
        board.updateTask(alice, { workspaceId: a, taskId: task.id, baseVersion: i + 1, note }),
      );
      const [listed] = (yield* board.listTasks(alice, { workspaceId: a })).tasks;
      assert.deepStrictEqual(
        listed?.freeText.map((e) => e.text),
        notes.slice(-Telescope.BOARD_LIMITS.listedFreeTextEntries),
      );
      const full = yield* board.getTask(alice, { workspaceId: a, taskId: task.id });
      assert.strictEqual(full.freeText.length, 21);
    }),
  );

  it.effect("rejects non-members and keeps workspaces apart", () =>
    Effect.gen(function* () {
      const { board, a, b } = yield* setup;
      const task = yield* board.createTask(alice, { workspaceId: a, title: "Secret" });
      yield* board.createDecision(alice, { workspaceId: a, title: "Secret call", text: "" });

      const outsider = { caller: session("mallory") };
      const denied = yield* Effect.all([
        Effect.flip(board.listTasks(outsider, { workspaceId: a })),
        Effect.flip(board.getTask(outsider, { workspaceId: a, taskId: task.id })),
        Effect.flip(board.listDecisions(outsider, { workspaceId: a })),
        Effect.flip(board.listCommits(outsider, { workspaceId: a, taskId: task.id })),
        Effect.flip(board.createTask(outsider, { workspaceId: a, title: "x" })),
      ]);
      assert.deepStrictEqual(denied.map(reasonOf), Array(5).fill("forbidden"));

      assert.deepStrictEqual((yield* board.listTasks(alice, { workspaceId: b })).tasks, []);
      assert.deepStrictEqual((yield* board.listDecisions(alice, { workspaceId: b })).decisions, []);
      assert.deepStrictEqual(
        (yield* board.listCommits(alice, { workspaceId: b, taskId: task.id })).commits,
        [],
      );
      const foreign = yield* board
        .getTask(alice, { workspaceId: b, taskId: task.id })
        .pipe(Effect.flip);
      assert.strictEqual(reasonOf(foreign), "not_found");
      const crossUpdate = yield* board
        .updateTask(alice, {
          workspaceId: b,
          taskId: task.id,
          baseVersion: 1,
          set: { status: "done" },
        })
        .pipe(Effect.flip);
      assert.strictEqual(reasonOf(crossUpdate), "not_found");
    }),
  );
});
