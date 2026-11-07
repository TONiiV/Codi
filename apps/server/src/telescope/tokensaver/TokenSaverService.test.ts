import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, ProjectId, type Telescope } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { UsageProjectResolver } from "../../usage/UsageProjectResolver.ts";
import * as TaskBoardService from "../TaskBoardService.ts";
import * as WorkspaceService from "../WorkspaceService.ts";
import { transcript } from "./fixtures.testkit.ts";
import * as TokenSaverService from "./TokenSaverService.ts";

const environmentId = EnvironmentId.make("env-1");
const owners = new Map([
  ["s1", ProjectId.make("bound")],
  ["s2", ProjectId.make("unbound")],
]);
const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(
  TokenSaverService.layer,
  TaskBoardService.layer,
  WorkspaceService.layer,
).pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(environmentId),
      }),
      // Its projects are not in the project store, so bindings skip the local project check.
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("env-elsewhere")),
      }),
      Layer.succeed(UsageProjectResolver, {
        resolve: (ids) =>
          Effect.succeed(new Map([...owners].filter(([sessionId]) => ids.has(sessionId)))),
      }),
    ),
  ),
  Layer.provideMerge(Layer.mergeAll(database, NodeCrypto.layer, NodeServices.layer)),
);

const alice = {
  caller: { sessionId: AuthSessionId.make("session-alice"), subject: "one-time-token" },
};

const bob = {
  caller: { sessionId: AuthSessionId.make("session-bob"), subject: "one-time-token" },
};
const withHome = (home: string) =>
  Effect.provideService(HostProcess.Environment, { CLAUDE_CONFIG_DIR: home });
const subagent = (line: string) =>
  JSON.stringify({ ...JSON.parse(line), agentId: "a1", isSidechain: true });

/**
 * Session s1 resumed in a second project directory, with a subagent that edits a.ts between the
 * parent's second and third read; s2 is unbound.
 */
const writeTranscripts = Effect.fn("writeTranscripts")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fileSystem.makeTempDirectoryScoped();
  const file = (relative: string, lines: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const target = path.join(home, "projects", relative);
      yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
      yield* fileSystem.writeFileString(target, lines.join("\n") + "\n");
    });
  const readA = (minute: number, id: string) => [
    transcript.toolUse("s1", minute, `m-${id}`, id, "Read", { file_path: "/repo/a.ts" }),
    transcript.toolResult("s1", minute, id, 4000),
  ];
  const bash = transcript.toolUse("s1", 4, "m-b", "b1", "Bash", { command: "vp test run" });
  yield* file("-repo/s1.jsonl", [
    transcript.prompt("s1", 0, "fix the build"),
    ...readA(1, "r1"),
    ...readA(2, "r2"),
    bash,
  ]);
  yield* file("-home/s1.jsonl", [
    bash,
    transcript.toolResult("s1", 5, "b1", 100_000),
    transcript.toolResult("s1", 5, "b1", 100_000),
    ...readA(3, "r3"),
    transcript.prompt("s1", 9, "the tests still fail"),
  ]);
  yield* file(
    "-repo/s1/subagents/agent-a1.jsonl",
    [
      transcript.prompt("s1", 6, "check the logs"),
      transcript.toolUse("s1", 2, "m-sa-e", "sa-e", "Edit", { file_path: "/repo/a.ts" }),
      ...readA(7, "sa-r"),
      transcript.toolUse("s1", 8, "m-sa-b", "sa-b", "Bash", { command: "cat build.log" }),
      transcript.toolResult("s1", 8, "sa-b", 41_600),
    ].map(subagent),
  );
  yield* file("-repo/s2.jsonl", [
    transcript.toolUse("s2", 1, "m-x", "x1", "Bash", { command: "cat huge.log" }),
    transcript.toolResult("s2", 2, "x1", 400_000),
  ]);
  return home;
});

