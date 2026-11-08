// @effect-diagnostics nodeBuiltinImport:off
import * as NodeSqlite from "node:sqlite";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, ProjectId, Telescope, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AgentService from "./AgentService.ts";
import * as GrantService from "./GrantService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as ToolGateway from "./ToolGateway.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const servicesOn = <E>(database: Layer.Layer<SqlClient.SqlClient, E>) =>
  Layer.mergeAll(
    ToolGateway.layer,
    GrantService.layer,
    RunRecordService.layer,
    AgentService.layer,
    WorkspaceService.layer,
    TelescopeDb.layer,
  ).pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.effectDiscard(runMigrations()).pipe(Layer.provideMerge(database)),
        NodeCrypto.layer,
      ),
    ),
    Layer.provide(
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("env-elsewhere")),
      }),
    ),
  );
const layer = servicesOn(SqlitePersistence.layerMemory);

const session = (name: string): WorkspaceService.SessionCaller => ({
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
    threadId,
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
  it.effect("refuses a member's Chief Agent merging a PR and audits each outcome", () =>
    Effect.gen(function* () {
      const {
        workspaceId,
        threadId,
        beaId,
        chiefId,
        runId,
        gateway,
        call,
        denial,
        audit,
        calls,
        usedCount,
      } = yield* setup;

      const fake = "0123456789abcdefghij";
      const prefixed = [
        "sk-",
        "sk_live_",
        "sk_test_",
        "rk_live_",
        "rk_test_",
        "ghp_",
        "github_pat_",
        "glpat-",
        "xoxb-",
        "AIza",
      ];
      // One per credential shape the gateway redacts, each inside other text.
      const shapes = {
        Bearer: `Bearer ${fake}`,
        Basic: `Basic ${fake}`,
        BasicMixedCase: "Basic dXNlcjpwYXNz",
        JWT: `eyJ${fake}.${fake}.${fake}`,
        PEM: `-----BEGIN RSA PRIVATE KEY-----\n${fake}\n-----END RSA PRIVATE KEY-----`,
        ...Object.fromEntries(prefixed.map((prefix) => [prefix, `${prefix}${fake}`])),
        AKIA: `AKIA${fake.toUpperCase().slice(0, 16)}`,
      };
      const hex = "9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b";
      // A row without `stored` is kept verbatim; the credentials kept at the end are known misses.
      const probes: ReadonlyArray<readonly [input: string, stored?: string]> = [
        ["Basic authentication for the settings page"],
        ["Basic Authentication settings"],
        ["Basic Authentication for the settings page"],
        ["Fix: Basic validation rejects empty briefs."],
        ["Bearer authentication."],
        [
          "Merged d7be12ba6dada3160991f0198a735147d0323552 for 123e4567-e89b-12d3-a456-426614174000",
        ],
        ["the Authorization: header is required", "the Authorization: [redacted] required"],
        ["scopes: authorization:read", "scopes: authorization:[redacted]"],
        ["feature/sk-1234-improve-login-flow", "feature/[redacted]"],
        [
          "curl -H 'Authorization: Bearer supersecrettoken' https://api.example.com",
          "curl -H 'Authorization: [redacted]' https://api.example.com",
        ],
        ["Authorization: Bearer correct-horse-battery-staple", "Authorization: [redacted]"],
        ["Authorization: Bearer Changemeplease", "Authorization: [redacted]"],
        ["authorization: basic Changemeplease", "authorization: [redacted]"],
        ["AUTHORIZATION: supersecrettoken", "AUTHORIZATION: [redacted]"],
        ["Authorization:   supersecrettoken", "Authorization:   [redacted]"],
        ["Authorization : supersecrettoken", "Authorization : [redacted]"],
        ["Authorization:\tsupersecrettoken", "Authorization:\t[redacted]"],
        ["'Authorization': 'supersecrettoken'", "'Authorization': '[redacted]'"],
        [`{"Authorization": "Bearer supersecrettoken"}`, `{"Authorization": "[redacted]"}`],
        [`{Authorization: "supersecrettoken"}`, `{Authorization: "[redacted]"}`],
        ["Authorization: token ghp_0123456789abcdefghij", "Authorization: [redacted]"],
        [
          `curl -H 'Authorization: Token ${hex}' https://api.example.com/`,
          "curl -H 'Authorization: [redacted]' https://api.example.com/",
        ],
        [`Authorization: Bot ${fake}.Cl2FMQ.${fake}`, "Authorization: [redacted]"],
        ["Authorization: SSWS 00QCjAl4MlV-WPXM-0123456789abcdefghij", "Authorization: [redacted]"],
        ["Authorization: Key supersecrettoken", "Authorization: [redacted]"],
        ["Authorization: ApiKey supersecrettoken", "Authorization: [redacted]"],
        ["Authorization: `supersecrettoken123`", "Authorization: `[redacted]`"],
        ["Authorization: Bearer\n  abc123def456ghi789", "Authorization: [redacted]"],
        [
          "Proxy-Authorization: Negotiate YIIGhgYGKwYBBQUCoIIGejCCBnag",
          "Proxy-Authorization: [redacted]",
        ],
        [
          "curl -H 'Proxy-Authorization: Basic Changemeplease' https://proxy.example.com",
          "curl -H 'Proxy-Authorization: [redacted]' https://proxy.example.com",
        ],
        [`X-API-Key: ${hex}`, "X-API-Key: [redacted]"],
        [`Cookie: sessionid=${hex}`, "Cookie: [redacted]"],
        [
          `GET /v1/items HTTP/1.1\nX-Api-Key: ${hex}\nAuthorization: 5f0c2b7e81d94a36b2e7c4d1a9f08e63`,
          "GET /v1/items HTTP/1.1\nX-Api-Key: [redacted]\nAuthorization: [redacted]",
        ],
        [
          `http GET api.example.com x-api-key:${hex} Authorization:'Bearer supersecrettoken'`,
          "http GET api.example.com x-api-key:[redacted] Authorization:'[redacted]'",
        ],
        [
          `headers:\n  x-api-key: ${hex}\n  authorization: supersecrettoken`,
          "headers:\n  x-api-key: [redacted]\n  authorization: [redacted]",
        ],
        [
          "Authorization: Token\nProxy-Authorization: Basic Changemeplease",
          "Authorization: [redacted]\nProxy-Authorization: [redacted]",
        ],
        [
          `Authorization: supersecrettoken\nX-Api-Key: ${hex}`,
          "Authorization: [redacted]\nX-Api-Key: [redacted]",
        ],
        [
          `Authorization: supersecrettoken\nCookie: sessionid=${hex}`,
          "Authorization: [redacted]\nCookie: [redacted]",
        ],
        [
          "X-Api-Key: none\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0123456789abcdef\n-----END RSA PRIVATE KEY-----",
          "X-Api-Key: [redacted]\n[redacted]",
        ],
        [
          "X-Api-Key: -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0123456789abcdef\n-----END RSA PRIVATE KEY-----",
          "X-Api-Key: [redacted]",
        ],
        ["Cookie: none\nBearer abc123def456ghi789", "Cookie: [redacted]\n[redacted]"],
        [
          `Authorization: Bearer\nX-Api-Key: ${hex}`,
          "Authorization: [redacted]\nX-Api-Key: [redacted]",
        ],
        [`Cookie: theme=dark; sessionid=${hex}`, `Cookie: [redacted] sessionid=${hex}`],
        [`headers['Authorization'] = 'Token ${hex}'`],
        [`req.Header.Set("Authorization", "Bearer supersecrettoken")`],
        [`dict(Authorization="Bearer supersecrettoken")`],
        [`'Authorization' => 'Bearer supersecrettoken'`],
        [`HTTP_AUTHORIZATION: Token ${hex}`],
        [`{\\"Authorization\\": \\"supersecrettoken123\\"}`],
        [`{ name: "Authorization", value: "supersecrettoken" }`],
        [
          "-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF0abc123\n-----END PGP PRIVATE KEY BLOCK-----",
        ],
        ["https://alice:hunter2hunter2@git.example.com/acme/web.git"],
        ["postgres://admin:pw@db/app"],
        ["DB_PASSWORD=hunter2hunter2"],
        ["AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"],
        ["c2stMDEyMzQ1Njc4OWFiY2RlZmdoaWo="],
      ];
      const inText = (text: (shape: string) => string) =>
        Object.fromEntries(Object.entries(shapes).map(([name, shape]) => [name, text(shape)]));
      const caller = yield* call("open_ticket", {
        title: "Fix",
        apiKey: "sk-1",
        nested: [
          { brief: "curl -H 'Authorization: Bearer abc.def-123456' sk-proj-0123456789abcdef" },
        ],
        shapes: inText((shape) => `use ${shape} now`),
        probes: probes.map(([input]) => input),
      });
      assert.deepStrictEqual(caller, {
        workspaceId,
        runId,
        agentId: chiefId,
        memberId: beaId,
        onBehalfOf: [beaId],
        projectId: web,
      });
      assert.strictEqual(yield* denial("merge_pr"), "forbidden");
      assert.strictEqual(usedCount(), 1, "a refused tool never runs");
      yield* TestClock.adjust("1 second");
      // A real clock times a call in fractions of a millisecond.
      const slowFail = TestClock.adjust("1500 micros").pipe(Effect.andThen(Effect.fail("boom")));
      const failed = yield* gateway
        .call(threadId, "ticket_get", {}, () => slowFail)
        .pipe(Effect.flip);
      assert.strictEqual(failed, "boom");

      const entries = yield* audit;
      assert.deepStrictEqual(
        entries.map((entry) => [entry.tool, entry.power, entry.outcome, entry.runId, entry.reason]),
        [
          ["open_ticket", "openTickets", "allowed", runId, undefined],
          ["merge_pr", "mergePRs", "denied", runId, "forbidden"],
          ["ticket_get", "openTickets", "failed", runId, undefined],
        ],
      );
      assert.deepStrictEqual(entries[0]?.argsRedacted, {
        title: "Fix",
        apiKey: "[redacted]",
        nested: [{ brief: "curl -H 'Authorization: [redacted]' [redacted]" }],
        shapes: inText(() => "use [redacted] now"),
        probes: probes.map(([input, stored = input]) => stored),
      });
      assert.deepStrictEqual(entries[1]?.onBehalfOf, [beaId]);
      assert.strictEqual(entries[1]?.projectId, web);
      assert.deepStrictEqual(yield* calls, [
        "open_ticket:allowed",
        "merge_pr:denied",
        "ticket_get:allowed",
      ]);

      assert.strictEqual(yield* denial(" "), "unknown_tool");
      assert.strictEqual(yield* denial("memory_pin"), "unknown_tool");
      assert.lengthOf(yield* audit, 3, "unknown tools never reach the audit");
      const noRun = yield* gateway
        .call(ThreadId.make("thread-without-run"), "open_ticket", {}, () => Effect.void)
        .pipe(Effect.flip);
      assert.strictEqual(noRun._tag === "TelescopeToolGatewayDenied" && noRun.reason, "no_run");
    }),
  );

  it.effect("callIfRun runs ungated on a thread without a run", () =>
    Effect.gen(function* () {
      const { threadId, gateway, audit, calls } = yield* setup;
      const plain = ThreadId.make("thread-without-run");
      assert.deepStrictEqual(
        yield* gateway.callIfRun(plain, "dispatch_worker", {}, Effect.succeed("ran")),
        Exit.succeed("ran"),
      );
      assert.deepStrictEqual(
        yield* gateway.callIfRun(plain, "dispatch_worker", {}, Effect.fail("own")),
        Exit.fail("own"),
      );
      assert.lengthOf(yield* audit, 0);
      assert.deepStrictEqual(
        yield* gateway.callIfRun(threadId, "dispatch_worker", {}, Effect.succeed("gated")),
        Exit.succeed("gated"),
      );
      yield* TestClock.adjust("1 second");
      assert.deepStrictEqual(
        yield* gateway.callIfRun(threadId, "dispatch_worker", {}, Effect.fail("own")),
        Exit.fail("own"),
        "the tool's own failure comes back as its exit, apart from the gateway's refusals",
      );
      assert.deepStrictEqual(
        (yield* audit).map((entry) => entry.outcome),
        ["allowed", "failed"],
      );
      assert.deepStrictEqual(yield* calls, ["dispatch_worker:allowed", "dispatch_worker:allowed"]);
    }),
  );

  it.effect("refuses the PA's dispatch_worker and a Chief's delegate, both audited", () =>
    Effect.gen(function* () {
      const { workspaceId, beaId, chiefId, gateway, denial, audit } = yield* setup;
      const { agents: mine } = yield* (yield* AgentService.AgentService).listMine(as.bea, {
        workspaceId,
      });
      const pa = mine.find((agent) => agent.kind === "chief_of_staff");
      assert.isDefined(pa);
      const db = yield* TelescopeDb.TelescopeDb;
      yield* db.update(
        workspaceId,
        "agents",
        { standing_powers_json: JSON.stringify(ALL) },
        { agent_id: pa.id },
      );
      const paThread = ThreadId.make(`thread-pa-${workspaceId}`);
      yield* (yield* RunRecordService.RunRecordService).start(as.bea, workspaceId, {
        agentId: pa.id,
        threadId: paThread,
        inputSnapshot: {
          promptVersion: "prompt@1",
          skillsVersions: {},
          powersVersion: "powers@1",
          model: "model-a",
          contextManifest: [],
        },
      });
      const { powers } = yield* (yield* GrantService.GrantService).effectiveGrant(workspaceId, {
        agentId: pa.id,
        onBehalfOf: [beaId],
      });
      assert.isTrue(powers.dispatchWorkers, "the PA holds the power to pass it down");
      let ran = false;
      const denied = yield* gateway
        .callIfRun(
          paThread,
          "dispatch_worker",
          {},
          Effect.sync(() => (ran = true)),
        )
        .pipe(Effect.flip);
      assert.strictEqual(
        denied._tag === "TelescopeToolGatewayDenied" && denied.reason,
        "project_only",
      );
      assert.isFalse(ran);
      const [entry] = (yield* audit).toReversed();
      assert.deepStrictEqual(
        [entry?.agentId, entry?.tool, entry?.outcome, entry?.reason],
        [pa.id, "dispatch_worker", "denied", "project_only"],
      );
      yield* gateway.call(paThread, "open_ticket", {}, () => Effect.void);
      yield* gateway.call(paThread, "delegate", {}, () => Effect.void);

      assert.strictEqual(yield* denial("delegate"), "no_project");
      const [chiefEntry] = (yield* audit).toReversed();
      assert.deepStrictEqual(
        [chiefEntry?.agentId, chiefEntry?.tool, chiefEntry?.outcome, chiefEntry?.reason],
        [chiefId, "delegate", "denied", "no_project"],
      );
    }),
  );

  it.effect("fails the next call after a grant is revoked mid-run", () =>
    Effect.gen(function* () {
      const { workspaceId, beaId, workspaces, call, denial, audit } = yield* setup;
      const grants = yield* GrantService.GrantService;
      const rule = (powers: Telescope.StandingPowers) =>
        grants.setProjectRule(as.ann, { workspaceId, projectId: web, powers, routing: null });
      yield* call("open_ticket");
      yield* rule({ ...ALL, openTickets: false });
      assert.strictEqual(yield* denial("open_ticket"), "forbidden");
      const none = { openTickets: false, dispatchWorkers: false, answerMembers: false };
      yield* rule({ ...none, mergePRs: false });
      yield* call("memory_search");
      yield* rule(ALL);
      yield* call("open_ticket");
      yield* workspaces.revoke(as.ann, { workspaceId, subjectId: beaId });
      assert.strictEqual(yield* denial("open_ticket"), "forbidden");
      assert.strictEqual(yield* denial("memory_search"), "forbidden");
      const outcomes = (yield* audit).map((entry) => [entry.tool, entry.power, entry.outcome]);
      assert.deepStrictEqual(outcomes, [
        ["open_ticket", "openTickets", "allowed"],
        ["open_ticket", "openTickets", "denied"],
        ["memory_search", undefined, "allowed"],
        ["open_ticket", "openTickets", "allowed"],
        ["open_ticket", "openTickets", "denied"],
        ["memory_search", undefined, "denied"],
      ]);
    }),
  );

  it.effect("stops an agent at its next tool call and resumes it", () =>
    Effect.gen(function* () {
      const { workspaceId, beaId, chiefId, runId, gateway, call, denial, audit } = yield* setup;
      const agentService = yield* AgentService.AgentService;
      const { agents: mine } = yield* agentService.listMine(as.bea, { workspaceId });
      const cos = mine.find((agent) => agent.kind === "chief_of_staff");
      assert.isDefined(cos);
      const viaThread = ThreadId.make(`thread-via-${workspaceId}`);
      yield* (yield* RunRecordService.RunRecordService).start(as.bea, workspaceId, {
        agentId: cos.id,
        threadId: viaThread,
        via: [chiefId],
        inputSnapshot: {
          promptVersion: "prompt@1",
          skillsVersions: {},
          powersVersion: "powers@1",
          model: "model-a",
          contextManifest: [],
        },
      });
      const viaCall = TestClock.adjust("1 second").pipe(
        Effect.andThen(gateway.call(viaThread, "answer_member", {}, () => Effect.void)),
      );
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
      const viaDenied = yield* viaCall.pipe(Effect.flip);
      assert.strictEqual(
        viaDenied._tag === "TelescopeToolGatewayDenied" && viaDenied.reason,
        "stopped",
      );
      const { killSwitches, agents } = yield* gateway.governance(as.ann, { workspaceId });
      assert.deepStrictEqual(
        killSwitches.map((row) => [row.agentId, row.state]),
        [[chiefId, "terminated"]],
      );
      const notFound = yield* agentService
        .get(as.ann, { workspaceId, agentId: chiefId })
        .pipe(Effect.flip);
      assert.strictEqual(
        notFound._tag === "TelescopeWorkspaceError" && notFound.reason,
        "not_found",
      );
      assert.deepInclude(
        agents ?? [],
        {
          id: chiefId,
          name: "project-web Chief Agent",
          kind: "chief_agent",
          ownerSubjectId: beaId,
        },
        "the admin's stop list holds a member's private agent",
      );
      const hidden = yield* gateway.governance(as.bea, { workspaceId }).pipe(Effect.flip);
      assert.strictEqual(hidden._tag === "TelescopeWorkspaceError" && hidden.reason, "forbidden");
      const ownerRun = { runId, workspaceId, memberId: WorkspaceService.OWNER_MEMBER_ID };
      const asRun = yield* Effect.all([
        Effect.flip(gateway.setKillSwitch(ownerRun, stop("running"))),
        Effect.flip(gateway.governance(ownerRun, { workspaceId })),
      ]);
      assert.deepStrictEqual(
        asRun.map((error) => error._tag === "TelescopeWorkspaceError" && error.reason),
        ["forbidden", "forbidden"],
      );
      assert.deepStrictEqual(
        (yield* gateway.governance(as.ann, { workspaceId })).killSwitches,
        killSwitches,
      );
      yield* gateway.setKillSwitch(as.ann, stop("running"));
      yield* call("open_ticket");
      yield* viaCall;
      const outcomes = (yield* audit).map((entry) => entry.outcome);
      assert.deepStrictEqual(outcomes, [
        "allowed",
        "denied",
        "denied",
        "denied",
        "allowed",
        "allowed",
      ]);
    }),
  );

  it.effect("fails a call once any budget level runs out or is paused, naming that level", () =>
    Effect.forEach(Telescope.BudgetScope.literals, (level) =>
      Effect.gen(function* () {
        const { workspaceId, beaId, chiefId, gateway, call, denial, audit } = yield* setup;
        const scopeId = { company: "ignored", project: web, agent: chiefId, person: beaId }[level];
        const budget = { workspaceId, scope: level, scopeId };
        const otherKind = { company: undefined, project: chiefId, agent: beaId, person: web }[
          level
        ];
        if (otherKind !== undefined) {
          const wrong = yield* gateway
            .setBudget(as.ann, { ...budget, scopeId: otherKind, limitCalls: 2 })
            .pipe(Effect.flip);
          assert.strictEqual(wrong._tag === "TelescopeWorkspaceError" && wrong.reason, "not_found");
        }
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
        assert.strictEqual(yield* denial("memory_search"), `budget:${level}`);
        const [denied] = (yield* audit).toReversed();
        assert.strictEqual(denied?.tool, "memory_search");
        assert.strictEqual(denied?.reason, "budget");

        const lifted = yield* gateway.setBudget(as.ann, { ...budget, limitCalls: null });
        assert.deepStrictEqual([lifted.usedCalls, lifted.limitCalls], [2, undefined]);
        const stored = gateway
          .governance(as.ann, { workspaceId })
          .pipe(Effect.map(({ budgets }) => budgets));
        assert.deepStrictEqual(yield* stored, [lifted]);
        yield* call("open_ticket");

        yield* gateway.setBudget(as.ann, { ...budget, limitCalls: 9 });
        const paused = yield* gateway.setBudget(as.ann, { ...budget, paused: true });
        assert.deepStrictEqual(
          [paused.paused, paused.limitCalls],
          [true, 9],
          "a pause keeps the limit",
        );
        const kept = yield* gateway.setBudget(as.ann, { ...budget, limitCalls: 8 });
        assert.deepStrictEqual(
          [kept.paused, kept.limitCalls],
          [true, 8],
          "a limit keeps the pause",
        );
        assert.deepStrictEqual(
          yield* gateway.setBudget(as.ann, budget),
          kept,
          "a request naming no field keeps the budget",
        );
        assert.strictEqual(yield* denial("memory_search"), `budget_paused:${level}`);
        const resumed = yield* gateway.setBudget(as.ann, { ...budget, paused: false });
        assert.deepStrictEqual(
          [resumed.paused, resumed.usedCalls, resumed.limitCalls],
          [false, 3, 8],
        );
        assert.deepStrictEqual(yield* stored, [resumed]);
        yield* call("open_ticket");
      }),
    ),
  );
});

