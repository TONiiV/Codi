import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  Telescope,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AgentService from "./AgentService.ts";
import * as GrantService from "./GrantService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const layer = Layer.mergeAll(
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
);

const session = (name: string): WorkspaceService.SessionCaller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const as = {
  ann: session("ann"),
  bea: session("bea"),
  cy: session("cy"),
  zed: session("zed"),
  owner: { sessionId: AuthSessionId.make("session-owner"), subject: "desktop-bootstrap" },
};
const environmentId = EnvironmentId.make("env-local");
const web = ProjectId.make("project-web");
const api = ProjectId.make("project-api");

const ALL: Telescope.StandingPowers = {
  openTickets: true,
  dispatchWorkers: true,
  answerMembers: true,
  mergePRs: true,
};

/** Admin `ann`, member `bea` (lead of `api`), and two bound projects. */
const setup = Effect.gen(function* () {
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const workspace = yield* workspaces.create(as.ann, {
    kind: "enterprise",
    name: "Acme",
    displayName: "Ann",
  });
  const workspaceId = workspace.id;
  const { code } = yield* workspaces.invite(as.ann, { workspaceId, role: "member" });
  const bea = yield* workspaces.accept(as.bea, { code, displayName: "Bea" });
  yield* workspaces.createProject(as.ann, {
    workspaceId,
    name: "Project",
    mounts: [{ environmentId, projectId: web }],
  });
  yield* workspaces.createProject(as.ann, {
    workspaceId,
    name: "Project",
    leadSubjectId: bea.subjectId,
    mounts: [{ environmentId, projectId: api }],
  });
  const agents = yield* AgentService.AgentService;
  const db = yield* TelescopeDb.TelescopeDb;
  // Stored flags written directly, as no owner role could have set them through the service.
  const setPowers = (agentId: Telescope.AgentId, powers: Telescope.StandingPowers) =>
    db.update(
      workspaceId,
      "agents",
      { standing_powers_json: JSON.stringify(powers) },
      { agent_id: agentId },
    );
  const mine = (caller: WorkspaceService.Caller) =>
    agents.listMine(caller, { workspaceId }).pipe(Effect.map(({ agents }) => agents));
  // Members get no new agents; Bea's are the owner's defaults handed to her before that rule.
  yield* mine(as.owner);
  yield* db.update(
    workspaceId,
    "agents",
    { owner_subject_id: bea.subjectId },
    { owner_subject_id: Telescope.OWNER_MEMBER_ID },
  );
  return {
    workspaceId,
    beaId: bea.subjectId,
    grants: yield* GrantService.GrantService,
    agents,
    setPowers,
    mine,
  };
});

const find = (
  agents: ReadonlyArray<Telescope.Agent>,
  kind: Telescope.AgentKind,
  projectId?: ProjectId,
) => {
  const agent = agents.find((a) => a.kind === kind && a.projectId === projectId);
  assert.isDefined(agent);
  return agent;
};

const removedBy = (result: Telescope.GrantExplainResult, power: Telescope.GrantPower) => {
  const explanation = result.explanations.find((e) => e.power === power);
  assert.isDefined(explanation);
  const by = explanation.removedBy;
  return by === undefined
    ? "kept"
    : `${by.layer}${by.agentId === undefined ? "" : `:${by.agentId}`}`;
};

const reasonOf = <A>(
  effect: Effect.Effect<A, Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError>,
) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => (error._tag === "TelescopeWorkspaceError" ? error.reason : error._tag)),
  );

