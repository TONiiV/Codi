import { ProjectId, Telescope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/sql/SqlClient";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as AgentService from "./AgentService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const DEFAULT_AUDIT_LIMIT = 50;

const decodeMembers = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ role: Telescope.WorkspaceRole })),
);
const decodeBindings = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ lead_subject_id: Schema.NullOr(Schema.String) })),
);
const PowersJson = Schema.fromJsonString(Telescope.StandingPowers);
const decodeRules = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ powers_json: PowersJson })),
);
const encodePowers = Schema.encodeSync(PowersJson);
const AuditRow = Schema.Struct({
  audit_id: Telescope.AuditEntryId,
  workspace_id: Telescope.WorkspaceId,
  run_id: Schema.NullOr(Telescope.AgentRunId),
  agent_id: Telescope.AgentId,
  on_behalf_of_json: Schema.fromJsonString(Telescope.OnBehalfOf),
  project_id: Schema.NullOr(ProjectId),
  power: Telescope.GrantPower,
  tool: Schema.NullOr(Telescope.Text),
  args_redacted_json: Schema.NullOr(Schema.fromJsonString(Schema.Json)),
  outcome: Telescope.AuditOutcome,
  reason: Schema.NullOr(Schema.String),
  created_at: Schema.String,
});
const decodeAudit = Schema.decodeUnknownEffect(Schema.Array(AuditRow));
// The repository writes workspace_id itself and refuses rows that carry it. Encoding checks the
// contract's non-blank `tool` and `onBehalfOf`, so a bad row dies here instead of poisoning the list.
const encodeAudit = Schema.encodeSync(AuditRow.mapFields(Struct.omit(["workspace_id"])));

const toAuditEntry = (row: typeof AuditRow.Type): Telescope.AuditEntry => ({
  id: row.audit_id,
  workspaceId: row.workspace_id,
  agentId: row.agent_id,
  onBehalfOf: row.on_behalf_of_json,
  power: row.power,
  outcome: row.outcome,
  createdAt: row.created_at,
  ...(row.run_id === null ? {} : { runId: row.run_id }),
  ...(row.project_id === null ? {} : { projectId: row.project_id }),
  ...(row.tool === null ? {} : { tool: row.tool }),
  ...(row.args_redacted_json === null ? {} : { argsRedacted: row.args_redacted_json }),
  ...(row.reason === null ? {} : { reason: row.reason }),
});

const NO_POWERS: Telescope.StandingPowers = {
  openTickets: false,
  dispatchWorkers: false,
  answerMembers: false,
  mergePRs: false,
};
// Every role holds the everyday powers; merging needs admin or the project's lead (D25).
const rolePowers = (role: Telescope.WorkspaceRole, isLead: boolean): Telescope.StandingPowers => ({
  openTickets: true,
  dispatchWorkers: true,
  answerMembers: true,
  mergePRs: role === "admin" || isLead,
});

interface GrantLayer {
  readonly layer: Telescope.GrantLayer;
  readonly agentId?: Telescope.AgentId;
  readonly powers: Telescope.StandingPowers;
  readonly reason: string;
}

/**
 * `onBehalfOf` is the member id, then each agent that delegated down to `agentId`. A project-bound
 * agent is evaluated in its own project; any other `projectId` is a `conflict`.
 */
export interface GrantRequest {
  readonly agentId: Telescope.AgentId;
  readonly projectId?: ProjectId;
  readonly onBehalfOf: readonly [memberId: string, ...via: ReadonlyArray<Telescope.AgentId>];
}
export interface ProjectRuleInput {
  readonly workspaceId: Telescope.WorkspaceId;
  readonly projectId: ProjectId;
  readonly powers: Telescope.StandingPowers;
}
export interface AuditInput {
  readonly runId?: Telescope.AgentRunId;
  readonly agentId: Telescope.AgentId;
  readonly onBehalfOf: typeof Telescope.OnBehalfOf.Type;
  readonly projectId?: ProjectId;
  readonly power: Telescope.GrantPower;
  readonly tool?: typeof Telescope.Text.Type;
  readonly argsRedacted?: Schema.Json;
  readonly outcome: Telescope.AuditEntry["outcome"];
  readonly reason?: string;
}

const fail = (reason: Telescope.WorkspaceError["reason"], message: string) =>
  Effect.fail(new Telescope.WorkspaceError({ reason, message }));