// Its own database file, so another connection can write between the gateway's steps.
const onFile = <E>(
  test: (other: NodeSqlite.DatabaseSync) => Effect.Effect<void, E, Layer.Success<typeof layer>>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filename = path.join(yield* fs.makeTempDirectoryScoped(), "state.sqlite");
    yield* Effect.suspend(() => {
      const other = new NodeSqlite.DatabaseSync(filename);
      return test(other).pipe(Effect.ensuring(Effect.sync(() => other.close())));
    }).pipe(Effect.provide(servicesOn(NodeSqliteClient.layer({ filename }))));
  }).pipe(Effect.provide(NodeServices.layer));

/** As the gateway finishes the span named `step`, the other connection tries to end the run. */
const endRunAfter = (other: NodeSqlite.DatabaseSync, runId: string, step: string) => {
  const end = other.prepare("UPDATE telescope_runs SET finished_at = ? WHERE run_id = ?");
  const attempt: { result?: string } = {};
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      if (options.name !== step || attempt.result !== undefined) return span;
      const close = span.end.bind(span);
      span.end = (endTime, exit) => {
        close(endTime, exit);
        try {
          end.run("2026-11-07T00:00:00.000Z", runId);
          attempt.result = "ended";
        } catch (error) {
          attempt.result = error instanceof Error ? error.message : String(error);
        }
      };
      return span;
    },
  });
  return { tracer, attempt };
};

