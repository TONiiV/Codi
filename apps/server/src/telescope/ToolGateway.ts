import { type ProjectId, Telescope, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as GrantService from "./GrantService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const TOOL_POWERS: Readonly<Record<Telescope.GatewayTool, Telescope.GrantPower>> = {
  open_ticket: "openTickets",
  dispatch_worker: "dispatchWorkers",
  answer_member: "answerMembers",
  merge_pr: "mergePRs",
};
const SECRET_KEY = /token|secret|password|passphrase|api.?key|authorization|cookie|credential/i;

const decodeTool = Schema.decodeUnknownEffect(Telescope.GatewayTool);
const RunRow = Schema.Struct({
  run_id: Telescope.AgentRunId,
  workspace_id: Telescope.WorkspaceId,
  agent_id: Telescope.AgentId,
  on_behalf_of_json: Schema.fromJsonString(
    Schema.TupleWithRest(Schema.Tuple([Telescope.SubjectId]), [Telescope.AgentId]),
  ),
});
type OpenRun = typeof RunRow.Type;
const decodeRuns = Schema.decodeUnknownEffect(Schema.Array(RunRow));
const decodeAgents = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ agent_id: Telescope.AgentId })),
);
const KillSwitchRow = Schema.Struct({
  workspace_id: Telescope.WorkspaceId,
  agent_id: Telescope.AgentId,
  state: Telescope.KillSwitch.fields.state,
  by_subject_id: Telescope.SubjectId,
  at: Schema.String,
});
const decodeKillSwitches = Schema.decodeUnknownEffect(Schema.Array(KillSwitchRow));
const BudgetRow = Schema.Struct({
  workspace_id: Telescope.WorkspaceId,
  scope: Telescope.BudgetScope,
  scope_id: Telescope.Text,
  limit_tokens: Schema.NullOr(Telescope.Count),
  limit_usd: Schema.NullOr(Schema.Finite),
  limit_calls: Schema.NullOr(Telescope.Count),
  used_tokens: Telescope.Count,
  used_usd: Schema.Finite,
  used_calls: Telescope.Count,
  paused: Schema.Number,
});
const decodeBudgets = Schema.decodeUnknownEffect(Schema.Array(BudgetRow));

const EMPTY_BUDGET = {
  limit_tokens: null,
  limit_usd: null,
  used_tokens: 0,
  used_usd: 0,
  used_calls: 0,
  paused: 0,
} as const;
const toBudget = (row: typeof BudgetRow.Type): Telescope.Budget => ({
  workspaceId: row.workspace_id,
  scope: row.scope,
  scopeId: row.scope_id,
  usedTokens: row.used_tokens,
  usedUsd: row.used_usd,
  usedCalls: row.used_calls,
  paused: row.paused === 1,
  ...(row.limit_tokens === null ? {} : { limitTokens: row.limit_tokens }),
  ...(row.limit_usd === null ? {} : { limitUsd: row.limit_usd }),
  ...(row.limit_calls === null ? {} : { limitCalls: row.limit_calls }),
});

const toKillSwitch = (row: typeof KillSwitchRow.Type): Telescope.KillSwitch => ({
  workspaceId: row.workspace_id,
  agentId: row.agent_id,
  state: row.state,
  by: row.by_subject_id,
  at: row.at,
});

const redact = (value: Schema.Json): Schema.Json =>
  Array.isArray(value)
    ? value.map(redact)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value).map(([key, inner]) => [
            key,
            SECRET_KEY.test(key) ? "[redacted]" : redact(inner),
          ]),
        )
      : value;

const DENIED_MESSAGES = {
  unknown_tool: "This tool does not go through the Telescope gateway.",
  no_run: "Telescope tools are for threads with an open Telescope run.",
  stopped: "An admin stopped this agent.",
  forbidden: "The agent's grant does not allow this tool.",
  budget: "A Telescope budget is used up.",
} as const;

export class ToolGatewayDenied extends Schema.TaggedError<ToolGatewayDenied>()(
  "TelescopeToolGatewayDenied",
  {
    reason: Schema.Literals(["unknown_tool", "no_run", "stopped", "forbidden", "budget"]),
    tool: Schema.optionalKey(Telescope.GatewayTool),
    /** The first budget level, in `BudgetScope` order, whose call limit is reached. */
    level: Schema.optionalKey(Telescope.BudgetScope),
  },
) {
  override get message(): string {
    const level = this.level === undefined ? "" : ` Level: ${this.level}.`;
    return `${DENIED_MESSAGES[this.reason]}${level}`;
  }
}