type Caller = WorkspaceService.Caller;
type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;
type Out<A> = Effect.Effect<A, Failure>;
type Rpcs = (typeof Telescope.GrantRpcs)[number];
type Method<Tag extends Rpcs["_tag"]> = (
  caller: Caller,
  input: Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>,
) => Out<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>>;

/**
 * Grants: the member's role ∩ each delegating agent's standing powers ∩ the project rule, so a
 * delegate never holds more than its delegator. Every check is computed fresh from the tables.
 */
export class GrantService extends Context.Service<
  GrantService,
  {
    readonly effectiveGrant: (
      workspaceId: Telescope.WorkspaceId,
      request: GrantRequest,
    ) => Out<Telescope.EffectiveGrant>;
    readonly explain: (
      workspaceId: Telescope.WorkspaceId,
      request: GrantRequest,
    ) => Out<Telescope.GrantExplainResult>;
    /** The calling member's own (or company) agents only. */
    readonly explainFor: Method<"telescope.grant.explain">;
    readonly audit: (
      workspaceId: Telescope.WorkspaceId,
      entry: AuditInput,
    ) => Out<Telescope.AuditEntry>;
    readonly auditList: Method<"telescope.grant.audit.list">;
    /** Admins cap the powers any agent holds in a bound project. */
    readonly setProjectRule: (caller: Caller, input: ProjectRuleInput) => Out<void>;
  }
