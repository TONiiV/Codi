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
const decodeMembers = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      subject_id: Schema.String,
      role: Telescope.WorkspaceRole,
      revoked_at: Schema.NullOr(Schema.String),
    }),
  ),
);
const decodeBindings = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({ project_id: ProjectId, lead_subject_id: Schema.NullOr(Schema.String) }),
  ),
);

/** Active members' roles and each bound project's lead, read fresh for every check. */
interface Ownership {
  readonly roles: ReadonlyMap<string, Telescope.WorkspaceRole>;
  readonly leads: ReadonlyMap<ProjectId, string | null>;
}

const canMergePRs = (ownership: Ownership, owner: string, projectId: ProjectId | undefined) =>
  ownership.roles.get(owner) === "admin" ||
  (projectId !== undefined && ownership.leads.get(projectId) === owner);

/** Agents of former members, and Chief Agents of unbound projects, are out of reach. */
const reachable = (ownership: Ownership, agent: Telescope.Agent) =>
  agent.ownerSubjectId === null ||
  (ownership.roles.has(agent.ownerSubjectId) &&
    (agent.kind !== "chief_agent" ||
      (agent.projectId !== undefined && ownership.leads.has(agent.projectId))));

const NO_POWERS: Telescope.StandingPowers = {
  openTickets: false,
  dispatchWorkers: false,
  answerMembers: false,
  mergePRs: false,
};

