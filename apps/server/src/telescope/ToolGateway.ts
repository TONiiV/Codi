import { type ProjectId, Telescope, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
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
// Known credential shapes only: auth headers, JWTs, private keys and common provider key prefixes.
const SECRET_VALUE =
  /\b(?:Bearer|Basic)\s+[\w.~+/=-]{8,}|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)|\bsk-[\w-]{16,}|\b(?:[sr]k_(?:live|test)_|gh[pousr]_|github_pat_|glpat-|xox[abpr]-|AIza)[\w-]{16,}|\bAKIA[0-9A-Z]{16}\b/g;

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
  limit_calls: null,
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
  typeof value === "string"
    ? value.replace(SECRET_VALUE, "[redacted]")
    : Array.isArray(value)
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
  budget_paused: "A Telescope budget is paused.",
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
    reason: Telescope.GatewayRefusal,
    tool: Schema.optionalKey(Telescope.GatewayTool),
    /** The first budget level, in `BudgetScope` order, that is paused or out of calls. */
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
type RefusalOf = (
  run: OpenRun,
) => Effect.Effect<Refusal | undefined, PersistenceSqlError | PersistenceDecodeError>;

// A budget at any level other than the company's names a row of this kind in the workspace.
const BUDGET_OWNERS = {
  project: ["project_bindings", "project_id"],
  agent: ["agents", "agent_id"],
  person: ["members", "subject_id"],
} as const;

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
     * its agent opens Workers with `dispatch_worker` only. `use`'s own outcome comes back as its
     * exit, so its errors never mix with the gateway's.
     */
    readonly callIfRun: <A, E, R>(
      threadId: ThreadId,
      tool: Telescope.GatewayTool,
      args: Schema.Json,
      use: Effect.Effect<A, E, R>,
      refuse?: "linked",
    ) => Effect.Effect<Exit.Exit<A, E>, ToolGatewayDenied | Failure, R>;
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

  // One transaction: the run lookup, the budget check and its count, and the audit row cannot
  // interleave with another call or with the run's end.
  const decide = Effect.fn("ToolGateway.decide")(function* (
    threadId: ThreadId,
    tool: Telescope.GatewayTool,
    argsRedacted: Schema.Json,
    refusalOf: RefusalOf,
  ) {
    const [run] = yield* db.latestRunForThread(threadId, decodeRuns);
    if (run === undefined) return undefined;
    const refuse = yield* refusalOf(run);
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
    const blocked = (test: (budget: typeof BudgetRow.Type) => boolean) =>
      Telescope.BudgetScope.literals.find((level) =>
        budgets.some((budget) => budget.scope === level && test(budget)),
      );
    const paused = blocked((budget) => budget.paused === 1);
    const spent = blocked(
      (budget) => budget.limit_calls !== null && budget.used_calls >= budget.limit_calls,
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
                : (refuse ??
                  (paused !== undefined
                    ? "budget_paused"
                    : spent !== undefined
                      ? "budget"
                      : undefined));
    const level = reason === "budget_paused" ? paused : reason === "budget" ? spent : undefined;
    const denied =
      reason === undefined
        ? undefined
        : new ToolGatewayDenied({ reason, tool, ...(level === undefined ? {} : { level }) });
    const entry = yield* grants.audit(workspaceId, {
      runId: run.run_id,
      agentId,
      onBehalfOf,
      ...(power === null ? {} : { power }),
      tool,
      argsRedacted,
      outcome: denied === undefined ? "allowed" : "denied",
      ...(grant.projectId === undefined ? {} : { projectId: grant.projectId }),
      ...(reason === undefined ? {} : { reason }),
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
    return { caller, auditId: entry.id };
  });

  const gate = Effect.fn("ToolGateway.gate")(function* <A, E, R>(
    threadId: ThreadId,
    tool: Telescope.GatewayTool,
    args: Schema.Json,
    use: (caller: ToolCaller) => Effect.Effect<A, E, R>,
    refusalOf: RefusalOf,
  ) {
    // No open run means no audit row to pair it with, so no write lock; `decide` reads again under it.
    if ((yield* db.latestRunForThread(threadId, decodeRuns)).length === 0) return undefined;
    const argsRedacted = redact(args);
    const decided = yield* db.transaction(decide(threadId, tool, argsRedacted, refusalOf));
    if (decided === undefined) return undefined;
    if (isDenied(decided)) return yield* decided;
    const { caller, auditId } = decided;
    const [duration, exit] = yield* Effect.timed(Effect.exit(use(caller)));
    const ref = { workspaceId: caller.workspaceId, runId: caller.runId };
    // A run call stores whole milliseconds; a real clock times in nanoseconds.
    const durationMs = Math.round(Duration.toMillis(duration));
    const warn = Effect.catchCause((cause) =>
      Effect.logWarning("recording a Telescope tool call failed", { cause }),
    );
    yield* runs
      .recordCall(ref, { tool, argsRedacted, grantCheck: "allowed", durationMs })
      .pipe(warn);
    if (Exit.isFailure(exit))
      yield* db
        .update(ref.workspaceId, "audit", { outcome: "failed" }, { audit_id: auditId })
        .pipe(warn);
    return exit;
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
    // A Worker keeps its memory, the tools that need no power.
    const workerRefusal: RefusalOf = (run) =>
      TOOL_POWERS[tool] === null
        ? Effect.undefined
        : db
            .select(run.workspace_id, "delegations", decodeDelegationIds, {
              thread_id: threadId,
              hop: "worker",
            })
            .pipe(Effect.map((rows) => (rows.length > 0 ? "worker" : undefined)));
    const exit = yield* gate(threadId, tool, args, use, workerRefusal);
    if (exit === undefined) return yield* new ToolGatewayDenied({ reason: "no_run", tool });
    return yield* exit;
  });

  const callIfRun = Effect.fn("ToolGateway.callIfRun")(function* <A, E, R>(
    threadId: ThreadId,
    tool: Telescope.GatewayTool,
    args: Schema.Json,
    use: Effect.Effect<A, E, R>,
    refuse?: "linked",
  ) {
    const residentRefusal: RefusalOf = () =>
      refuse !== undefined
        ? Effect.succeed(refuse)
        : db
            .agentThread(threadId)
            .pipe(Effect.map((agent) => (agent === undefined ? undefined : "resident")));
    const exit = yield* gate(threadId, tool, args, () => use, residentRefusal);
    return exit ?? (yield* Effect.exit(use));
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
      const fields = {
        ...(input.limitCalls === undefined ? {} : { limit_calls: input.limitCalls }),
        ...(input.paused === undefined ? {} : { paused: input.paused ? 1 : 0 }),
      };
      const save = Effect.gen(function* () {
        if (scope !== "company") {
          const [table, column] = BUDGET_OWNERS[scope];
          if ((yield* db.count(workspaceId, table, { [column]: input.scopeId })) === 0)
            return yield* new Telescope.WorkspaceError({
              reason: "not_found",
              message: `That ${scope} is not in this workspace.`,
            });
        }
        const [existing] = yield* db.select(workspaceId, "budgets", decodeBudgets, where);
        yield* existing === undefined
          ? db.insert(workspaceId, "budgets", { ...where, ...fields })
          : db.update(workspaceId, "budgets", fields, where);
        return toBudget({
          ...(existing ?? { ...EMPTY_BUDGET, workspace_id: workspaceId, ...where }),
          ...fields,
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
