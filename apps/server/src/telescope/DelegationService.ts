import { ProjectId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Struct from "effect/Struct";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WakeQueueService from "./WakeQueueService.ts";

const DelegationRow = Schema.Struct({
  delegation_id: Telescope.DelegationId,
  context_id: Telescope.Text,
  parent_id: Schema.NullOr(Telescope.DelegationId),
  workspace_id: Telescope.WorkspaceId,
  from_agent_id: Telescope.AgentId,
  to_agent_id: Telescope.AgentId,
  hop: Telescope.DelegationHop,
  thread_id: Schema.NullOr(ThreadId),
  decision_id: Schema.NullOr(Telescope.DecisionId),
  state: Telescope.A2ATaskState,
  brief_json: Schema.fromJsonString(Telescope.DelegationBrief),
  report_json: Schema.NullOr(Schema.fromJsonString(Telescope.DelegationReport)),
  messages_json: Schema.fromJsonString(Schema.Array(Telescope.A2AMessage)),
  artifacts_json: Schema.fromJsonString(Schema.Array(Telescope.A2AArtifact)),
  created_at: Schema.String,
  updated_at: Schema.String,
});
type DelegationRow = typeof DelegationRow.Type;
const AgentRow = Schema.Struct({
  agent_id: Telescope.AgentId,
  owner_subject_id: Schema.NullOr(Schema.String),
  kind: Telescope.AgentKind,
  project_id: Schema.NullOr(ProjectId),
});

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(DelegationRow));
const decodeAgents = Schema.decodeUnknownEffect(Schema.Array(AgentRow));
// The repository writes workspace_id itself and refuses rows that carry it.
const encodeRow = Schema.encodeSync(DelegationRow.mapFields(Struct.omit(["workspace_id"])));

type State = Telescope.A2ATaskState;
const MOVES: Record<State, ReadonlyArray<State>> = {
  SUBMITTED: ["WORKING", "REJECTED", "CANCELED"],
  WORKING: ["INPUT_REQUIRED", "AUTH_REQUIRED", "COMPLETED", "FAILED", "CANCELED"],
  INPUT_REQUIRED: ["WORKING", "CANCELED"],
  AUTH_REQUIRED: ["WORKING", "CANCELED"],
  COMPLETED: [],
  FAILED: [],
  CANCELED: [],
  REJECTED: [],
};
/** The A2A task state machine; who may make a move is checked by each service method. */
export const canMove = (from: State, to: State) => MOVES[from].includes(to);
const isTerminal = (state: State) => MOVES[state].length === 0;