it.effect.each([
  { after: "TelescopeDb.latestRunForThread", end: "ended", outcome: "no_run", audited: [] },
  {
    after: "GrantService.compute",
    end: "database is locked",
    outcome: "ran",
    audited: ["allowed"],
  },
])(
  "allows and audits a call only on a run that stays open: ended after $after",
  ({ after, ...expected }) =>
    onFile((other) =>
      Effect.gen(function* () {
        const { threadId, runId, gateway, audit } = yield* setup;
        const { tracer, attempt } = endRunAfter(other, runId, after);
        const outcome = yield* gateway
          .call(threadId, "open_ticket", {}, () => Effect.succeed("ran"))
          .pipe(
            Effect.withTracer(tracer),
            Effect.catchTags({
              TelescopeToolGatewayDenied: (error) => Effect.succeed(error.reason),
            }),
          );
        const audited: ReadonlyArray<string> = (yield* audit).map((entry) => entry.outcome);
        assert.deepStrictEqual({ end: attempt.result, outcome, audited }, expected);
      }),
    ),
);

it.effect("takes no write lock for a dispatch on a thread without a run", () =>
  onFile((other) =>
    Effect.gen(function* () {
      const { gateway } = yield* setup;
      other.exec("BEGIN IMMEDIATE");
      const plain = ThreadId.make("thread-without-run");
      const exit = yield* gateway.callIfRun(plain, "dispatch_worker", {}, Effect.succeed("ran"));
      other.exec("ROLLBACK");
      assert.deepStrictEqual(exit, Exit.succeed("ran"));
    }),
  ),
);