>()("t3/telescope/GrantService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const agents = yield* AgentService.AgentService;
  const random = yield* SecureRandom.SecureRandom;
  const sql = yield* SqlClient.SqlClient;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const compute = Effect.fn("GrantService.compute")(function* (
    workspaceId: Telescope.WorkspaceId,
    request: GrantRequest,
    visibleTo?: string,
  ) {
    const [memberId, ...via] = request.onBehalfOf;
    const chain = yield* Effect.forEach([...via, request.agentId], (agentId) =>
      agents.powersOf(workspaceId, agentId),
    );
    if (
      visibleTo !== undefined &&
      chain.some(({ agent }) => ![null, visibleTo].includes(agent.ownerSubjectId))
    )
      return yield* fail("not_found", "Agent not found.");
    const ownProject = chain.at(-1)?.agent.projectId;
    if (ownProject !== undefined && (request.projectId ?? ownProject) !== ownProject)
      return yield* fail("conflict", "The agent works in another project.");
    const projectId = request.projectId ?? ownProject;
    const project = projectId === undefined ? {} : { project_id: projectId };
    const [member] = yield* db.select(workspaceId, "members", decodeMembers, {
      subject_id: memberId,
      revoked_at: null,
    });
    const bindings =
      projectId === undefined
        ? []
        : yield* db.select(workspaceId, "project_bindings", decodeBindings, project);
    const [rule] =
      projectId === undefined
        ? []
        : yield* db.select(workspaceId, "project_rules", decodeRules, project);
    const isLead = bindings.some((binding) => binding.lead_subject_id === memberId);
    const layers: ReadonlyArray<GrantLayer> = [
      member === undefined
        ? { layer: "role", powers: NO_POWERS, reason: "Not an active member of this workspace." }
        : {
            layer: "role",
            powers: rolePowers(member.role, isLead),
            reason: `The ${member.role} role does not grant this ${projectId === undefined ? "here" : "in this project"}.`,
          },
      ...chain.map(({ agent, effectivePowers }) => ({
        layer: "agent" as const,
        agentId: agent.id,
        powers: effectivePowers,
        reason: `${agent.name} does not hold this power.`,
      })),
      ...(projectId !== undefined && bindings.length === 0
        ? [
            {
              layer: "project" as const,
              powers: NO_POWERS,
              reason: "The project is not bound here.",
            },
          ]
        : []),
      ...(rule === undefined
        ? []
        : [
            {
              layer: "project" as const,
              powers: rule.powers_json,
              reason: "The project rule removes this power.",
            },
          ]),
    ];
    const holds = (power: Telescope.GrantPower) => layers.every((layer) => layer.powers[power]);
    const result: Telescope.GrantExplainResult = {
      workspaceId,
      agentId: request.agentId,
      onBehalfOf: request.onBehalfOf,
      ...(projectId === undefined ? {} : { projectId }),
      powers: {
        openTickets: holds("openTickets"),
        dispatchWorkers: holds("dispatchWorkers"),
        answerMembers: holds("answerMembers"),
        mergePRs: holds("mergePRs"),
      },
      explanations: Telescope.GrantPower.literals.map((power) => {
        const removing = layers.find((layer) => !layer.powers[power]);
        if (removing === undefined) return { power, allowed: true };
        const { layer, agentId, reason } = removing;
        return {
          power,
          allowed: false,
          removedBy: { layer, reason, ...(agentId === undefined ? {} : { agentId }) },
        };
      }),
    };
    return result;
  });

  const explain = (workspaceId: Telescope.WorkspaceId, request: GrantRequest) =>
    compute(workspaceId, request);

  const effectiveGrant = (workspaceId: Telescope.WorkspaceId, request: GrantRequest) =>
    compute(workspaceId, request).pipe(
      Effect.map(({ explanations: _, ...grant }): Telescope.EffectiveGrant => grant),
    );

  const explainFor: Method<"telescope.grant.explain"> = Effect.fn("GrantService.explainFor")(
    function* (caller, { workspaceId, agentId, via, projectId }) {
      const { self } = yield* workspaces.get(caller, { workspaceId });
      return yield* compute(
        workspaceId,
        {
          agentId,
          onBehalfOf: [self.subjectId, ...(via ?? [])],
          ...(projectId === undefined ? {} : { projectId }),
        },
        self.subjectId,
      );
    },
  );

  const audit = Effect.fn("GrantService.audit")(function* (
    workspaceId: Telescope.WorkspaceId,
    entry: AuditInput,
  ) {
    const row: typeof AuditRow.Type = {
      audit_id: Telescope.AuditEntryId.make(yield* random.uuidV4()),
      workspace_id: workspaceId,
      run_id: entry.runId ?? null,
      agent_id: entry.agentId,
      on_behalf_of_json: entry.onBehalfOf,
      project_id: entry.projectId ?? null,
      power: entry.power,
      tool: entry.tool ?? null,
      args_redacted_json: entry.argsRedacted ?? null,
      outcome: entry.outcome,
      reason: entry.reason ?? null,
      created_at: yield* now,
    };
    yield* db.insert(workspaceId, "audit", encodeAudit(row));
    return toAuditEntry(row);
  });

  const auditList: Method<"telescope.grant.audit.list"> = Effect.fn("GrantService.auditList")(
    function* (caller, { workspaceId, before, limit }) {
      const { self } = yield* workspaces.get(caller, { workspaceId });
      if (self.role !== "admin") return yield* fail("forbidden", "Only admins read the audit.");
      const rows = yield* db.select(workspaceId, "audit", decodeAudit, undefined, {
        orderBy: ["created_at", "audit_id"],
        descending: true,
        limit: limit ?? DEFAULT_AUDIT_LIMIT,
        ...(before === undefined
          ? {}
          : { filter: sql`(created_at, audit_id) < (${before.createdAt}, ${before.auditId})` }),
      });
      return { entries: rows.map(toAuditEntry) };
    },
  );

  const setProjectRule = Effect.fn("GrantService.setProjectRule")(function* (
    caller: Caller,
    input: ProjectRuleInput,
  ) {
    const { workspaceId, projectId } = input;
    const { self } = yield* workspaces.get(caller, { workspaceId });
    if (self.role !== "admin") return yield* fail("forbidden", "Only admins set project rules.");
    const where = { project_id: projectId };
    const bindings = yield* db.select(workspaceId, "project_bindings", decodeBindings, where);
    if (bindings.length === 0)
      return yield* fail("not_found", "That project is not bound to this workspace.");
    const row = {
      project_id: projectId,
      powers_json: encodePowers(input.powers),
      updated_by: self.subjectId,
      updated_at: yield* now,
    };
    yield* db.transaction(
      db
        .remove(workspaceId, "project_rules", where)
        .pipe(Effect.andThen(db.insert(workspaceId, "project_rules", row))),
    );
  });

  return GrantService.of({
    effectiveGrant,
    explain,
    explainFor,
    audit,
    auditList,
    setProjectRule,
  });
});

export const layer = Layer.effect(GrantService, make).pipe(
  Layer.provide(Layer.mergeAll(TelescopeDb.layer, WorkspaceService.layer, AgentService.layer)),
);