it.layer(layer)("Telescope token saver", (it) => {
  it.effect("reads a session across directories and subagents, and proposes one report", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspaces = yield* WorkspaceService.WorkspaceService;
        const board = yield* TaskBoardService.TaskBoardService;
        const tokenSaver = yield* TokenSaverService.TokenSaverService;
        const { id: workspaceId } = yield* workspaces.create(alice.caller, {
          kind: "personal",
          name: "Mine",
          displayName: "Alice",
        });
        yield* workspaces.bind(alice.caller, {
          workspaceId,
          environmentId,
          projectId: ProjectId.make("bound"),
        });
        const home = yield* writeTranscripts();

        const run = (env: NodeJS.ProcessEnv) =>
          tokenSaver
            .runWeekly(alice, {
              workspaceId,
              since: "2026-11-01T00:00:00.000Z",
              until: "2026-11-08T00:00:00.000Z",
            })
            .pipe(Effect.provideService(HostProcess.Environment, env));
        const report = yield* run({ CLAUDE_CONFIG_DIR: home });

        assert.strictEqual(report.sessionsAnalyzed, 1);
        assert.deepStrictEqual(
          report.findings.map(({ pattern, estimatedSavingTokens, savingKind }) => [
            pattern,
            estimatedSavingTokens,
            savingKind,
          ]),
          [
            ["oversized_tool_outputs", 27400, "tokens"],
            ["repeated_reads", 1000, "tokens"],
          ],
        );
        assert.deepStrictEqual(report.quality, {
          testPassRate: null,
          followUpPrompts: 1,
          rollbacks: null,
        });
        assert.include(report.markdown, "## 1. 巨大的工具输出");
        assert.include(report.markdown, "只统计在 Codi 线程中运行的会话，其他 provider 暂不支持");
        assert.include(
          report.markdown,
          "超过阈值的结果 2 次，这些结果共计 35.4K token，主要工具的阈值 4K token，主要来自 Bash，主要工具超过阈值 2 次\n- 预计省：约 27.4K token，",
        );
        assert.include(report.markdown, "- 测试通过率：未测量");
        assert.include(report.markdown, "涉及的智能体和文件组合 ");
        assert.include(report.markdown, "该文件在一个智能体里重复读 ");

        const { decisions } = yield* board.listDecisions(alice, { workspaceId });
        assert.strictEqual(decisions.length, 1);
        const [decision] = decisions;
        assert.strictEqual(decision?.id, report.decisionId);
        assert.strictEqual(decision?.status, "proposed");
        assert.strictEqual(decision?.authorId, TokenSaverService.AGENT_ID);
        assert.strictEqual(decision?.decidedBy, undefined);
        assert.deepStrictEqual(
          decision?.options?.map(({ label }) => label),
          ["执行", "先试一周", "忽略"],
        );
        assert.include(decision?.text, report.markdown);

        let readHome = false;
        const again = yield* run({
          get CLAUDE_CONFIG_DIR() {
            readHome = true;
            return home;
          },
        });
        assert.isFalse(readHome);
        assert.strictEqual(again.decisionId, report.decisionId);
        assert.deepStrictEqual(again, report);
        assert.notInclude(again.markdown, "```json");
        assert.strictEqual(
          (yield* board.listDecisions(alice, { workspaceId })).decisions.length,
          1,
        );
      }),
    ),
  );

  it.effect("writes nothing for an empty week or for a binding on another environment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspaces = yield* WorkspaceService.WorkspaceService;
        const board = yield* TaskBoardService.TaskBoardService;
        const tokenSaver = yield* TokenSaverService.TokenSaverService;
        const home = yield* writeTranscripts();
        const run = (bindTo: EnvironmentId, since: string, until: string) =>
          Effect.gen(function* () {
            const { id: workspaceId } = yield* workspaces.create(alice.caller, {
              kind: "personal",
              name: "Mine",
              displayName: "Alice",
            });
            yield* workspaces.bind(alice.caller, {
              workspaceId,
              environmentId: bindTo,
              projectId: ProjectId.make("bound"),
            });
            const report = yield* tokenSaver
              .runWeekly(alice, { workspaceId, since, until })
              .pipe(withHome(home));
            const { decisions } = yield* board.listDecisions(alice, { workspaceId });
            return [report.findings.length, report.decisionId, decisions.length];
          });

        const emptyWeek = yield* run(
          environmentId,
          "2026-10-01T00:00:00.000Z",
          "2026-10-08T00:00:00.000Z",
        );
        const elsewhere = yield* run(
          EnvironmentId.make("env-2"),
          "2026-11-01T00:00:00.000Z",
          "2026-11-08T00:00:00.000Z",
        );
        assert.deepStrictEqual(
          [emptyWeek, elsewhere],
          [
            [0, undefined, 0],
            [0, undefined, 0],
          ],
        );
      }),
    ),
  );

  it.effect("hands back a proposal from before the data block as its stored text", () =>
    Effect.gen(function* () {
      const workspaces = yield* WorkspaceService.WorkspaceService;
      const board = yield* TaskBoardService.TaskBoardService;
      const tokenSaver = yield* TokenSaverService.TokenSaverService;
      const { id: workspaceId } = yield* workspaces.create(alice.caller, {
        kind: "personal",
        name: "Mine",
        displayName: "Alice",
      });
      const text = "# old report\n\n```json\n[]\n```";
      const { id } = yield* board.createDecision(
        { ...alice, authorId: TokenSaverService.AGENT_ID },
        { workspaceId, title: "Old report", text, status: "proposed" },
      );
      const again = yield* tokenSaver.runWeekly(alice, { workspaceId });
      assert.deepStrictEqual([again.decisionId, again.markdown, again.findings], [id, text, []]);
    }),
  );

  it.effect("refuses a run by someone who is not a member", () =>
    Effect.gen(function* () {
      const workspaces = yield* WorkspaceService.WorkspaceService;
      const tokenSaver = yield* TokenSaverService.TokenSaverService;
      const { id: workspaceId } = yield* workspaces.create(alice.caller, {
        kind: "personal",
        name: "Mine",
        displayName: "Alice",
      });
      const error = yield* Effect.flip(tokenSaver.runWeekly(bob, { workspaceId }));
      assert.strictEqual(error._tag === "TelescopeWorkspaceError" && error.reason, "forbidden");
    }),
  );
});

