import { ProjectId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Struct from "effect/Struct";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as BoardChanges from "./BoardChanges.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WakeQueueService from "./WakeQueueService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

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

const DecisionRow = Schema.Struct({
  item_id: Schema.String,
  title: Schema.String,
  text: Schema.NullOr(Schema.String),
  chosen: Schema.NullOr(Schema.String),
  decided_by: Schema.NullOr(Schema.String),
  options_json: Schema.NullOr(
    Schema.fromJsonString(Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String }))),
  ),
});

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(DelegationRow));
const decodeAgents = Schema.decodeUnknownEffect(Schema.Array(AgentRow));
const decodeDecisions = Schema.decodeUnknownEffect(Schema.Array(DecisionRow));
const decodeStops = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ agent_id: Schema.String, state: Schema.String })),
);
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
/** Plan 2.5: these reports ask a member through a proposed decision (需要你定). */
const QUESTION_STATES: ReadonlyArray<State> = ["INPUT_REQUIRED", "AUTH_REQUIRED"];
const APPROVAL = [
  { id: "approve", label: "批准" },
  { id: "deny", label: "不批准" },
];
const STOPPED = "agent stopped";
const THREAD_GONE = "The Worker thread was archived or deleted.";
const LIST_LIMIT = 50;

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
  /** For INPUT_REQUIRED and AUTH_REQUIRED: the decision's title and, for input, its options. */
  readonly question?: string;
  readonly options?: ReadonlyArray<string>;
}
type Rpcs = (typeof Telescope.DelegationRpcs)[number];
type MemberMethod<Tag extends Rpcs["_tag"]> = (
  caller: WorkspaceService.Caller,
  input: Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>,
) => Out<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>>;

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
    /**
     * The runtime fails a task its agent cannot work or left unreported (D48, D66); it goes up
     * like a report. `memberId` is the member the report wake serves.
     */
    readonly abandon: (
      ref: DelegationRef & { readonly memberId: string },
      blockedOn: string,
    ) => Out<Telescope.Delegation>;
    /**
     * Only the to-agent reports; a terminal agent-hop report wakes the from-agent once. A question
     * opens one proposed decision by the agent, which only a member settles (D57).
     */
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
    /**
     * Once a member decides a question, its delegation is WORKING again with the answer as a user
     * message: `send` gives it to a Worker hop's thread first (false: the thread is archived or
     * gone, and the hop fails); an agent hop gets a wake.
     */
    readonly answer: <E>(
      ref: { readonly workspaceId: WorkspaceId; readonly decisionId: Telescope.DecisionId },
      send: (threadId: ThreadId, text: string) => Effect.Effect<boolean, E>,
    ) => Effect.Effect<Telescope.Delegation | undefined, E | Effect.Error<Out<never>>>;
    /** Every delegation waiting on a member, by its decision: a restart re-reads them. */
    readonly waiting: Out<
      ReadonlyArray<{
        readonly workspaceId: WorkspaceId;
        readonly decisionId: Telescope.DecisionId;
      }>
    >;
    /** A member sees and cancels the delegations of a chain holding one of its agents (D70). */
    readonly listForMember: MemberMethod<"telescope.delegation.list">;
    readonly getForMember: MemberMethod<"telescope.delegation.get">;
    readonly cancelForMember: MemberMethod<"telescope.delegation.cancel">;
  }
