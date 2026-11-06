import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runMigrations } from "../persistence/Migrations.ts";
import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AgentService from "./AgentService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(AgentService.layer, WorkspaceService.layer).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
);

const environmentId = EnvironmentId.make("env-local");
const web = ProjectId.make("project-web");
const api = ProjectId.make("project-api");

/** An enterprise workspace with admin `ann`, member `bea` (lead of `api`), and two bound projects. */
const setup = (kind: "enterprise" | "personal" = "enterprise") =>
  Effect.gen(function* () {
    const workspaces = yield* WorkspaceService.WorkspaceService;
    const workspace = yield* workspaces.create("ann", { kind, name: "Acme", displayName: "Ann" });
    const workspaceId = workspace.id;
    const { code } = yield* workspaces.invite("ann", { workspaceId, role: "member" });
    yield* workspaces.accept("bea", { code, displayName: "Bea" });
    yield* workspaces.bind("ann", { workspaceId, environmentId, projectId: web });
    yield* workspaces.bind("ann", {
      workspaceId,
      environmentId,
      projectId: api,
      leadSubjectId: "bea",
    });
    return { workspaceId, agents: yield* AgentService.AgentService };
  });

const reasonOf = <A>(
  effect: Effect.Effect<A, Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError>,
) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => (error._tag === "TelescopeWorkspaceError" ? error.reason : error._tag)),
  );

const chiefAgent = (agents: ReadonlyArray<Telescope.Agent>, projectId: ProjectId) => {
  const agent = agents.find((a) => a.kind === "chief_agent" && a.projectId === projectId);
  assert.isDefined(agent);
  return agent;
};