it.layer(layer)("Telescope grants", (it) => {
  it.effect("never lets a member's Chief Agent merge PRs when the member role lacks it", () =>
    Effect.gen(function* () {
      const { workspaceId, beaId, grants, agents, setPowers, mine } = yield* setup;
      const bea = yield* mine(as.bea);
      const webAgent = find(bea, "chief_agent", web);
      const apiAgent = find(bea, "chief_agent", api);
      yield* setPowers(webAgent.id, ALL);
      yield* setPowers(apiAgent.id, ALL);

      const denied = yield* grants.explain(workspaceId, {
        agentId: webAgent.id,
        onBehalfOf: [beaId],
      });
      assert.strictEqual(denied.projectId, web, "a Chief Agent's own project applies");
      assert.deepStrictEqual(denied.powers, { ...ALL, mergePRs: false });
      assert.strictEqual(removedBy(denied, "mergePRs"), "role");
      assert.strictEqual(removedBy(denied, "openTickets"), "kept");

      const lead = yield* grants.effectiveGrant(workspaceId, {
        agentId: apiAgent.id,
        onBehalfOf: [beaId],
      });
      assert.isTrue(lead.powers.mergePRs, "the project's lead can");
      assert.notProperty(lead, "explanations");

      const outsider = yield* grants.explain(workspaceId, {
        agentId: apiAgent.id,
        onBehalfOf: ["not-a-member"],
      });
      assert.deepStrictEqual(Object.values(outsider.powers), [false, false, false, false]);
      assert.strictEqual(removedBy(outsider, "openTickets"), "role");

      // A company agent has no owner cap, so only the role layer guards the member it acts for.
      const workspaces = yield* WorkspaceService.WorkspaceService;
      const { code } = yield* workspaces.invite(as.ann, { workspaceId, role: "project_lead" });
      const cy = yield* workspaces.accept(as.cy, { code, displayName: "Cy" });
      const { agents: company } = yield* agents.listCompany(as.ann, { workspaceId });
      const front = find(company, "company_main");
      yield* setPowers(front.id, ALL);
      const forCy = (projectId: ProjectId) =>
        grants.explain(workspaceId, { agentId: front.id, projectId, onBehalfOf: [cy.subjectId] });
      assert.strictEqual(removedBy(yield* forCy(api), "mergePRs"), "role", "bea leads api, not cy");
      assert.strictEqual(
        removedBy(yield* forCy(web), "mergePRs"),
        "role",
        "the project_lead role alone grants no merging (D25)",
      );
      yield* workspaces.revoke(as.ann, { workspaceId, subjectId: beaId });
      const revoked = yield* grants.explain(workspaceId, {
        agentId: front.id,
        projectId: web,
        onBehalfOf: [beaId],
      });
      assert.strictEqual(removedBy(revoked, "openTickets"), "role", "a revoked member holds none");
    }),
  );

  it.effect("lets a project rule remove a power the role grants", () =>
    Effect.gen(function* () {
      const { workspaceId, beaId, grants, setPowers, mine } = yield* setup;
      const webAgent = find(yield* mine(as.owner), "chief_agent", web);
      yield* setPowers(webAgent.id, ALL);
      const rule = {
        workspaceId,
        projectId: web,
        powers: { ...ALL, mergePRs: false },
        routing: null,
      };

      const workspaces = yield* WorkspaceService.WorkspaceService;
      const other = yield* workspaces.create(as.zed, {
        kind: "enterprise",
        name: "Other",
        displayName: "Zed",
      });
      const docs = ProjectId.make("project-docs");
      yield* workspaces.createProject(as.zed, {
        workspaceId: other.id,
        name: "Project",
        mounts: [{ environmentId, projectId: docs }],
      });
      const othersRules = grants
        .projectRules(as.zed, { workspaceId: other.id })
        .pipe(Effect.map(({ rules }) => rules));
      const untouched = [{ projectId: docs, stored: false, powers: ALL, routing: null }];
      assert.deepStrictEqual(yield* othersRules, untouched);
      const intoOther = { ...rule, projectId: docs };
      assert.strictEqual(
        yield* reasonOf(grants.setProjectRule(as.ann, intoOther)),
        "not_found",
        "an admin of A cannot rule a project bound only to B",
      );
      assert.strictEqual(
        yield* reasonOf(grants.setProjectRule(as.ann, { ...intoOther, workspaceId: other.id })),
        "forbidden",
        "an admin of A is nobody in B",
      );
      assert.deepStrictEqual(yield* othersRules, untouched, "neither refused set writes into B");
      const peek = yield* Effect.flip(grants.projectRules(as.bea, { workspaceId: other.id }));
      assert.strictEqual(
        peek._tag === "TelescopeWorkspaceError" ? peek.reason : peek._tag,
        "forbidden",
        "a member of A cannot list B's rules",
      );
      assert.notInclude(peek.message, docs, "the refusal names none of B's projects");

      assert.strictEqual(yield* reasonOf(grants.setProjectRule(as.bea, rule)), "forbidden");
      assert.strictEqual(
        yield* reasonOf(
          grants.setProjectRule(as.ann, { ...rule, projectId: ProjectId.make("unbound") }),
        ),
        "not_found",
      );
      const before = yield* grants.explainFor(as.owner, { workspaceId, agentId: webAgent.id });
      assert.isTrue(before.powers.mergePRs);
      const listed = grants
        .projectRules(as.bea, { workspaceId })
        .pipe(Effect.map(({ rules }) => rules.map((r) => [r.projectId, r.stored, r.routing])));
      yield* workspaces.createProject(as.ann, {
        workspaceId,
        name: "Project",
        mounts: [{ environmentId: EnvironmentId.make("env-other"), projectId: web }],
      });
      assert.deepStrictEqual(
        (yield* grants.projectRules(as.bea, { workspaceId })).rules,
        [api, web].map((projectId) => ({ projectId, stored: false, powers: ALL, routing: null })),
        "an unruled project lists the defaults the grant uses, once per project however many environments bind it",
      );
      assert.strictEqual(
        yield* reasonOf(grants.projectRules(as.zed, { workspaceId })),
        "forbidden",
        "only members read the rules",
      );

      const routed = { ...rule, routing: { harnesses: [ProviderInstanceId.make("claude")] } };
      assert.deepStrictEqual(yield* grants.setProjectRule(as.ann, routed), {
        projectId: web,
        stored: true,
        powers: rule.powers,
        routing: routed.routing,
      });
      assert.deepStrictEqual(yield* listed, [
        [api, false, null],
        [web, true, routed.routing],
      ]);
      yield* grants.setProjectRule(as.ann, rule);
      assert.deepStrictEqual(
        yield* listed,
        [
          [api, false, null],
          [web, true, null],
        ],
        "routing: null clears the allowlist",
      );
      const after = yield* grants.explainFor(as.owner, { workspaceId, agentId: webAgent.id });
      assert.deepStrictEqual(after.powers, { ...ALL, mergePRs: false });
      assert.strictEqual(removedBy(after, "mergePRs"), "project");

      yield* grants.setProjectRule(as.ann, { ...rule, powers: ALL });
      const lifted = yield* grants.explainFor(as.owner, { workspaceId, agentId: webAgent.id });
      assert.isTrue(lifted.powers.mergePRs, "a rule can be lifted again");

      assert.strictEqual(
        yield* reasonOf(
          grants.effectiveGrant(workspaceId, {
            agentId: find(yield* mine(as.bea), "chief_agent", web).id,
            projectId: api,
            onBehalfOf: [beaId],
          }),
        ),
        "conflict",
        "another project's rules never stand in for the agent's own",
      );
      const cos = find(yield* mine(as.owner), "chief_of_staff");
      yield* setPowers(cos.id, ALL);
      const unbound = yield* grants.explainFor(as.owner, {
        workspaceId,
        agentId: cos.id,
        projectId: ProjectId.make("unbound"),
      });
      assert.strictEqual(removedBy(unbound, "openTickets"), "project");
    }),
  );

  it.effect("intersects powers along CoS, Chief Agent and custom agent", () =>
    Effect.gen(function* () {
      const { workspaceId, grants, agents, setPowers, mine } = yield* setup;
      const owner = yield* mine(as.owner);
      const cos = find(owner, "chief_of_staff");
      const chief = find(owner, "chief_agent", web);
      const custom = yield* agents.createCustom(as.owner, {
        workspaceId,
        name: "Reviewer",
        projectId: web,
      });
      yield* setPowers(cos.id, { ...ALL, dispatchWorkers: false });
      yield* setPowers(chief.id, { ...ALL, answerMembers: false });
      yield* setPowers(custom.id, ALL);

      const direct = yield* grants.explainFor(as.owner, { workspaceId, agentId: custom.id });
      assert.deepStrictEqual(direct.powers, ALL);

      const chained = yield* grants.explainFor(as.owner, {
        workspaceId,
        agentId: custom.id,
        via: [cos.id, chief.id],
      });
      assert.deepStrictEqual(chained.powers, {
        openTickets: true,
        dispatchWorkers: false,
        answerMembers: false,
        mergePRs: true,
      });
      assert.strictEqual(removedBy(chained, "dispatchWorkers"), `agent:${cos.id}`);
      assert.strictEqual(removedBy(chained, "answerMembers"), `agent:${chief.id}`);
      assert.strictEqual(chained.onBehalfOf.length, 3);
      for (const power of Telescope.GrantPower.literals)
        assert.isTrue(
          !chained.powers[power] || direct.powers[power],
          `the delegate never exceeds a delegator on ${power}`,
        );

      const beaChief = find(yield* mine(as.bea), "chief_agent", web);
      assert.strictEqual(
        yield* reasonOf(grants.explainFor(as.owner, { workspaceId, agentId: beaChief.id })),
        "not_found",
        "another member's agents are not explained",
      );
      assert.strictEqual(
        yield* reasonOf(
          grants.explainFor(as.owner, { workspaceId, agentId: beaChief.id, projectId: api }),
        ),
        "not_found",
        "nor is where they work",
      );
      assert.strictEqual(
        yield* reasonOf(grants.explainFor(as.zed, { workspaceId, agentId: custom.id })),
        "forbidden",
      );
    }),
  );

  it.effect("keeps audit rows per workspace, paged newest first, admins only", () =>
    Effect.gen(function* () {
      const { workspaceId, beaId, grants, mine } = yield* setup;
      const chief = find(yield* mine(as.bea), "chief_agent", web);
      const runId = Telescope.AgentRunId.make("run-1");
      const written: Array<Telescope.AuditEntry> = [];
      // Three instants shared by 10, 10 and 5 rows: random ids disagree with time across instants
      // and tie within one, so the cursor needs both columns.
      for (let index = 0; index < 25; index += 1) {
        if (index === 10 || index === 20) yield* TestClock.adjust("1 second");
        written.push(
          yield* grants.audit(workspaceId, {
            runId,
            agentId: chief.id,
            onBehalfOf: [beaId],
            projectId: web,
            power: "mergePRs",
            tool: "merge_pull_request",
            argsRedacted: { token: "***" },
            outcome: index % 2 === 0 ? "denied" : "allowed",
            reason: "The member role does not grant this in this project.",
          }),
        );
      }

      const blank = yield* Effect.exit(
        grants.audit(workspaceId, {
          agentId: chief.id,
          onBehalfOf: [beaId],
          power: "mergePRs",
          tool: " ",
          outcome: "denied",
        }),
      );
      assert.isTrue(
        Exit.isFailure(blank) && Cause.hasDies(blank.cause),
        "a blank tool is never stored",
      );

      const workspaces = yield* WorkspaceService.WorkspaceService;
      const other = yield* workspaces.create(as.zed, {
        kind: "enterprise",
        name: "Other",
        displayName: "Zed",
      });
      yield* grants.audit(other.id, {
        agentId: chief.id,
        onBehalfOf: ["owner"],
        power: "openTickets",
        outcome: "allowed",
      });

      const pages: Array<ReadonlyArray<Telescope.AuditEntry>> = [];
      let before: { createdAt: string; auditId: Telescope.AuditEntryId } | undefined;
      for (let page = 0; page < 5; page += 1) {
        const { entries } = yield* grants.auditList(as.ann, {
          workspaceId,
          limit: 7,
          ...(before === undefined ? {} : { before }),
        });
        pages.push(entries);
        const last = entries.at(-1);
        if (last === undefined) break;
        before = { createdAt: last.createdAt, auditId: last.id };
      }
      assert.deepStrictEqual(
        pages.map((entries) => entries.length),
        [7, 7, 7, 4, 0],
      );
      const listed = pages.flat();
      assert.deepStrictEqual(
        listed.map((entry) => entry.id),
        written
          .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.id < a.id ? -1 : 1))
          .map((entry) => entry.id),
      );
      assert.deepStrictEqual(
        listed.find((entry) => entry.id === written[0]?.id),
        written[0],
      );
      assert.isTrue(listed.every((entry) => entry.workspaceId === workspaceId));

      assert.strictEqual(
        yield* reasonOf(grants.auditList(as.bea, { workspaceId })),
        "forbidden",
        "members do not read the audit",
      );
      assert.strictEqual(
        yield* reasonOf(grants.auditList(as.ann, { workspaceId: other.id })),
        "forbidden",
        "another workspace's audit is out of reach",
      );
      const { entries: zeds } = yield* grants.auditList(as.zed, { workspaceId: other.id });
      assert.deepStrictEqual(
        zeds.map((entry) => entry.power),
        ["openTickets"],
      );
    }),
  );
});
