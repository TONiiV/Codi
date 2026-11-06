import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, ProjectId, type Telescope } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

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

const writeTranscripts = Effect.fn("writeTranscripts")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fileSystem.makeTempDirectoryScoped();
  const dir = path.join(home, "projects", "-repo");
  yield* fileSystem.makeDirectory(dir, { recursive: true });
  const file = (sessionId: string, lines: ReadonlyArray<string>) =>
    fileSystem.writeFileString(path.join(dir, `${sessionId}.jsonl`), lines.join("\n") + "\n");
  const readA = (minute: number, id: string) => [
    transcript.toolUse("s1", minute, `m-${id}`, id, "Read", { file_path: "/repo/a.ts" }),
    transcript.toolResult("s1", minute, id, 4000),
  ];
  yield* file("s1", [
    transcript.prompt("s1", 0, "fix the build"),
    ...readA(1, "r1"),
    ...readA(2, "r2"),
    ...readA(3, "r3"),
    transcript.toolUse("s1", 4, "m-b", "b1", "Bash", { command: "vp test run" }),
    transcript.toolResult("s1", 5, "b1", 100_000),
    transcript.prompt("s1", 6, "the tests still fail"),
  ]);
  yield* file("s2", [
    transcript.toolUse("s2", 1, "m-x", "x1", "Bash", { command: "cat huge.log" }),
    transcript.toolResult("s2", 2, "x1", 400_000),
  ]);
  return home;
});

it.layer(layer)("Telescope token saver", (it) => {
  it.effect("ranks findings by saving and proposes the report as a decision", () =>
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

        const report = yield* tokenSaver
          .runWeekly(alice, {
            workspaceId,
            since: "2026-11-01T00:00:00.000Z",
            until: "2026-11-08T00:00:00.000Z",
          })
          .pipe(Effect.provideService(HostProcess.Environment, { CLAUDE_CONFIG_DIR: home }));

        assert.strictEqual(report.sessionsAnalyzed, 1);
        assert.deepStrictEqual(
          report.findings.map(({ pattern, estimatedSavingTokens, savingKind }) => [
            pattern,
            estimatedSavingTokens,
            savingKind,
          ]),
          [
            ["oversized_tool_outputs", 21000, "tokens"],
            ["repeated_reads", 2000, "tokens"],
          ],
        );
        assert.deepStrictEqual(report.quality, {
          testPassRate: null,
          followUpPrompts: 1,
          rollbacks: null,
        });
        assert.include(report.markdown, "## 1. 巨大的工具输出");
        assert.include(report.markdown, "- 测试通过率：未测量");

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
      }),
    ),
  );
});

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
