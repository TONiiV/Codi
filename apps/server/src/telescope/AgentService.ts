import { ModelSelection, ProjectId, Telescope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const AgentRow = Schema.Struct({
  agent_id: Telescope.AgentId,
  workspace_id: Telescope.WorkspaceId,
  owner_subject_id: Schema.NullOr(Schema.String),
  kind: Telescope.AgentKind,
  project_id: Schema.NullOr(ProjectId),
  name: Schema.String,
  model_selection_json: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
  standing_powers_json: Schema.fromJsonString(Telescope.StandingPowers),
  exposure: Telescope.AgentExposure,
  sync_with_board: Schema.BooleanFromBit,
  dispatch_mode: Telescope.AgentDispatchMode,
  channels_json: Schema.fromJsonString(Schema.Array(Telescope.Channel)),
  created_at: Schema.String,
  updated_at: Schema.String,
});
const decodeAgents = Schema.decodeUnknownEffect(Schema.Array(AgentRow));

const toAgent = (row: typeof AgentRow.Type): Telescope.Agent => ({
  id: row.agent_id,
  workspaceId: row.workspace_id,
  ownerSubjectId: row.owner_subject_id,
  kind: row.kind,
  ...(row.project_id === null ? {} : { projectId: row.project_id }),
  name: row.name,
  ...(row.model_selection_json === null ? {} : { modelSelection: row.model_selection_json }),
  standingPowers: row.standing_powers_json,
  exposure: row.exposure,
  syncWithBoard: row.sync_with_board,
  dispatchMode: row.dispatch_mode,
  channels: row.channels_json,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const toRow = (agent: Telescope.Agent) => ({
  agent_id: agent.id,
  owner_subject_id: agent.ownerSubjectId,
  kind: agent.kind,
  project_id: agent.projectId ?? null,
  name: agent.name,
  model_selection_json:
    agent.modelSelection === undefined ? null : JSON.stringify(agent.modelSelection),
  standing_powers_json: JSON.stringify(agent.standingPowers),
  exposure: agent.exposure,
  sync_with_board: agent.syncWithBoard ? 1 : 0,
  dispatch_mode: agent.dispatchMode,
  channels_json: JSON.stringify(agent.channels),
  created_at: agent.createdAt,
  updated_at: agent.updatedAt,
});

const DEFAULT_POWERS: Telescope.StandingPowers = {
  openTickets: true,
  dispatchWorkers: false,
  answerMembers: true,
  mergePRs: false,
};
const COMPANY_MAIN_NAME = "主代理";
const DEPARTMENT_NAMES = ["人事", "财务", "法务", "IT", "行政"];
const KIND_ORDER = Telescope.AgentKind.literals;
const EXPOSURE_ORDER = Telescope.AgentExposure.literals;
const exposureRank = (exposure: Telescope.AgentExposure) => EXPOSURE_ORDER.indexOf(exposure);

const KIND_DESCRIPTIONS: Record<Telescope.AgentKind, string> = {
  chief_of_staff: "个人助理",
  chief_agent: "项目 Chief Agent",
  custom: "自定义 agent",
  company_main: "主代理，负责路由和总台",
  department: "职能代理",
};
const POWER_SKILLS = [
  ["openTickets", "开工单", "在任务板上开工单"],
  ["dispatchWorkers", "派 worker", "把工单派给 worker 执行"],
  ["answerMembers", "回答成员", "回答其他成员的提问"],
  ["mergePRs", "合并 PR", "合并已通过审查的 PR"],
] as const;

/** The A2A Agent Card for an agent, derived from its row. */
const agentCard = (agent: Telescope.Agent): Telescope.AgentCard => {
  const skills = POWER_SKILLS.filter(([power]) => agent.standingPowers[power]);
  return {
    name: agent.name,
    description: KIND_DESCRIPTIONS[agent.kind],
    capabilities: { streaming: false, pushNotifications: false },
    skills: skills.map(([id, name, description]) => ({
      id,
      name,
      description,
      tags: [agent.kind],
    })),
    requiredPermissions: skills.map(([power]) => power),
    channels: agent.channels,
  };
};

const fail = (reason: Telescope.WorkspaceError["reason"], message: string) =>
  Effect.fail(new Telescope.WorkspaceError({ reason, message }));
const notFound = () => fail("not_found", "Agent not found.");

type Caller = Telescope.SubjectId;
type AgentId = Telescope.Agent["id"];
type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;
type Rpcs = (typeof Telescope.AgentRpcs)[number];
type In<Tag extends Rpcs["_tag"]> = Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>;
type Method<Tag extends Rpcs["_tag"]> = (
  caller: Caller,
  input: In<Tag>,
) => Effect.Effect<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>, Failure>;

/** Personal and company agents. `caller` is the session subject. */
export class AgentService extends Context.Service<
  AgentService,
  {
    readonly listMine: Method<"telescope.agent.listMine">;
    readonly get: Method<"telescope.agent.get">;
    readonly createCustom: Method<"telescope.agent.createCustom">;
    readonly update: Method<"telescope.agent.update">;
    readonly listCompany: Method<"telescope.agent.listCompany">;
    readonly updateCompany: Method<"telescope.agent.updateCompany">;
    /** The gate for a company agent reaching an agent; hidden agents answer as missing. */
    readonly companyRecipient: (
      workspaceId: Telescope.WorkspaceId,
      agentId: AgentId,
      intent: "contact" | "dispatch",
    ) => Effect.Effect<Telescope.Agent, Failure>;
  }
>()("t3/telescope/AgentService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const random = yield* SecureRandom.SecureRandom;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const newAgent = (
    workspaceId: Telescope.WorkspaceId,
    ownerSubjectId: Caller | null,
    kind: Telescope.AgentKind,
    name: string,
    at: string,
    extra: Pick<Telescope.Agent, "projectId" | "modelSelection"> = {},
  ) =>
    random.uuidV4().pipe(
      Effect.map((id): Telescope.Agent => ({
        id: Telescope.AgentId.make(id),
        workspaceId,
        ownerSubjectId,
        kind,
        ...extra,
        name,
        standingPowers: DEFAULT_POWERS,
        exposure: "hidden",
        syncWithBoard: kind === "chief_agent",
        dispatchMode: "inbox",
        channels: [],
        createdAt: at,
        updatedAt: at,
      })),
    );

  const insertAll = (workspaceId: Telescope.WorkspaceId, agents: ReadonlyArray<Telescope.Agent>) =>
    Effect.forEach(agents, (agent) => db.insert(workspaceId, "agents", toRow(agent)), {
      discard: true,
    });

  const findAgent = (workspaceId: Telescope.WorkspaceId, agentId: AgentId) =>
    db
      .select(workspaceId, "agents", decodeAgents, { agent_id: agentId })
      .pipe(Effect.map((rows) => (rows[0] === undefined ? undefined : toAgent(rows[0]))));

  const boundProjectIds = (caller: Caller, workspaceId: Telescope.WorkspaceId) =>
    workspaces
      .bindings(caller, { workspaceId })
      .pipe(Effect.map(({ bindings }) => bindings.map((binding) => binding.projectId)));

  // Projects on other environments have no local title; their id stands in.
  const projectTitles = (projectIds: ReadonlyArray<ProjectId>) =>
    projects.list({ projectIds }).pipe(
      Effect.map((rows) => new Map(rows.map((row) => [row.projectId, row.title]))),
      Effect.orElseSucceed(() => new Map<ProjectId, string>()),
    );

  const writeAgent = Effect.fn("AgentService.writeAgent")(function* (
    agent: Telescope.Agent,
    { workspaceId: _, agentId: __, ...patch }: Telescope.AgentUpdateInput,
  ) {
    const next: Telescope.Agent = { ...agent, ...patch, updatedAt: yield* now };
    yield* db.update(agent.workspaceId, "agents", toRow(next), { agent_id: agent.id });
    return next;
  });

  const listMine = Effect.fn("AgentService.listMine")(function* (
    caller: Caller,
    { workspaceId }: In<"telescope.agent.listMine">,
  ) {
    const bound = yield* boundProjectIds(caller, workspaceId);
    return yield* db.transaction(
      Effect.gen(function* () {
        const rows = yield* db.select(workspaceId, "agents", decodeAgents, {
          owner_subject_id: caller,
        });
        const mine = rows.map(toAgent);
        const at = yield* now;
        const created: Array<Telescope.Agent> = [];
        if (!mine.some((agent) => agent.kind === "chief_of_staff"))
          created.push(
            yield* newAgent(workspaceId, caller, "chief_of_staff", "Chief of Staff", at),
          );
        const covered = new Set(
          mine.flatMap((agent) => (agent.kind === "chief_agent" ? [agent.projectId] : [])),
        );
        const uncovered = [...new Set(bound)].filter((projectId) => !covered.has(projectId));
        const titles = uncovered.length === 0 ? new Map() : yield* projectTitles(uncovered);
        for (const projectId of uncovered) {
          const name = `${titles.get(projectId) ?? projectId} Chief Agent`;
          created.push(
            yield* newAgent(workspaceId, caller, "chief_agent", name, at, { projectId }),
          );
        }
        yield* insertAll(workspaceId, created);
        const agents = [...mine, ...created]
          .filter(
            (agent) =>
              agent.kind !== "chief_agent" ||
              (agent.projectId !== undefined && bound.includes(agent.projectId)),
          )
          .toSorted(
            (a, b) =>
              KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
              a.createdAt.localeCompare(b.createdAt),
          );
        return { agents };
      }),
    );
  });

  const get = Effect.fn("AgentService.get")(function* (
    caller: Caller,
    input: In<"telescope.agent.get">,
  ) {
    yield* workspaces.get(caller, input);
    const agent = yield* findAgent(input.workspaceId, input.agentId);
    const visible =
      agent !== undefined &&
      (agent.ownerSubjectId === null ||
        agent.ownerSubjectId === caller ||
        agent.exposure !== "hidden");
    if (!visible) return yield* notFound();
    return { agent, card: agentCard(agent) };
  });

  const createCustom = Effect.fn("AgentService.createCustom")(function* (
    caller: Caller,
    { workspaceId, name, ...extra }: In<"telescope.agent.createCustom">,
  ) {
    const bound = yield* boundProjectIds(caller, workspaceId);
    if (extra.projectId !== undefined && !bound.includes(extra.projectId))
      return yield* fail("not_found", "That project is not bound to this workspace.");
    const agent = yield* newAgent(workspaceId, caller, "custom", name, yield* now, extra);
    yield* insertAll(workspaceId, [agent]);
    return agent;
  });

  const update = Effect.fn("AgentService.update")(function* (
    caller: Caller,
    input: In<"telescope.agent.update">,
  ) {
    const { workspace, self } = yield* workspaces.get(caller, input);
    const { bindings } = yield* workspaces.bindings(caller, input);
    return yield* db.transaction(
      Effect.gen(function* () {
        const agent = yield* findAgent(input.workspaceId, input.agentId);
        if (agent === undefined || agent.ownerSubjectId === null) return yield* notFound();
        if (agent.ownerSubjectId !== caller)
          return yield* agent.exposure === "hidden"
            ? notFound()
            : fail("forbidden", "Only the owner can change this agent.");
        if (input.standingPowers?.mergePRs === true) {
          const lead = bindings.some(
            (binding) => binding.projectId === agent.projectId && binding.leadSubjectId === caller,
          );
          if (self.role !== "admin" && self.role !== "project_lead" && !lead)
            return yield* fail("forbidden", "Your role in this project cannot merge PRs.");
        }
        if (input.exposure !== undefined) {
          if (exposureRank(input.exposure) > exposureRank(agent.exposure) + 1)
            return yield* fail("forbidden", "Exposure opens one level at a time.");
          if (input.exposure === "dispatchable" && workspace.kind === "personal")
            return yield* fail("forbidden", "Personal workspaces have no dispatchable agents.");
        }
        return yield* writeAgent(agent, input);
      }),
    );
  });

  const listCompany = Effect.fn("AgentService.listCompany")(function* (
    caller: Caller,
    input: In<"telescope.agent.listCompany">,
  ) {
    const { workspace } = yield* workspaces.get(caller, input);
    if (workspace.kind !== "enterprise")
      return yield* fail("forbidden", "Company agents exist only in enterprise workspaces.");
    return yield* db.transaction(
      Effect.gen(function* () {
        const rows = yield* db.select(input.workspaceId, "agents", decodeAgents);
        const all = rows.map(toAgent);
        const created: Array<Telescope.Agent> = [];
        if (!all.some((agent) => agent.kind === "company_main")) {
          const at = yield* now;
          created.push(
            yield* newAgent(input.workspaceId, null, "company_main", COMPANY_MAIN_NAME, at),
          );
          for (const name of DEPARTMENT_NAMES)
            created.push(yield* newAgent(input.workspaceId, null, "department", name, at));
          yield* insertAll(input.workspaceId, created);
        }
        const agents = [...all, ...created].filter(
          (agent) => agent.ownerSubjectId === null || agent.exposure !== "hidden",
        );
        return { agents };
      }),
    );
  });

  const updateCompany = Effect.fn("AgentService.updateCompany")(function* (
    caller: Caller,
    input: In<"telescope.agent.updateCompany">,
  ) {
    const { self } = yield* workspaces.get(caller, input);
    if (self.role !== "admin")
      return yield* fail("forbidden", "Only workspace admins can configure company agents.");
    return yield* db.transaction(
      Effect.gen(function* () {
        const agent = yield* findAgent(input.workspaceId, input.agentId);
        if (agent === undefined || agent.ownerSubjectId !== null) return yield* notFound();
        return yield* writeAgent(agent, input);
      }),
    );
  });

  const companyRecipient = Effect.fn("AgentService.companyRecipient")(function* (
    workspaceId: Telescope.WorkspaceId,
    agentId: AgentId,
    intent: "contact" | "dispatch",
  ) {
    const agent = yield* findAgent(workspaceId, agentId);
    if (agent === undefined || agent.exposure === "hidden") return yield* notFound();
    if (agent.ownerSubjectId === null) return agent;
    const needed = intent === "dispatch" ? "dispatchable" : "contactable";
    if (exposureRank(agent.exposure) < exposureRank(needed))
      return yield* fail("forbidden", `This agent is not ${needed} by company agents.`);
    return agent;
  });

  return AgentService.of({
    listMine,
    get,
    createCustom,
    update,
    listCompany,
    updateCompany,
    companyRecipient,
  });
});

export const layer = Layer.effect(AgentService, make).pipe(
  Layer.provide(Layer.mergeAll(TelescopeDb.layer, WorkspaceService.layer, ProjectStore.layer)),
);
