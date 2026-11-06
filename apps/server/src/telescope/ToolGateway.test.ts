import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, ProjectId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AgentService from "./AgentService.ts";
import * as GrantService from "./GrantService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as ToolGateway from "./ToolGateway.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const layer = Layer.mergeAll(
  ToolGateway.layer,
  GrantService.layer,
  RunRecordService.layer,
  AgentService.layer,
  WorkspaceService.layer,
  TelescopeDb.layer,
).pipe(
  Layer.provideMerge(
    Layer.merge(
      Layer.effectDiscard(runMigrations()).pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
      NodeCrypto.layer,
    ),
  ),
);

const session = (name: string): WorkspaceService.Caller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const as = { ann: session("ann"), bea: session("bea") };
const web = ProjectId.make("project-web");
const ALL: Telescope.StandingPowers = {
  openTickets: true,
  dispatchWorkers: true,
  answerMembers: true,
  mergePRs: true,
};

/** Admin `ann`, member `bea`, and a run of bea's `web` Chief Agent on its own thread. */
const setup = Effect.gen(function* () {
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const { id: workspaceId } = yield* workspaces.create(as.ann, {
    kind: "enterprise",
    name: "Acme",
    displayName: "Ann",
  });
  const { code } = yield* workspaces.invite(as.ann, { workspaceId, role: "member" });
  const bea = yield* workspaces.accept(as.bea, { code, displayName: "Bea" });
  yield* workspaces.bind(as.ann, {
    workspaceId,
    environmentId: EnvironmentId.make("env-local"),
    projectId: web,
  });
  const agents = yield* AgentService.AgentService;
  const { agents: mine } = yield* agents.listMine(as.bea, { workspaceId });
  const chief = mine.find((agent) => agent.kind === "chief_agent" && agent.projectId === web);
  assert.isDefined(chief);
  const db = yield* TelescopeDb.TelescopeDb;
  // Stored directly so only the member's role can take merging away.
  yield* db.update(
    workspaceId,
    "agents",
    { standing_powers_json: JSON.stringify(ALL) },
    { agent_id: chief.id },
  );
  const threadId = ThreadId.make(`thread-${workspaceId}`);
  const runs = yield* RunRecordService.RunRecordService;
  const run = yield* runs.start(as.bea, workspaceId, {
    agentId: chief.id,
    threadId,
    inputSnapshot: {
      promptVersion: "prompt@1",
      skillsVersions: {},
      powersVersion: "powers@1",
      model: "model-a",
      contextManifest: [],
    },
  });
  const gateway = yield* ToolGateway.ToolGateway;
  const grants = yield* GrantService.GrantService;
  let used = 0;
  // Each call a second apart, so the audit list (newest first) reads in call order.
  const call = (tool: string, args: Schema.Json = {}) =>
    TestClock.adjust("1 second").pipe(
      Effect.andThen(
        gateway.call(threadId, tool, args, (caller) => Effect.sync(() => ((used += 1), caller))),
      ),
    );
  const denial = (tool: string) =>
    call(tool).pipe(
      Effect.flip,
      Effect.map((error) =>
        error._tag === "TelescopeToolGatewayDenied"
          ? `${error.reason}${error.level === undefined ? "" : `:${error.level}`}`
          : error._tag,
      ),
    );
  const audit = grants
    .auditList(as.ann, { workspaceId })
    .pipe(Effect.map(({ entries }) => entries.toReversed()));
  const calls = runs
    .calls(as.ann, { workspaceId, runId: run.id })
    .pipe(Effect.map((result) => result.calls.map((c) => `${c.tool}:${c.grantCheck}`)));
  return {
    workspaceId,
    beaId: bea.subjectId,
    chiefId: chief.id,
    runId: run.id,
    workspaces,
    gateway,
    call,
    denial,
    audit,
    calls,
    usedCount: () => used,
  };
});

