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

// Reading the board needs openTickets too, so an agent without it sees only its own brief.
// Null needs no power: every agent keeps its own memory.
const TOOL_POWERS: Readonly<Record<Telescope.GatewayTool, Telescope.GrantPower | null>> = {
  open_ticket: "openTickets",
  dispatch_worker: "dispatchWorkers",
  answer_member: "answerMembers",
  merge_pr: "mergePRs",
  ticket_list: "openTickets",
  ticket_get: "openTickets",
  ticket_update: "openTickets",
  ticket_lease: "openTickets",
  ticket_lease_renew: "openTickets",
  ticket_lease_release: "openTickets",
  decision_list: "openTickets",
  decision_record: "openTickets",
  agent_list: "openTickets",
  delegate: "dispatchWorkers",
  delegation_list: "openTickets",
  delegation_report: "openTickets",
  delegation_cancel: "dispatchWorkers",
  memory_search: null,
  memory_write: null,
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
const decodeDelegationIds = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ delegation_id: Telescope.DelegationId })),
);
const decodeAgents = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ agent_id: Telescope.AgentId })),
);
const decodeGovernanceAgents = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      agent_id: Telescope.AgentId,
      name: Telescope.Text,
      kind: Telescope.AgentKind,
      owner_subject_id: Schema.NullOr(Telescope.SubjectId),
    }),
  ),
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
  project_only:
    "Only a project's agent opens Worker threads. Hand the work to its Chief Agent with `delegate`.",
  no_project:
    "Only an agent without a project hands work to a Chief Agent. Do your own project's work with your Workers (`dispatch_worker`); report work outside your project back with `delegation_report`.",
  resident:
    "An agent's own thread does not open or steer other threads. Open a Worker for the task with `dispatch_worker` and a brief.",
  worker: "A Worker reports through its thread; Telescope tools are not for Workers.",
  linked:
    "Telescope agents cannot act on a linked environment yet. Leave out environmentId to work here.",
} as const;

export class ToolGatewayDenied extends Schema.TaggedError<ToolGatewayDenied>()(
  "TelescopeToolGatewayDenied",
  {
    reason: Schema.Literals([
      "unknown_tool",
      "no_run",
      "stopped",
      "forbidden",
      "budget",
      "project_only",
      "no_project",
      "resident",
      "worker",
      "linked",
    ]),
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
/** Refused before the grant (a linked environment, a Worker run) or after it (an agent's own thread). */
type Refusal = "linked" | "worker" | "resident";

/** Who an allowed tool call acts as, taken from the thread's run, never from the tool input. */
export interface ToolCaller {
  readonly workspaceId: Telescope.WorkspaceId;
  readonly runId: Telescope.AgentRunId;
  readonly agentId: Telescope.AgentId;
  readonly memberId: string;
  readonly onBehalfOf: typeof Telescope.OnBehalfOf.Type;
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
    /**
     * `call` on a thread with an open run, or that call refused and recorded as `refuse`; any
     * other thread runs `use` as it would without Telescope. An agent's own thread is refused:
     * its agent opens Workers with `dispatch_worker` only.
     */
    readonly callIfRun: <A, E, R>(
      threadId: ThreadId,
      tool: Telescope.GatewayTool,
      args: Schema.Json,
      use: Effect.Effect<A, E, R>,
      refuse?: "linked",
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
    refuse?: Refusal,
  ) {
    const { workspace_id: workspaceId, agent_id: agentId, on_behalf_of_json: onBehalfOf } = run;
    const power = TOOL_POWERS[tool];
    // `onBehalfOf[0]` is the member; a stop of any agent the run acts through holds.
    const chain = new Set([agentId, ...onBehalfOf.slice(1)]);
    const stopped = (yield* db.select(workspaceId, "kill_switches", decodeKillSwitches)).some(
      (row) => chain.has(row.agent_id) && row.state !== "running",
    );
    const grant = yield* grants.effectiveGrant(workspaceId, { agentId, onBehalfOf });
    // A tool that needs no power still needs the run's member to be active.
    const granted =
      power === null
        ? (yield* db.count(workspaceId, "members", {
            subject_id: onBehalfOf[0],
            revoked_at: null,
          })) > 0
        : grant.powers[power];
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
    // The PA's own thread is refused as project_only, which names the path it has.
    const reason: ToolGatewayDenied["reason"] | undefined =
      refuse === "linked" || refuse === "worker"
        ? refuse
        : stopped
          ? "stopped"
          : !granted
            ? "forbidden"
            : // An agent without a project still holds dispatchWorkers, to pass down the chain.
              tool === "dispatch_worker" && grant.projectId === undefined
              ? "project_only"
              : tool === "delegate" && grant.projectId !== undefined
                ? "no_project"
                : (refuse ?? (spent !== undefined ? "budget" : undefined));
    const denied =
      reason === undefined
        ? undefined
        : new ToolGatewayDenied({
            reason,
            tool,
            ...(reason !== "budget" || spent === undefined ? {} : { level: spent }),
          });
    yield* grants.audit(workspaceId, {
      runId: run.run_id,
      agentId,
      onBehalfOf,
      ...(power === null ? {} : { power }),
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
      onBehalfOf,
      ...(grant.projectId === undefined ? {} : { projectId: grant.projectId }),
    };
    return caller;
  });

  const gate = Effect.fn("ToolGateway.gate")(function* <A, E, R>(
    run: OpenRun,
    tool: Telescope.GatewayTool,
    args: Schema.Json,
    use: (caller: ToolCaller) => Effect.Effect<A, E, R>,
    refuse?: Refusal,
  ) {
    const argsRedacted = redact(args);
    const decided = yield* db.transaction(decide(run, tool, argsRedacted, refuse));
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
    const worker = yield* db.select(run.workspace_id, "delegations", decodeDelegationIds, {
      thread_id: threadId,
      hop: "worker",
    });
    // A Worker keeps its memory, the tools that need no power.
    const refuse = worker.length > 0 && TOOL_POWERS[tool] !== null ? "worker" : undefined;
    return yield* gate(run, tool, args, use, refuse);
  });

  const callIfRun = Effect.fn("ToolGateway.callIfRun")(function* <A, E, R>(
    threadId: ThreadId,
    tool: Telescope.GatewayTool,
    args: Schema.Json,
    use: Effect.Effect<A, E, R>,
    refuse?: "linked",
  ) {
    const [run] = yield* db.latestRunForThread(threadId, decodeRuns);
    if (run === undefined) return yield* use;
    const resident =
      refuse ?? ((yield* db.agentThread(threadId)) === undefined ? undefined : "resident");
    return yield* gate(run, tool, args, () => use, resident);
  });

  const requireAdmin = Effect.fn("ToolGateway.requireAdmin")(function* (
    caller: WorkspaceService.Caller,
    workspaceId: Telescope.WorkspaceId,
  ) {
    const { self } = yield* workspaces.get(caller, { workspaceId });
    if (self.role !== "admin" || "runId" in caller)
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
      const agents = yield* db.select(workspaceId, "agents", decodeGovernanceAgents, undefined, {
        orderBy: ["created_at", "agent_id"],
      });
      return {
        budgets: budgets.map(toBudget),
        killSwitches: killSwitches.map(toKillSwitch),
        agents: agents.map((row) => ({
          id: row.agent_id,
          name: row.name,
          kind: row.kind,
          ownerSubjectId: row.owner_subject_id,
        })),
      };
    },
  );

  return ToolGateway.of({ call, callIfRun, setBudget, setKillSwitch, governance });
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