const isDenied = Schema.is(ToolGatewayDenied);

/** Who an allowed tool call acts as, taken from the thread's run, never from the tool input. */
export interface ToolCaller {
  readonly workspaceId: Telescope.WorkspaceId;
  readonly runId: Telescope.AgentRunId;
  readonly agentId: Telescope.AgentId;
  readonly memberId: string;
  readonly projectId?: ProjectId;
}

export type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;
type Rpcs = (typeof Telescope.GrantRpcs)[number];
type Method<Tag extends Rpcs["_tag"]> = (
  caller: WorkspaceService.Caller,
  input: Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>,
) => Effect.Effect<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>, Failure>;

/**
 * Every Telescope MCP tool call runs through `call`. Each call re-reads the kill switch, the grant
 * and the budgets, so a revoke, a stop or a spent budget refuses the very next call.
 */
export class ToolGateway extends Context.Service<
  ToolGateway,
  {
    readonly call: <A, E, R>(
      threadId: ThreadId,
      tool: string,
      args: Schema.Json,
      use: (caller: ToolCaller) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | ToolGatewayDenied | Failure, R>;
    readonly setBudget: Method<"telescope.budget.set">;
    readonly setKillSwitch: Method<"telescope.killSwitch.set">;
    readonly governance: Method<"telescope.governance.get">;
  }
>()("t3/telescope/ToolGateway") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const grants = yield* GrantService.GrantService;
  const runs = yield* RunRecordService.RunRecordService;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  // One transaction: the budget check and its count cannot interleave with another call.
  const decide = Effect.fn("ToolGateway.decide")(function* (
    run: OpenRun,
    tool: Telescope.GatewayTool,
    argsRedacted: Schema.Json,
  ) {
    const { workspace_id: workspaceId, agent_id: agentId, on_behalf_of_json: onBehalfOf } = run;
    const power = TOOL_POWERS[tool];
    // `onBehalfOf[0]` is the member; a stop of any agent the run acts through holds.
    const chain = new Set([agentId, ...onBehalfOf.slice(1)]);
    const stopped = (yield* db.select(workspaceId, "kill_switches", decodeKillSwitches)).some(
      (row) => chain.has(row.agent_id) && row.state !== "running",
    );
    const grant = yield* grants.effectiveGrant(workspaceId, { agentId, onBehalfOf });
    const levelIds: Readonly<Record<Telescope.Budget["scope"], string | undefined>> = {
      company: workspaceId,
      project: grant.projectId,
      agent: agentId,
      person: onBehalfOf[0],
    };
    const budgets = (yield* db.select(workspaceId, "budgets", decodeBudgets)).filter(
      (budget) => levelIds[budget.scope] === budget.scope_id,
    );
    const spent = Telescope.BudgetScope.literals.find((level) =>
      budgets.some(
        (budget) =>
          budget.scope === level &&
          budget.limit_calls !== null &&
          budget.used_calls >= budget.limit_calls,
      ),
    );
    const denied = stopped
      ? new ToolGatewayDenied({ reason: "stopped", tool })
      : !grant.powers[power]
        ? new ToolGatewayDenied({ reason: "forbidden", tool })
        : spent !== undefined
          ? new ToolGatewayDenied({ reason: "budget", tool, level: spent })
          : undefined;
    yield* grants.audit(workspaceId, {
      runId: run.run_id,
      agentId,
      onBehalfOf,
      power,
      tool,
      argsRedacted,
      outcome: denied === undefined ? "allowed" : "denied",
      ...(grant.projectId === undefined ? {} : { projectId: grant.projectId }),
      ...(denied === undefined ? {} : { reason: denied.message }),
    });
    if (denied !== undefined) {
      const ref = { workspaceId, runId: run.run_id };
      yield* runs.recordCall(ref, { tool, argsRedacted, grantCheck: "denied", durationMs: 0 });
      return denied;
    }
    yield* Effect.forEach(
      budgets,
      (budget) =>
        db.update(
          workspaceId,
          "budgets",
          { used_calls: budget.used_calls + 1 },
          { scope: budget.scope, scope_id: budget.scope_id },
        ),
      { discard: true },
    );
    const caller: ToolCaller = {
      workspaceId,
      runId: run.run_id,
      agentId,
      memberId: onBehalfOf[0],
      ...(grant.projectId === undefined ? {} : { projectId: grant.projectId }),
    };
    return caller;
  });

  const call = Effect.fn("ToolGateway.call")(function* <A, E, R>(
    threadId: ThreadId,
    toolName: string,
    args: Schema.Json,
    use: (caller: ToolCaller) => Effect.Effect<A, E, R>,
  ) {
    const tool = yield* decodeTool(toolName).pipe(
      Effect.mapError(() => new ToolGatewayDenied({ reason: "unknown_tool" })),
    );
    const [run] = yield* db.latestRunForThread(threadId, decodeRuns);
    if (run === undefined) return yield* new ToolGatewayDenied({ reason: "no_run", tool });
    const argsRedacted = redact(args);
    const decided = yield* db.transaction(decide(run, tool, argsRedacted));
    if (isDenied(decided)) return yield* decided;
    const [duration, exit] = yield* Effect.timed(Effect.exit(use(decided)));
    yield* runs
      .recordCall(
        { workspaceId: decided.workspaceId, runId: decided.runId },
        { tool, argsRedacted, grantCheck: "allowed", durationMs: Duration.toMillis(duration) },
      )
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("recording a Telescope tool call failed", { cause }),
        ),
      );
    return yield* exit;
  });

  const requireAdmin = Effect.fn("ToolGateway.requireAdmin")(function* (
    caller: WorkspaceService.Caller,
    workspaceId: Telescope.WorkspaceId,
  ) {
    const { self } = yield* workspaces.get(caller, { workspaceId });
    if (self.role !== "admin")
      return yield* new Telescope.WorkspaceError({
        reason: "forbidden",
        message: "Only admins manage budgets and stops.",
      });
    return self;
  });

  const setBudget: Method<"telescope.budget.set"> = Effect.fn("ToolGateway.setBudget")(
    function* (caller, input) {
      const { workspaceId, scope } = input;
      yield* requireAdmin(caller, workspaceId);
      const where = { scope, scope_id: scope === "company" ? workspaceId : input.scopeId };
      const limit = { limit_calls: input.limitCalls ?? null };
      const save = Effect.gen(function* () {
        const [existing] = yield* db.select(workspaceId, "budgets", decodeBudgets, where);
        yield* existing === undefined
          ? db.insert(workspaceId, "budgets", { ...where, ...limit })
          : db.update(workspaceId, "budgets", limit, where);
        return toBudget({
          ...(existing ?? { ...EMPTY_BUDGET, workspace_id: workspaceId, ...where }),
          ...limit,
        });
      });
      return yield* db.transaction(save);
    },
  );

  const setKillSwitch: Method<"telescope.killSwitch.set"> = Effect.fn("ToolGateway.setKillSwitch")(
    function* (caller, { workspaceId, agentId, state }) {
      const self = yield* requireAdmin(caller, workspaceId);
      const where = { agent_id: agentId };
      const agents = yield* db.select(workspaceId, "agents", decodeAgents, where);
      if (agents.length === 0)
        return yield* new Telescope.WorkspaceError({
          reason: "not_found",
          message: "Agent not found.",
        });
      const row = { agent_id: agentId, state, by_subject_id: self.subjectId, at: yield* now };
      yield* db.transaction(
        db
          .remove(workspaceId, "kill_switches", where)
          .pipe(Effect.andThen(db.insert(workspaceId, "kill_switches", row))),
      );
      return toKillSwitch({ ...row, workspace_id: workspaceId });
    },
  );

  const governance: Method<"telescope.governance.get"> = Effect.fn("ToolGateway.governance")(
    function* (caller, { workspaceId }) {
      yield* requireAdmin(caller, workspaceId);
      const budgets = yield* db.select(workspaceId, "budgets", decodeBudgets);
      const killSwitches = yield* db.select(workspaceId, "kill_switches", decodeKillSwitches);
      return { budgets: budgets.map(toBudget), killSwitches: killSwitches.map(toKillSwitch) };
    },
  );

  return ToolGateway.of({ call, setBudget, setKillSwitch, governance });
});

export const layer = Layer.effect(ToolGateway, make).pipe(
  Layer.provide(
    Layer.mergeAll(
      TelescopeDb.layer,
      WorkspaceService.layer,
      GrantService.layer,
      RunRecordService.layer,
    ),
  ),
);