it.layer(layer)("Telescope agents", (it) => {
  it.effect("lazily creates one Chief of Staff and one Chief Agent per bound project, once", () =>
    Effect.gen(function* () {
      const { workspaceId, agents } = yield* setup();
      const [first, second] = yield* Effect.all(
        [agents.listMine("bea", { workspaceId }), agents.listMine("bea", { workspaceId })],
        { concurrency: 2 },
      );
      assert.strictEqual(first.agents[0]?.name, "Chief of Staff");
      assert.deepStrictEqual(
        first.agents.map((a) => `${a.ownerSubjectId}/${a.kind}/${a.name}`).toSorted(),
        [
          "bea/chief_agent/project-api Chief Agent",
          "bea/chief_agent/project-web Chief Agent",
          "bea/chief_of_staff/Chief of Staff",
        ],
      );
      assert.deepStrictEqual(
        second.agents.map((a) => a.id).toSorted(),
        first.agents.map((a) => a.id).toSorted(),
      );

      const custom = yield* agents.createCustom("bea", {
        workspaceId,
        name: "Reviewer",
        projectId: web,
      });
      const third = yield* agents.listMine("bea", { workspaceId });
      assert.deepStrictEqual(
        third.agents.map((a) => a.id),
        [...first.agents.map((a) => a.id), custom.id],
      );
      assert.strictEqual((yield* agents.listMine("ann", { workspaceId })).agents.length, 3);
      assert.strictEqual(
        yield* reasonOf(agents.listMine("zed", { workspaceId })),
        "forbidden",
        "non-members get no agents",
      );
    }),
  );

  it.effect("caps standing powers by the owner's role and keeps settings to the owner", () =>
    Effect.gen(function* () {
      const { workspaceId, agents } = yield* setup();
      const bea = (yield* agents.listMine("bea", { workspaceId })).agents;
      const ann = (yield* agents.listMine("ann", { workspaceId })).agents;
      const merge = {
        openTickets: true,
        dispatchWorkers: true,
        answerMembers: true,
        mergePRs: true,
      };

      const webAgent = chiefAgent(bea, web);
      assert.strictEqual(
        yield* reasonOf(
          agents.update("bea", { workspaceId, agentId: webAgent.id, standingPowers: merge }),
        ),
        "forbidden",
        "a member cannot let their Chief Agent merge PRs",
      );
      const apiAgent = chiefAgent(bea, api);
      const lead = yield* agents.update("bea", {
        workspaceId,
        agentId: apiAgent.id,
        standingPowers: merge,
      });
      assert.isTrue(lead.standingPowers.mergePRs, "the project lead can");
      const admin = yield* agents.update("ann", {
        workspaceId,
        agentId: chiefAgent(ann, web).id,
        standingPowers: merge,
        name: "Ann's web agent",
      });
      assert.deepStrictEqual(
        [admin.standingPowers.mergePRs, admin.name],
        [true, "Ann's web agent"],
      );

      const { card } = yield* agents.get("ann", { workspaceId, agentId: admin.id });
      assert.include(card.requiredPermissions, "mergePRs");

      assert.strictEqual(
        yield* reasonOf(agents.update("ann", { workspaceId, agentId: webAgent.id, name: "Mine" })),
        "not_found",
        "another member's hidden agent is not even visible",
      );
      yield* agents.update("bea", { workspaceId, agentId: webAgent.id, exposure: "visible" });
      assert.strictEqual(
        yield* reasonOf(agents.update("ann", { workspaceId, agentId: webAgent.id, name: "Mine" })),
        "forbidden",
      );
    }),
  );

  it.effect("opens exposure one level at a time and lowers it to any level", () =>
    Effect.gen(function* () {
      const { workspaceId, agents } = yield* setup();
      const [assistant] = (yield* agents.listMine("bea", { workspaceId })).agents;
      assert.isDefined(assistant);
      const set = (exposure: Telescope.AgentExposure) =>
        agents.update("bea", { workspaceId, agentId: assistant.id, exposure });

      assert.strictEqual(assistant.exposure, "hidden");
      assert.strictEqual(yield* reasonOf(set("contactable")), "forbidden");
      for (const level of ["visible", "contactable", "dispatchable"] as const)
        assert.strictEqual((yield* set(level)).exposure, level);
      assert.strictEqual((yield* set("hidden")).exposure, "hidden");
      assert.strictEqual(yield* reasonOf(set("contactable")), "forbidden");

      const personal = yield* setup("personal");
      const [own] = (yield* agents.listMine("bea", { workspaceId: personal.workspaceId })).agents;
      assert.isDefined(own);
      const open = (exposure: Telescope.AgentExposure) =>
        agents.update("bea", { workspaceId: personal.workspaceId, agentId: own.id, exposure });
      yield* open("visible");
      yield* open("contactable");
      assert.strictEqual(
        yield* reasonOf(open("dispatchable")),
        "forbidden",
        "personal workspaces have no dispatchable switch",
      );
    }),
  );

  it.effect("keeps hidden personal agents out of the company view and unreachable", () =>
    Effect.gen(function* () {
      const { workspaceId, agents } = yield* setup();
      const [assistant] = (yield* agents.listMine("bea", { workspaceId })).agents;
      assert.isDefined(assistant);
      const companyView = () =>
        agents
          .listCompany("ann", { workspaceId })
          .pipe(Effect.map(({ agents }) => agents.map((a) => a.id)));
      const contact = () => agents.companyRecipient(workspaceId, assistant.id, "contact");

      assert.notInclude(yield* companyView(), assistant.id);
      assert.strictEqual(yield* reasonOf(contact()), "not_found");

      yield* agents.update("bea", { workspaceId, agentId: assistant.id, exposure: "visible" });
      assert.include(yield* companyView(), assistant.id);
      assert.strictEqual(yield* reasonOf(contact()), "forbidden");

      yield* agents.update("bea", { workspaceId, agentId: assistant.id, exposure: "contactable" });
      assert.strictEqual((yield* contact()).id, assistant.id);
      assert.strictEqual(
        yield* reasonOf(agents.companyRecipient(workspaceId, assistant.id, "dispatch")),
        "forbidden",
      );
    }),
  );

  it.effect("lets only admins configure company agents, which exist only in enterprises", () =>
    Effect.gen(function* () {
      const { workspaceId, agents } = yield* setup();
      const company = (yield* agents.listCompany("bea", { workspaceId })).agents;
      assert.deepStrictEqual(
        company.map((a) => [a.kind, a.name]),
        [
          ["company_main", "主代理"],
          ["department", "人事"],
          ["department", "财务"],
          ["department", "法务"],
          ["department", "IT"],
          ["department", "行政"],
        ],
      );
      assert.strictEqual((yield* agents.listCompany("ann", { workspaceId })).agents.length, 6);

      const department = company[1];
      assert.isDefined(department);
      const rename = (caller: string) =>
        agents.updateCompany(caller, { workspaceId, agentId: department.id, name: "HR" });
      assert.strictEqual(yield* reasonOf(rename("bea")), "forbidden");
      assert.strictEqual(
        yield* reasonOf(agents.update("bea", { workspaceId, agentId: department.id, name: "HR" })),
        "not_found",
      );
      assert.strictEqual((yield* rename("ann")).name, "HR");

      const personal = yield* setup("personal");
      assert.strictEqual(
        yield* reasonOf(agents.listCompany("ann", { workspaceId: personal.workspaceId })),
        "forbidden",
      );
    }),
  );
});
