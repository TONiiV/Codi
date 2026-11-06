import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
);

const session = (name: string): WorkspaceService.Caller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const as = { ann: session("ann"), bea: session("bea"), zed: session("zed") };
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
  yield* workspaces.bind(as.ann, { workspaceId, environmentId, projectId: web });
  yield* workspaces.bind(as.ann, {
    workspaceId,
    environmentId,
    projectId: api,
    leadSubjectId: bea.subjectId,
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
      const { workspaceId, beaId, grants, setPowers, mine } = yield* setup;
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
    }),
  );

  it.effect("lets a project rule remove a power the role grants", () =>
    Effect.gen(function* () {
      const { workspaceId, grants, setPowers, mine } = yield* setup;
      const webAgent = find(yield* mine(as.ann), "chief_agent", web);
      yield* setPowers(webAgent.id, ALL);
      const rule = { workspaceId, projectId: web, powers: { ...ALL, mergePRs: false } };

      assert.strictEqual(yield* reasonOf(grants.setProjectRule(as.bea, rule)), "forbidden");
      assert.strictEqual(
        yield* reasonOf(
          grants.setProjectRule(as.ann, { ...rule, projectId: ProjectId.make("unbound") }),
        ),
        "not_found",
      );
      const before = yield* grants.explainFor(as.ann, { workspaceId, agentId: webAgent.id });
      assert.isTrue(before.powers.mergePRs);

      yield* grants.setProjectRule(as.ann, rule);
      const after = yield* grants.explainFor(as.ann, { workspaceId, agentId: webAgent.id });
      assert.deepStrictEqual(after.powers, { ...ALL, mergePRs: false });
      assert.strictEqual(removedBy(after, "mergePRs"), "project");

      yield* grants.setProjectRule(as.ann, { ...rule, powers: ALL });
      const lifted = yield* grants.explainFor(as.ann, { workspaceId, agentId: webAgent.id });
      assert.isTrue(lifted.powers.mergePRs, "a rule can be lifted again");

      const unbound = yield* grants.explainFor(as.ann, {
        workspaceId,
        agentId: webAgent.id,
        projectId: ProjectId.make("unbound"),
      });
      assert.strictEqual(removedBy(unbound, "openTickets"), "project");
    }),
  );

  it.effect("intersects powers along CoS, Chief Agent and custom agent", () =>
    Effect.gen(function* () {
      const { workspaceId, grants, agents, setPowers, mine } = yield* setup;
      const ann = yield* mine(as.ann);
      const cos = find(ann, "chief_of_staff");
      const chief = find(ann, "chief_agent", web);
      const custom = yield* agents.createCustom(as.ann, {
        workspaceId,
        name: "Reviewer",
        projectId: web,
      });
      yield* setPowers(cos.id, { ...ALL, dispatchWorkers: false });
      yield* setPowers(chief.id, { ...ALL, answerMembers: false });
      yield* setPowers(custom.id, ALL);

      const direct = yield* grants.explainFor(as.ann, { workspaceId, agentId: custom.id });
      assert.deepStrictEqual(direct.powers, ALL);

      const chained = yield* grants.explainFor(as.ann, {
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
        yield* reasonOf(grants.explainFor(as.ann, { workspaceId, agentId: beaChief.id })),
        "not_found",
        "another member's agents are not explained",
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
      for (const outcome of ["denied", "allowed", "denied", "allowed", "denied"] as const)
        written.push(
          yield* grants.audit(workspaceId, {
            runId,
            agentId: chief.id,
            onBehalfOf: [beaId],
            projectId: web,
            power: "mergePRs",
            tool: "merge_pull_request",
            argsRedacted: { token: "***" },
            outcome,
            reason: "The member role does not grant this in this project.",
          }),
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
      for (let page = 0; page < 4; page += 1) {
        const { entries } = yield* grants.auditList(as.ann, {
          workspaceId,
          limit: 2,
          ...(before === undefined ? {} : { before }),
        });
        pages.push(entries);
        const last = entries.at(-1);
        if (last === undefined) break;
        before = { createdAt: last.createdAt, auditId: last.id };
      }
      assert.deepStrictEqual(
        pages.map((entries) => entries.length),
        [2, 2, 1, 0],
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