it.layer(layer)("Telescope tool gateway", (it) => {
  it.effect("refuses a member's Chief Agent merging a PR and audits both outcomes", () =>
    Effect.gen(function* () {
      const { workspaceId, beaId, chiefId, runId, call, denial, audit, calls, usedCount } =
        yield* setup;

      const caller = yield* call("open_ticket", { title: "Fix", apiKey: "sk-1", nested: [{}] });
      assert.deepStrictEqual(caller, {
        workspaceId,
        runId,
        agentId: chiefId,
        memberId: beaId,
        projectId: web,
      });
      assert.strictEqual(yield* denial("merge_pr"), "forbidden");
      assert.strictEqual(usedCount(), 1, "a refused tool never runs");

      const entries = yield* audit;
      assert.deepStrictEqual(
        entries.map((entry) => [entry.tool, entry.power, entry.outcome, entry.runId]),
        [
          ["open_ticket", "openTickets", "allowed", runId],
          ["merge_pr", "mergePRs", "denied", runId],
        ],
      );
      assert.deepStrictEqual(entries[0]?.argsRedacted, {
        title: "Fix",
        apiKey: "[redacted]",
        nested: [{}],
      });
      assert.deepStrictEqual(entries[1]?.onBehalfOf, [beaId]);
      assert.strictEqual(entries[1]?.projectId, web);
      assert.deepStrictEqual(yield* calls, ["open_ticket:allowed", "merge_pr:denied"]);

      assert.strictEqual(yield* denial(" "), "unknown_tool");
      assert.strictEqual(yield* denial("memory_write"), "unknown_tool");
      assert.lengthOf(yield* audit, 2, "unknown tools never reach the audit");
      const gateway = yield* ToolGateway.ToolGateway;
      const noRun = yield* gateway
        .call(ThreadId.make("thread-without-run"), "open_ticket", {}, () => Effect.void)
        .pipe(Effect.flip);
      assert.strictEqual(noRun._tag === "TelescopeToolGatewayDenied" && noRun.reason, "no_run");
    }),
  );

  it.effect("fails the next call after the member is revoked mid-run", () =>
    Effect.gen(function* () {
      const { workspaceId, beaId, workspaces, call, denial, audit } = yield* setup;
      yield* call("open_ticket");
      yield* workspaces.revoke(as.ann, { workspaceId, subjectId: beaId });
      assert.strictEqual(yield* denial("open_ticket"), "forbidden");
      const outcomes = (yield* audit).map((entry) => entry.outcome);
      assert.deepStrictEqual(outcomes, ["allowed", "denied"]);
    }),
  );

  it.effect("stops an agent at its next tool call and resumes it", () =>
    Effect.gen(function* () {
      const { workspaceId, chiefId, gateway, call, denial, audit } = yield* setup;
      const stop = (state: Telescope.KillSwitch["state"]) => ({
        workspaceId,
        agentId: chiefId,
        state,
      });
      const refused = yield* gateway.setKillSwitch(as.bea, stop("paused")).pipe(Effect.flip);
      assert.strictEqual(refused._tag === "TelescopeWorkspaceError" && refused.reason, "forbidden");

      yield* call("open_ticket");
      const paused = yield* gateway.setKillSwitch(as.ann, stop("paused"));
      assert.strictEqual(paused.state, "paused");
      assert.strictEqual(yield* denial("open_ticket"), "stopped");
      yield* gateway.setKillSwitch(as.ann, stop("terminated"));
      assert.strictEqual(yield* denial("open_ticket"), "stopped");
      yield* gateway.setKillSwitch(as.ann, stop("running"));
      yield* call("open_ticket");
      const outcomes = (yield* audit).map((entry) => entry.outcome);
      assert.deepStrictEqual(outcomes, ["allowed", "denied", "denied", "allowed"]);
    }),
  );

  it.effect("fails a call once any budget level runs out, naming that level", () =>
    Effect.forEach(Telescope.BudgetScope.literals, (level) =>
      Effect.gen(function* () {
        const { workspaceId, beaId, chiefId, gateway, call, denial, audit } = yield* setup;
        const scopeId = { company: "ignored", project: web, agent: chiefId, person: beaId }[level];
        const budget = { workspaceId, scope: level, scopeId };
        yield* call("open_ticket");
        const set = yield* gateway.setBudget(as.ann, { ...budget, limitCalls: 2 });
        assert.deepStrictEqual(
          [set.scopeId, set.usedCalls, set.limitCalls],
          [level === "company" ? workspaceId : scopeId, 0, 2],
          "calls before the budget existed do not count",
        );
        yield* call("open_ticket");
        yield* call("answer_member");
        assert.strictEqual(yield* denial("open_ticket"), `budget:${level}`);
        const [denied] = (yield* audit).toReversed();
        assert.strictEqual(denied?.reason, `A Telescope budget is used up. Level: ${level}.`);

        const lifted = yield* gateway.setBudget(as.ann, budget);
        assert.deepStrictEqual([lifted.usedCalls, lifted.limitCalls], [2, undefined]);
        yield* call("open_ticket");
      }),
    ),
  );
});