/** Stored powers capped by what the owner's current role still allows. */
const effectivePowers = (
  ownership: Ownership,
  agent: Telescope.Agent,
): Telescope.StandingPowers => {
  const owner = agent.ownerSubjectId;
  if (owner === null) return agent.standingPowers;
  if (!ownership.roles.has(owner)) return NO_POWERS;
  const { mergePRs } = agent.standingPowers;
  return {
    ...agent.standingPowers,
    mergePRs: mergePRs && canMergePRs(ownership, owner, agent.projectId),
  };
};

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
const agentCard = (
  agent: Telescope.Agent,
  powers: Telescope.StandingPowers,
): Telescope.AgentCard => {
  const skills = POWER_SKILLS.filter(([power]) => powers[power]);
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

type Caller = WorkspaceService.Caller;
type AgentId = Telescope.Agent["id"];
type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;
type Rpcs = (typeof Telescope.AgentRpcs)[number];
type In<Tag extends Rpcs["_tag"]> = Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>;
type Method<Tag extends Rpcs["_tag"]> = (
  caller: Caller,
  input: In<Tag>,
) => Effect.Effect<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>, Failure>;

/** Personal and company agents. `caller` is the auth session; agents are owned by member ids. */
export class AgentService extends Context.Service<
  AgentService,
  {
    readonly listMine: Method<"telescope.agent.listMine">;
    readonly get: Method<"telescope.agent.get">;
    readonly createCustom: Method<"telescope.agent.createCustom">;
    readonly update: Method<"telescope.agent.update">;
    readonly listCompany: Method<"telescope.agent.listCompany">;
    readonly updateCompany: Method<"telescope.agent.updateCompany">;
    /**
     * The gate for a company agent reaching an agent. Only the 主代理 dispatches; personal
     * agents answer as missing while hidden or out of reach.
     */
    readonly companyRecipient: (
      workspaceId: Telescope.WorkspaceId,
      agentId: AgentId,
      mode: "contact" | "dispatch",
      senderAgentId: AgentId,
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
    ownerSubjectId: string | null,
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

  const ownershipOf = (workspaceId: Telescope.WorkspaceId) =>
    Effect.all([
      db.select(workspaceId, "members", decodeMembers, { revoked_at: null }),
      db.select(workspaceId, "project_bindings", decodeBindings),
    ]).pipe(
      Effect.map(([members, bindings]): Ownership => ({
        roles: new Map(members.map((member) => [member.subject_id, member.role])),
        leads: new Map(bindings.map((binding) => [binding.project_id, binding.lead_subject_id])),
      })),
    );

  // Projects on other environments have no local title; their id stands in.
  const projectTitles = (projectIds: ReadonlyArray<ProjectId>) =>
    projects.list({ projectIds }).pipe(
      Effect.map((rows) => new Map(rows.map((row) => [row.projectId, row.title]))),
      Effect.mapError(
        () =>
          new Telescope.WorkspaceError({
            reason: "storage",
            message: "Project titles are unavailable.",
          }),
      ),
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
    const { self } = yield* workspaces.get(caller, { workspaceId });
    const owner = self.subjectId;
    const bound = yield* boundProjectIds(caller, workspaceId);
    return yield* db.transaction(
      Effect.gen(function* () {
        const rows = yield* db.select(workspaceId, "agents", decodeAgents, {
          owner_subject_id: owner,
        });
        const mine = rows.map(toAgent);
        const at = yield* now;
        const created: Array<Telescope.Agent> = [];
        if (!mine.some((agent) => agent.kind === "chief_of_staff"))
          created.push(yield* newAgent(workspaceId, owner, "chief_of_staff", "Chief of Staff", at));
        const covered = new Set(
          mine.flatMap((agent) => (agent.kind === "chief_agent" ? [agent.projectId] : [])),
        );
        const uncovered = [...new Set(bound)].filter((projectId) => !covered.has(projectId));
        const titles = uncovered.length === 0 ? new Map() : yield* projectTitles(uncovered);
        for (const projectId of uncovered) {
          const name = `${titles.get(projectId) ?? projectId} Chief Agent`;
          created.push(yield* newAgent(workspaceId, owner, "chief_agent", name, at, { projectId }));
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
    const { self } = yield* workspaces.get(caller, input);
    const agent = yield* findAgent(input.workspaceId, input.agentId);
    if (agent === undefined) return yield* notFound();
    const ownership = yield* ownershipOf(input.workspaceId);
    const visible =
      agent.ownerSubjectId === null ||
      agent.ownerSubjectId === self.subjectId ||
      (agent.exposure !== "hidden" && reachable(ownership, agent));
    if (!visible) return yield* notFound();
    const powers = effectivePowers(ownership, agent);
    return { agent, effectivePowers: powers, card: agentCard(agent, powers) };
  });

  const createCustom = Effect.fn("AgentService.createCustom")(function* (
    caller: Caller,
    { workspaceId, name, ...extra }: In<"telescope.agent.createCustom">,
  ) {
    const { self } = yield* workspaces.get(caller, { workspaceId });
    const bound = yield* boundProjectIds(caller, workspaceId);
    if (extra.projectId !== undefined && !bound.includes(extra.projectId))
      return yield* fail("not_found", "That project is not bound to this workspace.");
    const agent = yield* newAgent(workspaceId, self.subjectId, "custom", name, yield* now, extra);
    yield* insertAll(workspaceId, [agent]);
    return agent;
  });

  const update = Effect.fn("AgentService.update")(function* (
    caller: Caller,
    input: In<"telescope.agent.update">,
  ) {
    const { workspace, self } = yield* workspaces.get(caller, input);
    return yield* db.transaction(
      Effect.gen(function* () {
        const agent = yield* findAgent(input.workspaceId, input.agentId);
        if (agent === undefined || agent.ownerSubjectId === null) return yield* notFound();
        const ownership = yield* ownershipOf(input.workspaceId);
        if (agent.ownerSubjectId !== self.subjectId) {
          const former = !ownership.roles.has(agent.ownerSubjectId);
          if (former && self.role === "admin") {
            const { workspaceId: _, agentId: __, ...patch } = input;
            if (patch.exposure !== "hidden" || Object.keys(patch).length !== 1)
              return yield* fail("forbidden", "Admins can only hide a former member's agent.");
            return yield* writeAgent(agent, input);
          }
          return yield* agent.exposure === "hidden" || former
            ? notFound()
            : fail("forbidden", "Only the owner can change this agent.");
        }
        if (
          input.standingPowers?.mergePRs === true &&
          !canMergePRs(ownership, self.subjectId, agent.projectId)
        )
          return yield* fail("forbidden", "Your role in this project cannot merge PRs.");
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
        const ownership = yield* ownershipOf(input.workspaceId);
        const agents = [...all, ...created].filter(
          (agent) =>
            agent.ownerSubjectId === null ||
            (agent.exposure !== "hidden" && reachable(ownership, agent)),
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
    mode: "contact" | "dispatch",
    senderAgentId: AgentId,
  ) {
    const sender = yield* findAgent(workspaceId, senderAgentId);
    if (sender === undefined || sender.ownerSubjectId !== null)
      return yield* fail("forbidden", "Only company agents reach agents through this gate.");
    if (mode === "dispatch" && sender.kind !== "company_main")
      return yield* fail("forbidden", "Only the 主代理 dispatches agents.");
    const agent = yield* findAgent(workspaceId, agentId);
    if (agent === undefined) return yield* notFound();
    if (agent.ownerSubjectId === null) return agent;
    const ownership = yield* ownershipOf(workspaceId);
    if (agent.exposure === "hidden" || !reachable(ownership, agent)) return yield* notFound();
    const needed = mode === "dispatch" ? "dispatchable" : "contactable";
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