it.effect("the weekly pass reports each due workspace once a week, as the owner", () =>
  Effect.gen(function* () {
    const workspaces = yield* WorkspaceService.WorkspaceService;
    const board = yield* TaskBoardService.TaskBoardService;
    const sql = yield* SqlClient.SqlClient;
    const home = yield* writeTranscripts();
    const now = Date.parse("2026-11-08T00:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    const workspace = Effect.fn("workspace")(function* () {
      const { id: workspaceId } = yield* workspaces.create(alice.caller, {
        kind: "personal",
        name: "Mine",
        displayName: "Alice",
      });
      yield* workspaces.bind(alice.caller, {
        workspaceId,
        environmentId,
        projectId: ProjectId.make("bound"),
      });
      return workspaceId;
    });
    const report = (workspaceId: Telescope.WorkspaceId) =>
      board.createDecision(
        { ...alice, authorId: TokenSaverService.AGENT_ID },
        { workspaceId, title: "Earlier report", text: "", status: "decided" },
      );
    const counts = (ids: ReadonlyArray<Telescope.WorkspaceId>) =>
      Effect.forEach(ids, (workspaceId) =>
        board
          .listDecisions(alice, { workspaceId })
          .pipe(
            Effect.map(
              ({ decisions }) =>
                decisions.filter(({ authorId }) => authorId === TokenSaverService.AGENT_ID).length,
            ),
          ),
      );

    yield* TestClock.setTime(now - 8 * day);
    const [recent, old, never, broken, crashing] = [
      yield* workspace(),
      yield* workspace(),
      yield* workspace(),
      yield* workspace(),
      yield* workspace(),
    ];
    yield* report(old);
    yield* report(broken);
    yield* sql`UPDATE telescope_tasks SET status = 'corrupt' WHERE workspace_id = ${broken}`;
    yield* TestClock.setTime(now - 3 * day);
    yield* report(recent);
    const real = yield* TokenSaverService.TokenSaverService;
    const pass = (yield* TokenSaverService.makeWeeklyPass.pipe(
      Effect.provideService(
        TokenSaverService.TokenSaverService,
        TokenSaverService.TokenSaverService.of({
          runWeekly: (actor, input) =>
            input.workspaceId === crashing
              ? Effect.die(new Error("collector bug"))
              : real.runWeekly(actor, input),
        }),
      ),
    )).pipe(withHome(home));

    yield* TestClock.setTime(now);
    yield* pass;
    assert.deepStrictEqual(yield* counts([recent, old, never, crashing]), [1, 2, 1, 0]);
    const [proposal] = (yield* board.listDecisions(alice, { workspaceId: never })).decisions;
    assert.strictEqual(proposal?.status, "proposed");

    const later = yield* workspace();
    yield* TestClock.adjust("30 minutes");
    yield* pass;
    assert.deepStrictEqual(yield* counts([later]), [0]);
    yield* TestClock.adjust("31 minutes");
    yield* pass;
    assert.deepStrictEqual(yield* counts([recent, old, never, later]), [1, 2, 1, 1]);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it("lists cost savings before token savings, each by estimated saving", () => {
  const finding = (
    pattern: Telescope.TokenSaverPattern,
    estimatedSavingTokens: number,
    savingKind: Telescope.TokenSaverFinding["savingKind"],
  ): Telescope.TokenSaverFinding => ({
    pattern,
    evidence: {},
    suggestion: "",
    estimatedSavingTokens,
    savingKind,
    confidence: "high",
  });
  assert.deepStrictEqual(
    [
      finding("repeated_reads", 2000, "tokens"),
      finding("broken_cache_prefix", 1500, "cost"),
      finding("oversized_tool_outputs", 21000, "tokens"),
    ]
      .toSorted(TokenSaverService.rankFindings)
      .map(({ pattern }) => pattern),
    ["broken_cache_prefix", "oversized_tool_outputs", "repeated_reads"],
  );
});
