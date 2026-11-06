import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as SqlClient from "effect/sql/SqlClient";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AgentService from "./AgentService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const services = <E>(persistence: Layer.Layer<SqlClient.SqlClient, E>) =>
  Layer.mergeAll(AgentService.layer, WorkspaceService.layer).pipe(
    Layer.provideMerge(
      Layer.merge(
        Layer.effectDiscard(runMigrations()).pipe(Layer.provideMerge(persistence)),
        NodeCrypto.layer,
      ),
    ),
    Layer.provide(
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("env-elsewhere")),
      }),
    ),
  );
const layer = services(SqlitePersistence.layerMemory);
// The production client reads on a worker, so concurrent fibers really interleave.
const fileLayer = services(
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-telescope-agents-" });
      return SqlitePersistence.layerFromPath(`${directory}/state.sqlite`);
    }),
  ).pipe(Layer.provide(NodeServices.layer)),
);

const session = (name: string): WorkspaceService.Caller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const as = { ann: session("ann"), bea: session("bea"), pat: session("pat"), zed: session("zed") };
const environmentId = EnvironmentId.make("env-local");
const web = ProjectId.make("project-web");
const api = ProjectId.make("project-api");

/** An enterprise workspace with admin `ann`, member `bea` (lead of `api`), and two bound projects. */
const setup = (kind: "enterprise" | "personal" = "enterprise") =>
  Effect.gen(function* () {
    const workspaces = yield* WorkspaceService.WorkspaceService;
    const workspace = yield* workspaces.create(as.ann, { kind, name: "Acme", displayName: "Ann" });
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
    return { workspaceId, beaId: bea.subjectId, agents: yield* AgentService.AgentService };
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

it.layer(fileLayer)("Telescope agents on a file database", (it) => {
  it.effect("lazily creates one Chief of Staff and one Chief Agent per bound project, once", () =>
    Effect.gen(function* () {
      const { workspaceId, beaId, agents } = yield* setup();
      const [first, ...rest] = yield* Effect.all(
        Array.from({ length: 8 }, () => agents.listMine(as.bea, { workspaceId })),
        { concurrency: "unbounded" },
      );
      assert.isDefined(first);
      assert.strictEqual(first.agents[0]?.name, "Chief of Staff");
      assert.deepStrictEqual(
        first.agents.map((a) => `${a.ownerSubjectId}/${a.kind}/${a.name}`).toSorted(),
        [
          `${beaId}/chief_agent/project-api Chief Agent`,
          `${beaId}/chief_agent/project-web Chief Agent`,
          `${beaId}/chief_of_staff/Chief of Staff`,
        ],
      );
      for (const other of rest)
        assert.deepStrictEqual(
          other.agents.map((a) => a.id).toSorted(),
          first.agents.map((a) => a.id).toSorted(),
        );
      const companies = yield* Effect.all(
        Array.from({ length: 8 }, () => agents.listCompany(as.ann, { workspaceId })),
        { concurrency: "unbounded" },
      );
      assert.deepStrictEqual(
        companies.map(({ agents }) => agents.length),
        Array.from({ length: 8 }, () => 6),
      );

      const custom = yield* agents.createCustom(as.bea, {
        workspaceId,
        name: "Reviewer",
        projectId: web,
      });
      const third = yield* agents.listMine(as.bea, { workspaceId });
      assert.deepStrictEqual(
        third.agents.map((a) => a.id),
        [...first.agents.map((a) => a.id), custom.id],
      );
      assert.strictEqual((yield* agents.listMine(as.ann, { workspaceId })).agents.length, 3);
      assert.strictEqual(
        yield* reasonOf(agents.listMine(as.zed, { workspaceId })),
        "forbidden",
        "non-members get no agents",
      );
    }),
  );
});

it.layer(layer)("Telescope agents", (it) => {
  it.effect("caps standing powers by the owner's role and keeps settings to the owner", () =>
    Effect.gen(function* () {
      const { workspaceId, agents } = yield* setup();
      const bea = (yield* agents.listMine(as.bea, { workspaceId })).agents;
      const ann = (yield* agents.listMine(as.ann, { workspaceId })).agents;
      const merge = {
        openTickets: true,
        dispatchWorkers: true,
        answerMembers: true,
        mergePRs: true,
      };

      const webAgent = chiefAgent(bea, web);
      assert.strictEqual(
        yield* reasonOf(
          agents.update(as.bea, { workspaceId, agentId: webAgent.id, standingPowers: merge }),
        ),
        "forbidden",
        "a member cannot let their Chief Agent merge PRs",
      );
      const apiAgent = chiefAgent(bea, api);
      const lead = yield* agents.update(as.bea, {
        workspaceId,
        agentId: apiAgent.id,
        standingPowers: merge,
      });
      assert.isTrue(lead.standingPowers.mergePRs, "the project lead can");
      const admin = yield* agents.update(as.ann, {
        workspaceId,
        agentId: chiefAgent(ann, web).id,
        standingPowers: merge,
        name: "Ann's web agent",
      });
      assert.deepStrictEqual(
        [admin.standingPowers.mergePRs, admin.name],
        [true, "Ann's web agent"],
      );

      const { card } = yield* agents.get(as.ann, { workspaceId, agentId: admin.id });
      assert.include(card.requiredPermissions, "mergePRs");

      const workspaces = yield* WorkspaceService.WorkspaceService;
      const { code } = yield* workspaces.invite(as.ann, { workspaceId, role: "project_lead" });
      yield* workspaces.accept(as.pat, { code, displayName: "Pat" });
      const pat = (yield* agents.listMine(as.pat, { workspaceId })).agents;
      for (const agent of [chiefAgent(pat, api), pat[0]]) {
        assert.isDefined(agent);
        assert.strictEqual(
          yield* reasonOf(
            agents.update(as.pat, { workspaceId, agentId: agent.id, standingPowers: merge }),
          ),
          "forbidden",
          `the project_lead role alone grants nothing on ${agent.kind}`,
        );
      }

      yield* workspaces.bind(as.ann, { workspaceId, environmentId, projectId: api });
      const demoted = yield* agents.get(as.bea, { workspaceId, agentId: apiAgent.id });
      assert.deepStrictEqual(
        [demoted.agent.standingPowers.mergePRs, demoted.effectivePowers.mergePRs],
        [true, false],
        "a lead who loses the project loses the power, though the flag stays stored",
      );
      assert.notInclude(demoted.card.requiredPermissions, "mergePRs");

      assert.strictEqual(
        yield* reasonOf(agents.update(as.ann, { workspaceId, agentId: webAgent.id, name: "Mine" })),
        "not_found",
        "another member's hidden agent is not even visible",
      );
      yield* agents.update(as.bea, { workspaceId, agentId: webAgent.id, exposure: "visible" });
      assert.strictEqual(
        yield* reasonOf(agents.update(as.ann, { workspaceId, agentId: webAgent.id, name: "Mine" })),
        "forbidden",
      );
    }),
  );

  it.effect("opens exposure one level at a time and lowers it to any level", () =>
    Effect.gen(function* () {
      const { workspaceId, agents } = yield* setup();
      const [assistant] = (yield* agents.listMine(as.bea, { workspaceId })).agents;
      assert.isDefined(assistant);
      const set = (exposure: Telescope.AgentExposure) =>
        agents.update(as.bea, { workspaceId, agentId: assistant.id, exposure });

      assert.strictEqual(assistant.exposure, "hidden");
      assert.strictEqual(yield* reasonOf(set("contactable")), "forbidden");
      for (const level of ["visible", "contactable", "dispatchable"] as const)
        assert.strictEqual((yield* set(level)).exposure, level);
      assert.strictEqual((yield* set("hidden")).exposure, "hidden");
      assert.strictEqual(yield* reasonOf(set("contactable")), "forbidden");

      const personal = yield* setup("personal");
      const [own] = (yield* agents.listMine(as.bea, { workspaceId: personal.workspaceId })).agents;
      assert.isDefined(own);
      const open = (exposure: Telescope.AgentExposure) =>
        agents.update(as.bea, { workspaceId: personal.workspaceId, agentId: own.id, exposure });
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
      const { workspaceId, beaId, agents } = yield* setup();
      const [assistant] = (yield* agents.listMine(as.bea, { workspaceId })).agents;
      assert.isDefined(assistant);
      const companyView = () =>
        agents
          .listCompany(as.ann, { workspaceId })
          .pipe(Effect.map(({ agents }) => agents.map((a) => a.id)));
      const [main, department] = (yield* agents.listCompany(as.ann, { workspaceId })).agents;
      assert.isDefined(main);
      assert.isDefined(department);
      const reach = (
        target: Telescope.Agent,
        mode: "contact" | "dispatch",
        sender: Telescope.Agent = main,
      ) => agents.companyRecipient(workspaceId, target.id, mode, sender.id);
      const open = (target: Telescope.Agent, exposure: Telescope.AgentExposure) =>
        agents.update(as.bea, { workspaceId, agentId: target.id, exposure });

      assert.strictEqual(department.exposure, "hidden");
      assert.strictEqual((yield* reach(department, "contact")).id, department.id);
      assert.strictEqual((yield* reach(department, "dispatch")).id, department.id);
      assert.strictEqual(yield* reasonOf(reach(main, "dispatch", department)), "forbidden");
      assert.strictEqual(
        yield* reasonOf(reach(department, "contact", assistant)),
        "forbidden",
        "personal agents are not company senders",
      );

      assert.notInclude(yield* companyView(), assistant.id);
      assert.strictEqual(yield* reasonOf(reach(assistant, "contact")), "not_found");

      yield* open(assistant, "visible");
      assert.include(yield* companyView(), assistant.id);
      assert.strictEqual(yield* reasonOf(reach(assistant, "contact")), "forbidden");

      yield* open(assistant, "contactable");
      assert.strictEqual((yield* reach(assistant, "contact", department)).id, assistant.id);
      assert.strictEqual(yield* reasonOf(reach(assistant, "dispatch")), "forbidden");

      yield* open(assistant, "dispatchable");
      assert.strictEqual((yield* reach(assistant, "dispatch")).id, assistant.id);
      assert.strictEqual(
        yield* reasonOf(reach(assistant, "dispatch", department)),
        "forbidden",
        "only the 主代理 dispatches",
      );

      const webAgent = chiefAgent((yield* agents.listMine(as.bea, { workspaceId })).agents, web);
      yield* open(webAgent, "visible");
      yield* open(webAgent, "contactable");
      assert.include(yield* companyView(), webAgent.id);
      const workspaces = yield* WorkspaceService.WorkspaceService;
      yield* workspaces.unbind(as.ann, { workspaceId, environmentId, projectId: web });
      assert.notInclude(yield* companyView(), webAgent.id, "unbound projects take their agent");
      assert.strictEqual(yield* reasonOf(reach(webAgent, "contact")), "not_found");

      yield* workspaces.revoke(as.ann, { workspaceId, subjectId: beaId });
      assert.notInclude(yield* companyView(), assistant.id, "agents leave with their owner");
      assert.strictEqual(yield* reasonOf(reach(assistant, "dispatch")), "not_found");
      const hide = (exposure: Telescope.AgentExposure, name?: string) =>
        agents.update(as.ann, {
          workspaceId,
          agentId: assistant.id,
          exposure,
          ...(name === undefined ? {} : { name }),
        });
      assert.strictEqual(yield* reasonOf(hide("visible")), "forbidden");
      assert.strictEqual(
        yield* reasonOf(hide("hidden", "Mine")),
        "forbidden",
        "an admin can only close a former member's agent",
      );
      assert.strictEqual((yield* hide("hidden")).exposure, "hidden");
    }),
  );

  it.effect("lets only admins configure company agents, which exist only in enterprises", () =>
    Effect.gen(function* () {
      const { workspaceId, agents } = yield* setup();
      const company = (yield* agents.listCompany(as.bea, { workspaceId })).agents;
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
      assert.strictEqual((yield* agents.listCompany(as.ann, { workspaceId })).agents.length, 6);

      const department = company[1];
      assert.isDefined(department);
      const rename = (caller: WorkspaceService.Caller) =>
        agents.updateCompany(caller, { workspaceId, agentId: department.id, name: "HR" });
      assert.strictEqual(yield* reasonOf(rename(as.bea)), "forbidden");
      assert.strictEqual(
        yield* reasonOf(agents.update(as.bea, { workspaceId, agentId: department.id, name: "HR" })),
        "not_found",
      );
      assert.strictEqual((yield* rename(as.ann)).name, "HR");

      const personal = yield* setup("personal");
      assert.strictEqual(
        yield* reasonOf(agents.listCompany(as.ann, { workspaceId: personal.workspaceId })),
        "forbidden",
      );
    }),
  );
});
