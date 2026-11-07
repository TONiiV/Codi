import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  Telescope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as AgentService from "./AgentService.ts";
import * as GrantService from "./GrantService.ts";
import * as RoutingService from "./RoutingService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claude");
const disabled = ProviderInstanceId.make("cursor");
const retired = ProviderInstanceId.make("retired");
const web = ProjectId.make("project-web");
const api = ProjectId.make("project-api");

const ruleOf = (
  id: string,
  taskType: string,
  harness: ProviderInstanceId,
  extra: {
    readonly projectId?: ProjectId;
    readonly priority?: number;
    readonly model?: string;
  } = {},
): Telescope.RoutingRule => ({
  id: Telescope.RoutingRuleId.make(id),
  workspaceId: Telescope.WorkspaceId.make("workspace"),
  ...(extra.projectId === undefined ? {} : { projectId: extra.projectId }),
  taskType,
  harness,
  model: extra.model ?? "small",
  priority: extra.priority ?? 0,
});
const rule = {
  webBugfix: ruleOf("web-bugfix", "bugfix", codex, { projectId: web }),
  webAny: ruleOf("web-any", "*", claude, { projectId: web }),
  bugfix: ruleOf("bugfix", "bugfix", claude),
  any: ruleOf("any", "*", codex),
  apiBugfix: ruleOf("api-bugfix", "bugfix", codex, { projectId: api }),
  urgent: ruleOf("urgent", "bugfix", codex, { priority: 5 }),
  urgentToo: ruleOf("urgent-too", "bugfix", claude, { priority: 5 }),
  big: ruleOf("big", "bugfix", claude, { model: "big" }),
  retired: ruleOf("retired", "bugfix", retired),
};
const context: RoutingService.RoutingContext = {
  projectId: web,
  taskType: "bugfix",
  agentDefault: { instanceId: claude, model: "sonnet" },
  allowlist: undefined,
  configured: new Set([codex, claude]),
};

/** The decision with its model first, then each skipped candidate; `agent` is the agent default. */
const summary = ({ source, ruleId, modelSelection, skipped }: Telescope.RoutingResolution) => [
  [
    ruleId === undefined ? source : `${source}:${ruleId}`,
    ...(modelSelection === undefined
      ? []
      : [`${modelSelection.instanceId}/${modelSelection.model}`]),
  ].join(" "),
  ...skipped.map((skip) => `${skip.ruleId ?? "agent"} ${skip.reason}`),
];

describe("resolveRoute", () => {
  it.each([
    {
      name: "takes the project's rule for the exact task type first",
      rules: [rule.any, rule.bugfix, rule.webAny, rule.webBugfix],
      expected: ["rule:web-bugfix codex/small"],
    },
    {
      name: "then the project's * rule",
      rules: [rule.any, rule.bugfix, rule.webAny],
      expected: ["rule:web-any claude/small"],
    },
    {
      name: "then a workspace rule for the exact task type",
      rules: [rule.any, rule.bugfix],
      expected: ["rule:bugfix claude/small"],
    },
    { name: "then a workspace * rule", rules: [rule.any], expected: ["rule:any codex/small"] },
    {
      name: "never matches another project's rule",
      rules: [rule.apiBugfix, rule.any],
      expected: ["rule:any codex/small"],
    },
    {
      name: "matches only workspace rules without a project",
      rules: [rule.webBugfix, rule.bugfix],
      patch: { projectId: undefined },
      expected: ["rule:bugfix claude/small"],
    },
    {
      name: "matches * for any task type and an exact type only for itself",
      rules: [rule.bugfix, rule.any],
      patch: { taskType: "feature" },
      expected: ["rule:any codex/small"],
    },
    {
      name: "prefers higher priority within a group",
      rules: [rule.bugfix, rule.urgent],
      expected: ["rule:urgent codex/small"],
    },
    {
      name: "never lets priority cross groups",
      rules: [rule.urgent, rule.webAny],
      expected: ["rule:web-any claude/small"],
    },
    {
      name: "keeps the earlier of two equal rules",
      rules: [rule.urgentToo, rule.urgent],
      expected: ["rule:urgent-too claude/small"],
    },
    {
      name: "keeps the earlier of two equal rules in either order",
      rules: [rule.urgent, rule.urgentToo],
      expected: ["rule:urgent codex/small"],
    },
    {
      name: "falls back to the agent's own model",
      rules: [rule.apiBugfix],
      expected: ["agent_default claude/sonnet"],
    },
    {
      name: "decides nothing when no rule matches and the agent has no model",
      rules: [rule.apiBugfix],
      patch: { agentDefault: undefined },
      expected: ["none"],
    },
    {
      name: "skips rules on harnesses outside the allowlist",
      rules: [rule.webBugfix, rule.webAny],
      patch: { allowlist: { harnesses: [claude] } },
      expected: ["rule:web-any claude/small", "web-bugfix harness_not_allowed"],
    },
    {
      name: "skips models outside the allowlist",
      rules: [rule.big, rule.bugfix],
      patch: { allowlist: { models: ["small"] } },
      expected: ["rule:bugfix claude/small", "big model_not_allowed"],
    },
    {
      name: "skips the agent's own model too, leaving nothing allowed",
      rules: [rule.webBugfix],
      patch: { allowlist: { harnesses: [codex], models: ["tiny"] } },
      expected: ["none_allowed", "web-bugfix model_not_allowed", "agent harness_not_allowed"],
    },
    {
      name: "treats empty allowlists as no restriction",
      rules: [rule.webBugfix],
      patch: { allowlist: { harnesses: [], models: [] } },
      expected: ["rule:web-bugfix codex/small"],
    },
    {
      name: "skips a harness this server does not run",
      rules: [rule.retired, rule.bugfix],
      expected: ["rule:bugfix claude/small", "retired harness_unavailable"],
    },
    {
      name: "skips the agent's own model on a harness this server does not run",
      rules: [],
      patch: { agentDefault: { instanceId: retired, model: "small" } },
      expected: ["none_allowed", "agent harness_unavailable"],
    },
  ])("$name", ({ rules, patch, expected }) => {
    assert.deepStrictEqual(
      summary(RoutingService.resolveRoute(rules, { ...context, ...patch })),
      expected,
    );
  });
});