>()("t3/telescope/DelegationService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const wakes = yield* WakeQueueService.WakeQueueService;
  const board = yield* TaskBoardService.TaskBoardService;
  const changes = yield* BoardChanges.BoardChanges;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const random = yield* SecureRandom.SecureRandom;
  // Moves read a row and write it back; one at a time keeps a report and a cancel from crossing.
  const lock = yield* Semaphore.make(1);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  // Every row write adds a message, so its count is the row's version.
  const published = (row: DelegationRow) =>
    changes.publish({
      kind: "delegation",
      workspaceId: row.workspace_id,
      id: row.delegation_id,
      version: row.messages_json.length,
    });

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
    yield* published(next);
    return next;
  });

  const load = Effect.fn("DelegationService.load")(function* (ref: DelegationRef) {
    const [row] = yield* db.select(ref.workspaceId, "delegations", decodeRows, {
      delegation_id: ref.delegationId,
    });
    return row ?? (yield* notFound("Delegation"));
  });
  // To an agent that neither sent nor received it, a delegation does not exist.
  const loadAsParty = Effect.fn("DelegationService.loadAsParty")(function* (
    actor: Actor,
    delegationId: Telescope.DelegationId,
  ) {
    const row = yield* load({ workspaceId: actor.workspaceId, delegationId });
    if (row.from_agent_id !== actor.agentId && row.to_agent_id !== actor.agentId)
      return yield* notFound("Delegation");
    return row;
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
    yield* published(created);
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
    const row = yield* loadAsParty(actor, input.delegationId);
    if (row.to_agent_id !== actor.agentId)
      return yield* fail("forbidden", "Only the agent a task was delegated to reports on it.");
    const { question, report } = input;
    const asking = QUESTION_STATES.includes(input.state);
    if (asking && question === undefined)
      return yield* fail("invalid", "Name the question the member must decide in `question`.");
    if (input.state === "INPUT_REQUIRED" && (input.options ?? []).length === 0)
      return yield* fail("invalid", "Give the member at least one choice in `options`.");
    const options =
      input.state === "AUTH_REQUIRED"
        ? APPROVAL
        : (input.options ?? []).map((label, index) => ({ id: String(index + 1), label }));
    const ask = board
      .createDecision(
        {
          caller: { runId: actor.runId, workspaceId: actor.workspaceId, memberId: actor.memberId },
          authorId: actor.agentId,
          onBehalfOf: actor.onBehalfOf,
        },
        {
          workspaceId: actor.workspaceId,
          title: question ?? "",
          text: [report.blockedOn, report.needsFrom]
            .filter((line) => line !== undefined)
            .join("\n"),
          status: "proposed",
          ...(options.length === 0 ? {} : { options }),
        },
      )
      .pipe(
        Effect.catchTags({
          TelescopeStaleTaskVersionError: (error) => fail("conflict", error.message),
          TelescopeFreeTextLimitError: (error) => fail("conflict", error.message),
        }),
      );
    // A refused move rolls the question's decision back with it.
    const moved = yield* db.transaction(
      Effect.gen(function* () {
        const decisionId = asking ? (yield* ask).id : undefined;
        const asked = decisionId === undefined ? {} : { decisionId };
        return yield* move(
          row,
          input.state,
          "agent",
          { report, ...asked },
          {
            ...(decisionId === undefined ? {} : { decision_id: decisionId }),
            report_json: report,
            artifacts_json: [...row.artifacts_json, ...(input.artifacts ?? [])],
          },
        );
      }),
    );
    if (isTerminal(moved.state) && moved.hop === "agent")
      yield* wakeFromAgent(moved, actor.memberId);
    return toDelegation(moved);
  }, lock.withPermit);

  const failRow = Effect.fn("DelegationService.failRow")(function* (
    row: DelegationRow,
    memberId: string,
    blockedOn: string,
  ) {
    const waits = row.state === "SUBMITTED" || QUESTION_STATES.includes(row.state);
    const working = waits ? yield* move(row, "WORKING", "agent", {}) : row;
    const report = { result: "", decisions: [], blockedOn };
    const failed = yield* move(working, "FAILED", "agent", { report }, { report_json: report });
    yield* wakeFromAgent(failed, memberId);
    return toDelegation(failed);
  });
  const abandon = Effect.fn("DelegationService.abandon")(function* (
    ref: DelegationRef & { readonly memberId: string },
    blockedOn: string,
  ) {
    return yield* failRow(yield* load(ref), ref.memberId, blockedOn);
  }, lock.withPermit);

  /** Every agent the delegation and its ancestors name, the delegation's own first. */
  const chainAgents = Effect.fn("DelegationService.chainAgents")(function* (row: DelegationRow) {
    const found = new Set<Telescope.AgentId>();
    for (let at: DelegationRow | undefined = row; at !== undefined;) {
      found.add(at.from_agent_id).add(at.to_agent_id);
      const delegationId: Telescope.DelegationId | null = at.parent_id;
      at =
        delegationId === null
          ? undefined
          : yield* load({ workspaceId: row.workspace_id, delegationId });
    }
    return found;
  });
  const chainOwnedBy = Effect.fn("DelegationService.chainOwnedBy")(function* (
    row: DelegationRow,
    memberId: string,
  ) {
    for (const agentId of yield* chainAgents(row)) {
      if ((yield* agent(row.workspace_id, agentId))?.owner_subject_id === memberId) return true;
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
    const byAgent = "agentId" in by;
    const root = yield* byAgent
      ? loadAsParty(by, delegationId)
      : load({ workspaceId: by.workspaceId, delegationId });
    // D98: to a member outside the chain, as to an agent outside it, the task does not exist.
    if (!byAgent && !(yield* chainOwnedBy(root, by.memberId))) return yield* notFound("Delegation");
    if (byAgent && root.from_agent_id !== by.agentId)
      return yield* fail("forbidden", "Only the agent that sent a task cancels it.");
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

  const stopped = Effect.fn("DelegationService.stopped")(function* (row: DelegationRow) {
    const chain = yield* chainAgents(row);
    const stops = yield* db.select(row.workspace_id, "kill_switches", decodeStops);
    return stops.some(
      (stop) => chain.has(Telescope.AgentId.make(stop.agent_id)) && stop.state !== "running",
    );
  });

  const answer: DelegationService["Service"]["answer"] = Effect.fn("DelegationService.answer")(
    function* (ref, send) {
      const { workspaceId, decisionId } = ref;
      const decisions = (where: Record<string, string>) =>
        db.select(workspaceId, "tasks", decodeDecisions, { kind: "decision", ...where });
      const row = (yield* db.select(workspaceId, "delegations", decodeRows, {
        decision_id: decisionId,
      })).find((candidate) => QUESTION_STATES.includes(candidate.state));
      const [asked] = yield* decisions({ item_id: decisionId });
      // A member may first counter-propose: the decision then supersedes the question indirectly.
      let decided: typeof DecisionRow.Type | undefined;
      for (let ids: ReadonlyArray<string> = [decisionId]; !decided && ids.length > 0;) {
        const replies = (yield* Effect.forEach(ids, (id) => decisions({ supersedes: id }))).flat();
        decided = replies.find((reply) => reply.decided_by !== null);
        ids = replies.map((reply) => reply.item_id);
      }
      if (row === undefined || asked === undefined || decided === undefined) return undefined;
      const target = yield* agent(workspaceId, row.to_agent_id);
      const owner = target?.owner_subject_id ?? "";
      if (yield* stopped(row)) return yield* failRow(row, owner, STOPPED);
      const options = decided.options_json ?? asked.options_json ?? [];
      const label = options.find((option) => option.id === decided.chosen)?.label ?? decided.chosen;
      const note = decided.text !== asked.text && decided.text ? decided.text : undefined;
      const who = decided.decided_by === owner ? "Your member" : "A workspace member";
      const text = [`${who} answered "${asked.title}": ${label ?? "(no option)"}`, note]
        .filter((line) => line !== undefined)
        .join("\n");
      if (row.hop === "worker" && row.thread_id !== null && !(yield* send(row.thread_id, text)))
        return yield* failRow(row, owner, THREAD_GONE);
      const parts: ReadonlyArray<Part> = [
        { kind: "data", data: { state: "WORKING", decisionId } },
        { kind: "text", text },
      ];
      const moved = yield* db.transaction(
        Effect.gen(function* () {
          const next = yield* append(row, "user", parts, { state: "WORKING", decision_id: null });
          if (row.hop === "agent")
            yield* wakes.enqueue(workspaceId, {
              reason: "dispatch",
              priority: 2,
              agentId: row.to_agent_id,
              subjectId: owner,
              ...(target?.project_id == null ? {} : { projectId: target.project_id }),
              coalesceKey: `${wakeKey(row.delegation_id)}:answer`,
              payload: { kind: "answer", delegationId: row.delegation_id },
            });
          return next;
        }),
      );
      return toDelegation(moved);
    },
    lock.withPermit,
  );

  const waiting = Effect.gen(function* () {
    const found: Array<{ workspaceId: WorkspaceId; decisionId: Telescope.DecisionId }> = [];
    for (const workspaceId of yield* db.allWorkspaceIds) {
      for (const state of QUESTION_STATES) {
        for (const row of yield* db.select(workspaceId, "delegations", decodeRows, { state }))
          if (row.decision_id !== null) found.push({ workspaceId, decisionId: row.decision_id });
      }
    }
    return found;
  }).pipe(Effect.withSpan("DelegationService.waiting"));

  const memberOf = (caller: WorkspaceService.Caller, workspaceId: WorkspaceId) =>
    workspaces
      .get(caller, { workspaceId })
      .pipe(Effect.map(({ self }): MemberActor => ({ workspaceId, memberId: self.subjectId })));

  const listForMember: DelegationService["Service"]["listForMember"] = Effect.fn(
    "DelegationService.listForMember",
  )(function* (caller, input) {
    const member = yield* memberOf(caller, input.workspaceId);
    const mine = yield* db.select(input.workspaceId, "agents", decodeAgents, {
      owner_subject_id: member.memberId,
    });
    const agentIds = mine
      .map((row) => row.agent_id)
      .filter((agentId) => input.agentId === undefined || agentId === input.agentId);
    const rows = new Map<Telescope.DelegationId, Telescope.Delegation>();
    for (const agentId of agentIds)
      for (const row of yield* listForAgent(input.workspaceId, agentId)) rows.set(row.id, row);
    const delegations = [...rows.values()]
      .filter((row) => input.state === undefined || row.state === input.state)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
      .toReversed()
      .slice(0, input.limit ?? LIST_LIMIT)
      .map((row) => Struct.omit(row, ["messages"]));
    return { delegations };
  });
  const getForMember: DelegationService["Service"]["getForMember"] = Effect.fn(
    "DelegationService.getForMember",
  )(function* (caller, input) {
    const { memberId } = yield* memberOf(caller, input.workspaceId);
    const row = yield* load(input);
    // D98: the same answer for a stranger as for an unknown id.
    if (!(yield* chainOwnedBy(row, memberId))) return yield* notFound("Delegation");
    return toDelegation(row);
  });
  const cancelForMember: DelegationService["Service"]["cancelForMember"] = Effect.fn(
    "DelegationService.cancelForMember",
  )(function* (caller, input) {
    const member = yield* memberOf(caller, input.workspaceId);
    const cancelled = yield* cancel(member, input.delegationId);
    return { canceled: cancelled.map((row) => row.id) };
  });

  return DelegationService.of({
    delegate,
    recordWorker,
    start,
    abandon,
    report,
    cancel,
    deliver,
    get,
    byThread,
    listForAgent,
    answer,
    waiting,
    listForMember,
    getForMember,
    cancelForMember,
  });
});

export const layer = Layer.effect(DelegationService, make).pipe(
  Layer.provide(
    Layer.mergeAll(
      TelescopeDb.layer,
      WakeQueueService.layer,
      TaskBoardService.layer,
      WorkspaceService.layer,
      BoardChanges.layer,
    ),
  ),
);
