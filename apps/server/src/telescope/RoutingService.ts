import { type ModelSelection, ProjectId, ProviderInstanceId, Telescope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AgentService from "./AgentService.ts";
import * as GrantService from "./GrantService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const RuleRow = Schema.Struct({
  rule_id: Telescope.RoutingRuleId,
  workspace_id: Telescope.WorkspaceId,
  project_id: Schema.NullOr(ProjectId),
  task_type: Telescope.Text,
  harness: ProviderInstanceId,
  model: Telescope.Text,
  priority: Telescope.Count,
});
const decodeRules = Schema.decodeUnknownEffect(Schema.Array(RuleRow));

const toRule = (row: typeof RuleRow.Type): Telescope.RoutingRule => ({
  id: row.rule_id,
  workspaceId: row.workspace_id,
  ...(row.project_id === null ? {} : { projectId: row.project_id }),
  taskType: row.task_type,
  harness: row.harness,
  model: row.model,
  priority: row.priority,
});

export interface RoutingContext {
  readonly projectId: ProjectId | undefined;
  readonly taskType: string;
  readonly agentDefault: ModelSelection | undefined;
  readonly allowlist: Telescope.RoutingAllowlist | undefined;
  /** Provider instances configured here and enabled for the project. */
  readonly configured: ReadonlySet<ProviderInstanceId>;
}

type Skip = Telescope.RoutingResolution["skipped"][number];
interface Candidate {
  readonly ruleId?: Telescope.RoutingRuleId;
  readonly modelSelection: ModelSelection;
}

// 0: project and exact task type, 1: project and "*", 2: exact type only, 3: "*" only.
const group = (rule: Telescope.RoutingRule) =>
  (rule.projectId === undefined ? 2 : 0) + (rule.taskType === Telescope.ANY_TASK_TYPE ? 1 : 0);

const allows = (list: ReadonlyArray<string> | undefined, value: string) =>
  list === undefined || list.length === 0 || list.includes(value);

const skipReason = (
  { instanceId, model }: ModelSelection,
  { allowlist, configured }: RoutingContext,
): Telescope.RoutingSkipReason | undefined => {
  if (!allows(allowlist?.harnesses, instanceId)) return "harness_not_allowed";
  if (!allows(allowlist?.models, model)) return "model_not_allowed";
  return configured.has(instanceId) ? undefined : "harness_unavailable";
};

/**
 * Matching rules by specificity (`group`), higher priority first within a group, then the order
 * given, followed by the agent's own model. The first candidate the project allowlist and this
 * server allow decides.
 */
export const resolveRoute = (
  rules: ReadonlyArray<Telescope.RoutingRule>,
  context: RoutingContext,
): Telescope.RoutingResolution => {
  const candidates: ReadonlyArray<Candidate> = [
    ...rules
      .filter(
        (rule) =>
          (rule.projectId === undefined || rule.projectId === context.projectId) &&
          (rule.taskType === Telescope.ANY_TASK_TYPE || rule.taskType === context.taskType),
      )
      .toSorted((a, b) => group(a) - group(b) || b.priority - a.priority)
      .map((rule) => ({
        ruleId: rule.id,
        modelSelection: { instanceId: rule.harness, model: rule.model },
      })),
    ...(context.agentDefault === undefined ? [] : [{ modelSelection: context.agentDefault }]),
  ];
  const skipped: Array<Skip> = [];
  for (const { ruleId, modelSelection } of candidates) {
    const reason = skipReason(modelSelection, context);
    const rule = ruleId === undefined ? {} : { ruleId };
    if (reason === undefined)
      return {
        source: ruleId === undefined ? "agent_default" : "rule",
        ...rule,
        modelSelection,
        skipped,
      };
    skipped.push({ ...rule, reason });
  }
  return { source: skipped.length === 0 ? "none" : "none_allowed", skipped };
};

const fail = (reason: Telescope.WorkspaceError["reason"], message: string) =>
  Effect.fail(new Telescope.WorkspaceError({ reason, message }));

type Caller = WorkspaceService.Caller;
type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;
type Out<A> = Effect.Effect<A, Failure>;
type Rpcs = (typeof Telescope.RoutingRpcs)[number];
type Method<Tag extends Rpcs["_tag"], C = Caller> = (
  caller: C,
  input: Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>,
) => Out<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>>;

export interface RouteRequest {
  readonly agentId: Telescope.AgentId;
  /** Defaults to the agent's own project; for a project-bound agent any other is a `conflict`. */
  readonly projectId?: ProjectId;
  readonly taskType: string;
}

/** Workspace rules choosing the harness and model a kind of task runs on. Admins write them. */
export class RoutingService extends Context.Service<
  RoutingService,
  {
    readonly list: Method<"telescope.routing.list">;
    readonly set: Method<"telescope.routing.set">;
    readonly remove: Method<"telescope.routing.delete">;
    /** For the delegation runtime opening a Worker; it does not check who is asking. */
    readonly resolve: (
      workspaceId: Telescope.WorkspaceId,
      request: RouteRequest,
    ) => Out<Telescope.RoutingResolution>;
    /** Members resolve for the agents they can see. */
    readonly resolveFor: Method<"telescope.routing.resolve", WorkspaceService.SessionCaller>;
  }