const layer = Layer.mergeAll(
  RoutingService.layer,
  GrantService.layer,
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
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env-elsewhere")),
    }),
  ),
  Layer.provide(
    Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      listInstances: Effect.succeed([
        { instanceId: codex, enabled: true },
        { instanceId: claude, enabled: true },
        { instanceId: disabled, enabled: false },
      ] as never),
    }),
  ),
);

const session = (name: string): WorkspaceService.Caller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const as = { ann: session("ann"), bea: session("bea"), zed: session("zed") };
const ALL: Telescope.StandingPowers = {
  openTickets: true,
  dispatchWorkers: true,
  answerMembers: true,
  mergePRs: true,
};

/** Admin `ann`, member `bea`, and the bound project `web`. */
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
  return {
    workspaceId,
    beaId: bea.subjectId,
    workspaces,
    routing: yield* RoutingService.RoutingService,
  };
});

const reasonOf = <A>(
  effect: Effect.Effect<A, Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError>,
) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => (error._tag === "TelescopeWorkspaceError" ? error.reason : error._tag)),
  );

it.layer(layer)("Telescope routing rules", (it) => {
  it.effect("lets admins write rules and members read them, one workspace at a time", () =>
    Effect.gen(function* () {
      const { workspaceId, beaId, workspaces, routing } = yield* setup;
      const input = {
        workspaceId,
        taskType: "bugfix",
        harness: codex,
        model: "small",
        priority: 0,
      };

      assert.strictEqual(yield* reasonOf(routing.set(as.bea, input)), "forbidden");
      const created = yield* routing.set(as.ann, input);
      yield* TestClock.adjust("1 second");
      const scoped = yield* routing.set(as.ann, { ...input, projectId: web, taskType: "*" });
      assert.strictEqual(
        yield* reasonOf(routing.set(as.ann, { ...input, projectId: ProjectId.make("unbound") })),
        "not_found",
      );
      yield* TestClock.adjust("1 second");
      const updated = yield* routing.set(as.ann, { ...input, id: created.id, model: "big" });
      assert.deepStrictEqual(updated, { ...created, model: "big" });
      assert.deepStrictEqual(
        (yield* routing.list(as.bea, { workspaceId })).rules,
        [updated, scoped],
        "members read the rules, earliest first even after an update",
      );
      assert.strictEqual(
        yield* reasonOf(routing.remove(as.bea, { workspaceId, id: created.id })),
        "forbidden",
      );

      const other = yield* workspaces.create(as.zed, {
        kind: "enterprise",
        name: "Other",
        displayName: "Zed",
      });
      const elsewhere = { ...input, workspaceId: other.id, id: created.id };
      assert.deepStrictEqual((yield* routing.list(as.zed, { workspaceId: other.id })).rules, []);
      assert.strictEqual(yield* reasonOf(routing.set(as.zed, elsewhere)), "not_found");
      yield* routing.remove(as.zed, { workspaceId: other.id, id: created.id });
      assert.strictEqual(yield* reasonOf(routing.list(as.zed, { workspaceId })), "forbidden");
      assert.lengthOf((yield* routing.list(as.ann, { workspaceId })).rules, 2);

      yield* routing.remove(as.ann, { workspaceId, id: created.id });
      assert.deepStrictEqual((yield* routing.list(as.ann, { workspaceId })).rules, [scoped]);

      yield* workspaces.revoke(as.ann, { workspaceId, subjectId: beaId });
      assert.strictEqual(yield* reasonOf(routing.list(as.bea, { workspaceId })), "forbidden");
      const agentId = Telescope.AgentId.make("any-agent");
      assert.strictEqual(
        yield* reasonOf(routing.resolveFor(as.bea, { workspaceId, agentId, taskType: "bugfix" })),
        "forbidden",
      );
    }),
  );

  it.effect("resolves within the project rule's allowlist and the providers enabled here", () =>
    Effect.gen(function* () {
      const { workspaceId, routing } = yield* setup;
      const agents = yield* AgentService.AgentService;
      const grants = yield* GrantService.GrantService;
      const mine = (yield* agents.listMine(as.bea, { workspaceId })).agents;
      const chief = mine.find((agent) => agent.kind === "chief_agent" && agent.projectId === web);
      const staff = mine.find((agent) => agent.kind === "chief_of_staff");
      assert.isDefined(chief);
      assert.isDefined(staff);
      const db = yield* TelescopeDb.TelescopeDb;
      const ruleB = Telescope.RoutingRuleId.make("rule-b");
      const ruleA = Telescope.RoutingRuleId.make("rule-a");
      const seed = (ruleId: Telescope.RoutingRuleId, createdAt: string) =>
        db.insert(workspaceId, "routing_rules", {
          rule_id: ruleId,
          project_id: null,
          task_type: "docs",
          harness: codex,
          model: "small",
          priority: 0,
          created_at: createdAt,
        });
      yield* seed(ruleB, "2026-11-07T00:00:00.000Z");
      yield* seed(ruleA, "2026-11-07T00:00:01.000Z");
      assert.deepStrictEqual(
        (yield* routing.list(as.bea, { workspaceId })).rules.map((rule) => rule.id),
        [ruleB, ruleA],
        "equal rules tie in creation order, not by id",
      );
      assert.strictEqual(
        (yield* routing.resolve(workspaceId, { agentId: staff.id, taskType: "docs" })).ruleId,
        ruleB,
      );
      const sonnet = { instanceId: claude, model: "sonnet" };
      yield* agents.update(as.bea, { workspaceId, agentId: chief.id, modelSelection: sonnet });
      const off = yield* routing.set(as.ann, {
        workspaceId,
        taskType: "bugfix",
        harness: disabled,
        model: "small",
        priority: 9,
      });
      const small = yield* routing.set(as.ann, {
        workspaceId,
        projectId: web,
        taskType: "bugfix",
        harness: codex,
        model: "small",
        priority: 0,
      });
      const bugfix = { workspaceId, agentId: chief.id, taskType: "bugfix" };

      assert.deepStrictEqual(
        yield* routing.resolveFor(as.bea, bugfix),
        {
          source: "rule",
          ruleId: small.id,
          modelSelection: { instanceId: codex, model: "small" },
          skipped: [],
        },
        "a project's Chief Agent routes within its project without naming it",
      );
      assert.deepStrictEqual(
        yield* routing.resolve(workspaceId, { agentId: staff.id, taskType: "bugfix" }),
        { source: "none_allowed", skipped: [{ ruleId: off.id, reason: "harness_unavailable" }] },
        "a disabled provider instance is skipped",
      );
      assert.strictEqual(
        yield* reasonOf(routing.resolveFor(as.ann, bugfix)),
        "not_found",
        "another member's hidden agent is not resolved",
      );

      const projectRule = { workspaceId, projectId: web, powers: ALL, routing: null };
      yield* grants.setProjectRule(as.ann, { ...projectRule, routing: { harnesses: [claude] } });
      assert.deepStrictEqual(yield* routing.resolve(workspaceId, bugfix), {
        source: "agent_default",
        modelSelection: sonnet,
        skipped: [
          { ruleId: small.id, reason: "harness_not_allowed" },
          { ruleId: off.id, reason: "harness_not_allowed" },
        ],
      });
      const elsewhere = { ...bugfix, projectId: api };
      assert.strictEqual(
        yield* reasonOf(routing.resolve(workspaceId, elsewhere)),
        "conflict",
        "naming another project does not step around the allowlist",
      );
      assert.strictEqual(yield* reasonOf(routing.resolveFor(as.bea, elsewhere)), "conflict");
      yield* grants.setProjectRule(as.ann, projectRule);
      assert.strictEqual(
        (yield* routing.resolve(workspaceId, bugfix)).ruleId,
        small.id,
        "lifting the allowlist restores the rule",
      );
    }),
  );
});