const toDelegation = (row: DelegationRow): Telescope.Delegation => ({
  id: row.delegation_id,
  contextId: row.context_id,
  ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
  workspaceId: row.workspace_id,
  fromAgentId: row.from_agent_id,
  toAgentId: row.to_agent_id,
  hop: row.hop,
  ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
  ...(row.decision_id === null ? {} : { decisionId: row.decision_id }),
  state: row.state,
  brief: row.brief_json,
  ...(row.report_json === null ? {} : { report: row.report_json }),
  messages: row.messages_json,
  artifacts: row.artifacts_json,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const fail = (reason: Telescope.WorkspaceError["reason"], message: string) =>
  Effect.fail(new Telescope.WorkspaceError({ reason, message }));
const notFound = (what: "Delegation" | "Agent") => fail("not_found", `${what} not found.`);

type WorkspaceId = Telescope.WorkspaceId;
type Out<A> = Effect.Effect<
  A,
  Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError
>;
type Brief = typeof Telescope.DelegationBrief.Type;
type Part = typeof Telescope.A2APart.Type;
/** The states the to-agent reports; WORKING and CANCELED are reached through other methods. */
const REPORT_STATES = [
  "INPUT_REQUIRED",
  "AUTH_REQUIRED",
  "COMPLETED",
  "FAILED",
  "REJECTED",
] as const satisfies ReadonlyArray<State>;
type ReportState = (typeof REPORT_STATES)[number];

/** An agent's run acting for a member; `onBehalfOf` is the run's chain, outermost first. */
export interface Actor {
  readonly workspaceId: WorkspaceId;
  readonly memberId: Telescope.SubjectId;
  readonly agentId: Telescope.AgentId;
  readonly onBehalfOf: ReadonlyArray<string>;
  readonly runId: Telescope.AgentRunId;
}
/** A member acting directly, already checked to be an active member by the transport. */
export interface MemberActor {
  readonly workspaceId: WorkspaceId;
  readonly memberId: Telescope.SubjectId;
}
export interface DelegationRef {
  readonly workspaceId: WorkspaceId;
  readonly delegationId: Telescope.DelegationId;
}
interface WorkerInput {
  readonly parentId: Telescope.DelegationId;
  readonly brief: Brief;
  readonly threadId: ThreadId;
}
interface ReportInput {
  readonly delegationId: Telescope.DelegationId;
  readonly state: ReportState;
  readonly report: typeof Telescope.DelegationReport.Type;
  readonly artifacts?: ReadonlyArray<Telescope.A2AArtifact>;
}

/**
 * A2A tasks between agents (D07): briefs down, reports up, by task id. Every read and write is
 * bound to one workspace (D02). Wakes go through the machine's wake queue (D05).
 */
export class DelegationService extends Context.Service<
  DelegationService,
  {
    /** To one of the member's own Chief Agents, in a new context, with one dispatch wake. */
    readonly delegate: (
      actor: Actor,
      input: { readonly toAgentId: Telescope.AgentId; readonly brief: Brief },
    ) => Out<Telescope.Delegation>;
    /** A Worker hop under a delegation the acting Chief holds in WORKING. */
    readonly recordWorker: (actor: Actor, input: WorkerInput) => Out<Telescope.Delegation>;
    /** SUBMITTED to WORKING when the receiving run starts; `threadId` is the thread working it. */
    readonly start: (
      ref: DelegationRef & { readonly threadId?: ThreadId },
    ) => Out<Telescope.Delegation>;
    /** Only the to-agent reports; a terminal agent-hop report wakes the from-agent once. */
    readonly report: (actor: Actor, input: ReportInput) => Out<Telescope.Delegation>;
    /**
     * D70: an agent cancels only what it sent; a member only a chain holding one of its agents.
     * Cascades to every open descendant and returns the cancelled rows, the target first.
     */
    readonly cancel: (
      by: Actor | MemberActor,
      delegationId: Telescope.DelegationId,
    ) => Out<ReadonlyArray<Telescope.Delegation>>;
    /** Records a follow-up for an open delegation; transport to its thread is the runtime's. */
    readonly deliver: (ref: DelegationRef, parts: ReadonlyArray<Part>) => Out<Telescope.Delegation>;
    readonly get: (ref: DelegationRef) => Out<Telescope.Delegation>;
    readonly byThread: (
      workspaceId: WorkspaceId,
      threadId: ThreadId,
    ) => Out<ReadonlyArray<Telescope.Delegation>>;
    /** Incoming and outgoing, oldest first. */
    readonly listForAgent: (
      workspaceId: WorkspaceId,
      agentId: Telescope.AgentId,
    ) => Out<ReadonlyArray<Telescope.Delegation>>;
  }
>()("t3/telescope/DelegationService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const wakes = yield* WakeQueueService.WakeQueueService;
  const random = yield* SecureRandom.SecureRandom;
  // Moves read a row and write it back; one at a time keeps a report and a cancel from crossing.
  const lock = yield* Semaphore.make(1);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const message = (
    row: DelegationRow,
    role: Telescope.A2AMessage["role"],
    parts: ReadonlyArray<Part>,
  ) =>
    random.uuidV4().pipe(
      Effect.map((messageId): Telescope.A2AMessage => ({
        messageId,
        contextId: row.context_id,
        taskId: row.delegation_id,
        role,
        parts,
      })),
    );
  const append = Effect.fn("DelegationService.append")(function* (
    row: DelegationRow,
    role: Telescope.A2AMessage["role"],
    parts: ReadonlyArray<Part>,
    changes: Partial<DelegationRow> = {},
  ) {
    const next: DelegationRow = {
      ...row,
      ...changes,
      messages_json: [...row.messages_json, yield* message(row, role, parts)],
      updated_at: yield* now,
    };
    yield* db.update(row.workspace_id, "delegations", encodeRow(next), {
      delegation_id: row.delegation_id,
    });
    return next;
  });

  const load = Effect.fn("DelegationService.load")(function* (ref: DelegationRef) {
    const [row] = yield* db.select(ref.workspaceId, "delegations", decodeRows, {
      delegation_id: ref.delegationId,
    });
    return row ?? (yield* notFound("Delegation"));
  });
  const agent = (workspaceId: WorkspaceId, agentId: Telescope.AgentId) =>
    db
      .select(workspaceId, "agents", decodeAgents, { agent_id: agentId })
      .pipe(Effect.map(([row]) => row));

  const create = Effect.fn("DelegationService.create")(function* (
    workspaceId: WorkspaceId,
    fields: Pick<
      DelegationRow,
      "from_agent_id" | "to_agent_id" | "hop" | "parent_id" | "thread_id"
    >,
    brief: Brief,
  ) {
    const at = yield* now;
    const row: DelegationRow = {
      ...fields,
      delegation_id: Telescope.DelegationId.make(yield* random.uuidV4()),
      context_id: yield* random.uuidV4(),
      workspace_id: workspaceId,
      decision_id: null,
      state: "SUBMITTED",
      brief_json: brief,
      report_json: null,
      messages_json: [],
      artifacts_json: [],
      created_at: at,
      updated_at: at,
    };
    const briefMessage = yield* message(row, "user", [
      { kind: "data", data: { state: "SUBMITTED", brief } },
    ]);
    const created = { ...row, messages_json: [briefMessage] };
    yield* db.insert(workspaceId, "delegations", encodeRow(created));
    return created;
  });

  /** Every move appends one message carrying the new state and its payload. */
  const move = Effect.fn("DelegationService.move")(function* (
    row: DelegationRow,
    state: State,
    role: Telescope.A2AMessage["role"],
    data: Record<string, Schema.Json>,
    changes: Partial<DelegationRow> = {},
  ) {
    if (!canMove(row.state, state))
      return yield* fail("conflict", `A ${row.state} delegation cannot become ${state}.`);
    const note: Part = { kind: "data", data: { state, ...data } };
    return yield* append(row, role, [note], { ...changes, state });
  });

  const wakeKey = (delegationId: Telescope.DelegationId) => `delegation:${delegationId}`;
  const wakeFromAgent = (row: DelegationRow, subjectId: string) =>
    wakes.enqueue(row.workspace_id, {
      reason: "dispatch",
      priority: 2,
      agentId: row.from_agent_id,
      subjectId,
      coalesceKey: `${wakeKey(row.delegation_id)}:report`,
      payload: { kind: "report", delegationId: row.delegation_id },
    });

  const delegate = Effect.fn("DelegationService.delegate")(function* (
    actor: Actor,
    input: { readonly toAgentId: Telescope.AgentId; readonly brief: Brief },
  ) {
    if (input.toAgentId === actor.agentId)
      return yield* fail("forbidden", "An agent does not delegate to itself.");
    const target = yield* agent(actor.workspaceId, input.toAgentId);
    if (target?.owner_subject_id !== actor.memberId || target.kind !== "chief_agent")
      return yield* notFound("Agent");
    const row = yield* create(
      actor.workspaceId,
      {
        from_agent_id: actor.agentId,
        to_agent_id: target.agent_id,
        hop: "agent",
        parent_id: null,
        thread_id: null,
      },
      input.brief,
    );
    yield* wakes.enqueue(actor.workspaceId, {
      reason: "dispatch",
      priority: 2,
      agentId: target.agent_id,
      subjectId: actor.memberId,
      ...(target.project_id === null ? {} : { projectId: target.project_id }),
      coalesceKey: wakeKey(row.delegation_id),
      payload: { kind: "delegation", delegationId: row.delegation_id },
    });
    return toDelegation(row);
  }, lock.withPermit);

  const recordWorker = Effect.fn("DelegationService.recordWorker")(function* (
    actor: Actor,
    input: WorkerInput,
  ) {
    const parent = yield* load({ workspaceId: actor.workspaceId, delegationId: input.parentId });
    if (parent.to_agent_id !== actor.agentId || parent.hop !== "agent")
      return yield* fail("forbidden", "Only the agent a task was delegated to opens its Workers.");
    if (parent.state !== "WORKING")
      return yield* fail("conflict", "Workers open only under a delegation in progress.");
    const row = yield* create(
      actor.workspaceId,
      {
        from_agent_id: actor.agentId,
        to_agent_id: actor.agentId,
        hop: "worker",
        parent_id: parent.delegation_id,
        thread_id: input.threadId,
      },
      input.brief,
    );
    return toDelegation(row);
  }, lock.withPermit);

  const start = Effect.fn("DelegationService.start")(function* (
    ref: DelegationRef & { readonly threadId?: ThreadId },
  ) {
    const row = yield* load(ref);
    if (row.state !== "SUBMITTED")
      return yield* fail("conflict", "Only a submitted delegation starts.");
    const thread = ref.threadId === undefined ? {} : { thread_id: ref.threadId };
    return toDelegation(yield* move(row, "WORKING", "agent", {}, thread));
  }, lock.withPermit);

  const report = Effect.fn("DelegationService.report")(function* (
    actor: Actor,
    input: ReportInput,
  ) {
    if (!REPORT_STATES.includes(input.state))
      return yield* fail("forbidden", "A report does not cancel or restart a delegation.");
    const row = yield* load({ workspaceId: actor.workspaceId, delegationId: input.delegationId });
    if (row.to_agent_id !== actor.agentId)
      return yield* fail("forbidden", "Only the agent a task was delegated to reports on it.");
    const moved = yield* move(
      row,
      input.state,
      "agent",
      { report: input.report },
      {
        report_json: input.report,
        artifacts_json: [...row.artifacts_json, ...(input.artifacts ?? [])],
      },
    );
    if (isTerminal(moved.state) && moved.hop === "agent")
      yield* wakeFromAgent(moved, actor.memberId);
    return toDelegation(moved);
  }, lock.withPermit);

  const chainOwnedBy = Effect.fn("DelegationService.chainOwnedBy")(function* (
    row: DelegationRow,
    memberId: string,
  ) {
    for (let at: DelegationRow | undefined = row; at !== undefined;) {
      for (const agentId of [at.from_agent_id, at.to_agent_id]) {
        if ((yield* agent(row.workspace_id, agentId))?.owner_subject_id === memberId) return true;
      }
      const delegationId: Telescope.DelegationId | null = at.parent_id;
      at =
        delegationId === null
          ? undefined
          : yield* load({ workspaceId: row.workspace_id, delegationId });
    }
    return false;
  });
  const openDescendants = Effect.fn("DelegationService.openDescendants")(function* (
    root: DelegationRow,
  ) {
    const found: Array<DelegationRow> = [];
    for (let level = [root]; level.length > 0;) {
      const children = yield* Effect.forEach(level, (parent) =>
        db.select(root.workspace_id, "delegations", decodeRows, {
          parent_id: parent.delegation_id,
        }),
      );
      level = children.flat();
      found.push(...level);
    }
    return found.filter((row) => !isTerminal(row.state));
  });

  const cancel = Effect.fn("DelegationService.cancel")(function* (
    by: Actor | MemberActor,
    delegationId: Telescope.DelegationId,
  ) {
    const root = yield* load({ workspaceId: by.workspaceId, delegationId });
    const byAgent = "agentId" in by;
    if (byAgent ? root.from_agent_id !== by.agentId : !(yield* chainOwnedBy(root, by.memberId)))
      return yield* fail(
        "forbidden",
        byAgent
          ? "Only the agent that sent a task cancels it."
          : "Only the owner of an agent in the chain cancels it.",
      );
    const rows = [root, ...(yield* openDescendants(root))];
    const by_ = byAgent ? { agentId: by.agentId } : { memberId: by.memberId };
    const cancelled = yield* db.transaction(
      Effect.forEach(rows, (row) => move(row, "CANCELED", byAgent ? "agent" : "user", { by: by_ })),
    );
    yield* Effect.forEach(cancelled, (row) =>
      wakes.drop(by.workspaceId, wakeKey(row.delegation_id)),
    );
    // An agent cancels only what it sent, so only a member's cancel is news to the from-agent.
    if (!byAgent && root.hop === "agent") yield* wakeFromAgent(root, by.memberId);
    return cancelled.map(toDelegation);
  }, lock.withPermit);

  const deliver = Effect.fn("DelegationService.deliver")(function* (
    ref: DelegationRef,
    parts: ReadonlyArray<Part>,
  ) {
    const row = yield* load(ref);
    if (isTerminal(row.state)) return yield* fail("conflict", "This delegation has ended.");
    return toDelegation(yield* append(row, "user", parts));
  }, lock.withPermit);

  const get = Effect.fn("DelegationService.get")(function* (ref: DelegationRef) {
    return toDelegation(yield* load(ref));
  });
  const byThread = Effect.fn("DelegationService.byThread")(function* (
    workspaceId: WorkspaceId,
    threadId: ThreadId,
  ) {
    const rows = yield* db.select(
      workspaceId,
      "delegations",
      decodeRows,
      { thread_id: threadId },
      { orderBy: ["created_at"] },
    );
    return rows.map(toDelegation);
  });
  const listForAgent = Effect.fn("DelegationService.listForAgent")(function* (
    workspaceId: WorkspaceId,
    agentId: Telescope.AgentId,
  ) {
    const [outgoing, incoming] = yield* Effect.all([
      db.select(workspaceId, "delegations", decodeRows, { from_agent_id: agentId }),
      db.select(workspaceId, "delegations", decodeRows, { to_agent_id: agentId }),
    ]);
    const rows = new Map([...outgoing, ...incoming].map((row) => [row.delegation_id, row]));
    return [...rows.values()]
      .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
      .map(toDelegation);
  });

  return DelegationService.of({
    delegate,
    recordWorker,
    start,
    report,
    cancel,
    deliver,
    get,
    byThread,
    listForAgent,
  });
});

export const layer = Layer.effect(DelegationService, make).pipe(
  Layer.provide(Layer.merge(TelescopeDb.layer, WakeQueueService.layer)),
);