>()("t3/telescope/RoutingService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const agents = yield* AgentService.AgentService;
  const grants = yield* GrantService.GrantService;
  const providers = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const rulesOf = (workspaceId: Telescope.WorkspaceId) =>
    db
      .select(workspaceId, "routing_rules", decodeRules, undefined, {
        orderBy: ["created_at", "rowid"],
      })
      .pipe(Effect.map((rows) => rows.map(toRule)));

  const requireAdmin = Effect.fn("RoutingService.requireAdmin")(function* (
    caller: Caller,
    workspaceId: Telescope.WorkspaceId,
  ) {
    const { self } = yield* workspaces.get(caller, { workspaceId });
    if (self.role !== "admin" || "runId" in caller)
      return yield* fail("forbidden", "Only admins change routing rules.");
  });

  const list: Method<"telescope.routing.list"> = Effect.fn("RoutingService.list")(function* (
    caller,
    { workspaceId },
  ) {
    yield* workspaces.get(caller, { workspaceId });
    return { rules: yield* rulesOf(workspaceId) };
  });

  const set: Method<"telescope.routing.set"> = Effect.fn("RoutingService.set")(function* (
    caller,
    { id, workspaceId, ...rule },
  ) {
    yield* requireAdmin(caller, workspaceId);
    const { projectId } = rule;
    if (
      projectId !== undefined &&
      (yield* db.count(workspaceId, "project_bindings", { project_id: projectId })) === 0
    )
      return yield* fail("not_found", "That project is not bound to this workspace.");
    const row = {
      project_id: projectId ?? null,
      task_type: rule.taskType,
      harness: rule.harness,
      model: rule.model,
      priority: rule.priority,
    };
    if (id === undefined) {
      const ruleId = Telescope.RoutingRuleId.make(yield* random.uuidV4());
      yield* db.insert(workspaceId, "routing_rules", {
        ...row,
        rule_id: ruleId,
        created_at: yield* now,
      });
      return { ...rule, id: ruleId, workspaceId };
    }
    const where = { rule_id: id };
    return yield* db.transaction(
      Effect.gen(function* () {
        if ((yield* db.count(workspaceId, "routing_rules", where)) === 0)
          return yield* fail("not_found", "Routing rule not found.");
        yield* db.update(workspaceId, "routing_rules", row, where);
        return { ...rule, id, workspaceId };
      }),
    );
  });

  const remove: Method<"telescope.routing.delete"> = Effect.fn("RoutingService.remove")(function* (
    caller,
    { workspaceId, id },
  ) {
    yield* requireAdmin(caller, workspaceId);
    yield* db.remove(workspaceId, "routing_rules", { rule_id: id });
    return {};
  });

  const route = Effect.fn("RoutingService.route")(function* (
    workspaceId: Telescope.WorkspaceId,
    agent: Telescope.Agent,
    { projectId = agent.projectId, taskType }: Omit<RouteRequest, "agentId">,
  ) {
    if (agent.projectId !== undefined && projectId !== agent.projectId)
      return yield* fail("conflict", "The agent works in another project.");
    const allowlist =
      projectId === undefined ? undefined : yield* grants.routingAllowlist(workspaceId, projectId);
    const instances = yield* providers.listInstances;
    const overrides =
      projectId === undefined
        ? undefined
        : (yield* serverSettings.getSettings.pipe(Effect.orDie)).projectSettingsOverrides[projectId]
            ?.providerInstances;
    return resolveRoute(yield* rulesOf(workspaceId), {
      projectId,
      taskType,
      agentDefault: agent.modelSelection,
      allowlist,
      configured: new Set(
        instances.flatMap((instance) =>
          // The project's own setting wins, as the Worker launch decides it.
          (overrides?.[instance.instanceId]?.enabled ?? instance.enabled)
            ? [instance.instanceId]
            : [],
        ),
      ),
    });
  });

  const resolve = Effect.fn("RoutingService.resolve")(function* (
    workspaceId: Telescope.WorkspaceId,
    request: RouteRequest,
  ) {
    const { agent } = yield* agents.powersOf(workspaceId, request.agentId);
    return yield* route(workspaceId, agent, request);
  });

  const resolveFor: Method<"telescope.routing.resolve", WorkspaceService.SessionCaller> = Effect.fn(
    "RoutingService.resolveFor",
  )(function* (caller, input) {
    const { agent } = yield* agents.get(caller, input);
    return yield* route(input.workspaceId, agent, input);
  });

  return RoutingService.of({ list, set, remove, resolve, resolveFor });
});

export const layer = Layer.effect(RoutingService, make).pipe(
  Layer.provide(
    Layer.mergeAll(
      TelescopeDb.layer,
      WorkspaceService.layer,
      AgentService.layer,
      GrantService.layer,
    ),
  ),
);
