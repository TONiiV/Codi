import { ProjectId, Telescope, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const DEFAULT_LIMIT = 10;
const COMPANY_AGENT_KINDS: ReadonlyArray<Telescope.AgentKind> = ["company_main", "department"];

const MemoryRow = Schema.Struct({
  memory_id: Telescope.MemoryId,
  workspace_id: Telescope.WorkspaceId,
  agent_id: Telescope.AgentId,
  scope: Telescope.MemoryScope,
  layer: Telescope.MemoryLayer,
  level: Telescope.MemoryLevel,
  project_id: Schema.NullOr(ProjectId),
  about_subject_id: Schema.NullOr(Schema.String),
  kind: Schema.String,
  text: Schema.String,
  source_json: Schema.fromJsonString(Telescope.Memory.fields.source),
  pinned: Schema.Number,
  valid_from: Schema.String,
  invalid_at: Schema.NullOr(Schema.String),
  last_retrieved_at: Schema.NullOr(Schema.String),
  uses: Schema.Number,
  rev: Schema.Number,
  deleted: Schema.Number,
});
type MemoryRow = typeof MemoryRow.Type;
const AgentRow = Schema.Struct({
  agent_id: Telescope.AgentId,
  owner_subject_id: Schema.NullOr(Schema.String),
  kind: Telescope.AgentKind,
});
type AgentRow = typeof AgentRow.Type;
const RunRow = Schema.Struct({
  run_id: Telescope.AgentRunId,
  workspace_id: Telescope.WorkspaceId,
  agent_id: Telescope.AgentId,
  on_behalf_of_json: Schema.fromJsonString(Telescope.OnBehalfOf),
});

const decodeMemories = Schema.decodeUnknownEffect(Schema.Array(MemoryRow));
const decodeAgents = Schema.decodeUnknownEffect(Schema.Array(AgentRow));
const decodeRuns = Schema.decodeUnknownEffect(Schema.Array(RunRow));
const decodeMembers = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ subject_id: Schema.String, role: Telescope.WorkspaceRole })),
);
const decodeWorkspaceKinds = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ kind: Telescope.WorkspaceKind })),
);

const toMemory = (row: MemoryRow): Telescope.Memory => ({
  id: row.memory_id,
  workspaceId: row.workspace_id,
  agentId: row.agent_id,
  scope: row.scope,
  layer: row.layer,
  level: row.level,
  ...(row.project_id === null ? {} : { projectId: row.project_id }),
  ...(row.about_subject_id === null ? {} : { aboutSubjectId: row.about_subject_id }),
  kind: row.kind,
  text: row.text,
  source: row.source_json,
  pinned: row.pinned === 1,
  validFrom: row.valid_from,
  ...(row.invalid_at === null ? {} : { invalidAt: row.invalid_at }),
  ...(row.last_retrieved_at === null ? {} : { lastRetrievedAt: row.last_retrieved_at }),
  uses: row.uses,
  rev: row.rev,
  deleted: row.deleted === 1,
});
const toRow = (row: MemoryRow) => ({
  ...Struct.omit(row, ["workspace_id"]),
  source_json: JSON.stringify(row.source_json),
});

const fail = (reason: Telescope.WorkspaceError["reason"], message: string) =>
  Effect.fail(new Telescope.WorkspaceError({ reason, message }));

/** An agent run acting for the member id its run record names first. */
export interface ThreadAgent {
  readonly memberId: string;
  readonly workspaceId: Telescope.WorkspaceId;
  readonly run: {
    readonly runId: Telescope.AgentRunId;
    readonly agentId: Telescope.AgentId;
    readonly threadId: ThreadId;
  };
}
/** A member acting directly through their auth session, or an agent run. */
type MemoryCaller = { readonly session: WorkspaceService.Caller } | ThreadAgent;
export type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;
type Rpcs = (typeof Telescope.MemoryRpcs)[number];
type In<Tag extends Rpcs["_tag"]> = Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>;
type Method<Tag extends Rpcs["_tag"]> = (
  caller: MemoryCaller,
  input: In<Tag>,
) => Effect.Effect<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>, Failure>;

export class MemoryService extends Context.Service<
  MemoryService,
  {
    readonly search: Method<"telescope.memory.search">;
    readonly write: Method<"telescope.memory.write">;
    readonly pin: Method<"telescope.memory.pin">;
    /** Resolves the agent behind a thread from its newest unfinished Telescope run. */
    readonly callerForThread: (threadId: ThreadId) => Effect.Effect<ThreadAgent, Failure>;
  }
>()("t3/telescope/MemoryService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const random = yield* SecureRandom.SecureRandom;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const agentsOf = (workspaceId: Telescope.WorkspaceId) =>
    db
      .select(workspaceId, "agents", decodeAgents)
      .pipe(Effect.map((rows) => new Map(rows.map((row) => [row.agent_id, row]))));

  // A session acts as its linked member; a run acts for its member only while they stay active.
  const actingMember = Effect.fn("MemoryService.actingMember")(function* (
    caller: MemoryCaller,
    workspaceId: Telescope.WorkspaceId,
  ) {
    if ("session" in caller) {
      const { workspace, self } = yield* workspaces.get(caller.session, { workspaceId });
      return { kind: workspace.kind, memberId: self.subjectId, role: self.role };
    }
    const [member] =
      caller.workspaceId === workspaceId
        ? yield* db.select(workspaceId, "members", decodeMembers, {
            subject_id: caller.memberId,
            revoked_at: null,
          })
        : [];
    const [workspace] = yield* db.select(workspaceId, "workspaces", decodeWorkspaceKinds);
    if (member === undefined || workspace === undefined)
      return yield* fail("forbidden", "You are not a member of this workspace.");
    return { kind: workspace.kind, memberId: member.subject_id, role: member.role };
  });

  // A run acts only for its own agent; a member acts for agents they own, admins for company ones.
  const requireWriter = Effect.fn("MemoryService.requireWriter")(function* (
    caller: MemoryCaller,
    workspaceId: Telescope.WorkspaceId,
    agentId: string,
  ) {
    const self = yield* actingMember(caller, workspaceId);
    const agent = (yield* agentsOf(workspaceId)).get(Telescope.AgentId.make(agentId));
    if (agent === undefined) return yield* fail("not_found", "Agent not found.");
    const allowed =
      "session" in caller
        ? agent.owner_subject_id === null
          ? self.role === "admin"
          : agent.owner_subject_id === self.memberId
        : caller.run.agentId === agent.agent_id;
    if (!allowed) return yield* fail("forbidden", "You cannot change this agent's memories.");
    return { workspace: self, agent };
  });

  const existing = Effect.fn("MemoryService.existing")(function* (
    workspaceId: Telescope.WorkspaceId,
    memoryId: string | undefined,
  ) {
    if (memoryId === undefined) return yield* fail("invalid", "This operation needs a memory id.");
    const [row] = yield* db.select(workspaceId, "memories", decodeMemories, {
      memory_id: memoryId,
      deleted: 0,
    });
    if (row === undefined) return yield* fail("not_found", "Memory not found.");
    return row;
  });

  const search = Effect.fn("MemoryService.search")(function* (
    caller: MemoryCaller,
    input: In<"telescope.memory.search">,
  ) {
    const { workspaceId } = input;
    const self = yield* actingMember(caller, workspaceId);
    const at = yield* now;
    const rows = yield* db.searchMemories(workspaceId, input.query, decodeMemories, {
      validAt: input.includeInvalidated === true ? undefined : at,
      where: {
        deleted: 0,
        ...(input.agentId === undefined ? {} : { agent_id: input.agentId }),
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.projectId === undefined ? {} : { project_id: input.projectId }),
        ...(input.aboutSubjectId === undefined ? {} : { about_subject_id: input.aboutSubjectId }),
      },
    });
    const agents = yield* agentsOf(workspaceId);
    const callerAgent = "run" in caller ? agents.get(caller.run.agentId) : undefined;
    const asCompanyAgent =
      callerAgent !== undefined && COMPANY_AGENT_KINDS.includes(callerAgent.kind);
    // A run reads only its own agent's private memories; a member reads those of agents they own.
    // confidential and internal both reach every active member until guests exist.
    const ownsPrivate = (row: MemoryRow) =>
      "run" in caller
        ? row.agent_id === caller.run.agentId
        : agents.get(row.agent_id)?.owner_subject_id === self.memberId;
    const visible = (row: MemoryRow) =>
      (row.level !== "private" || ownsPrivate(row)) &&
      (row.scope !== "person" || asCompanyAgent || row.about_subject_id === self.memberId);
    const found = rows.filter(visible).slice(0, input.limit ?? DEFAULT_LIMIT);
    yield* db.markMemoriesRetrieved(
      workspaceId,
      found.map((row) => row.memory_id),
      at,
    );
    return {
      memories: found.map((row) => toMemory({ ...row, last_retrieved_at: at, uses: row.uses + 1 })),
    };
  });

  const write = Effect.fn("MemoryService.write")(function* (
    caller: MemoryCaller,
    input: In<"telescope.memory.write">,
  ) {
    const { workspaceId } = input;
    const { workspace, agent } = yield* requireWriter(caller, workspaceId, input.agentId);
    const at = yield* now;
    if (input.op === "add") {
      if (input.text === undefined) return yield* fail("invalid", "add needs the memory text.");
      const scope = input.scope ?? "personal";
      if (
        scope === "person" &&
        (workspace.kind !== "enterprise" || !COMPANY_AGENT_KINDS.includes(agent.kind))
      )
        return yield* fail("forbidden", "Only company agents keep records about people.");
      const row: MemoryRow = {
        memory_id: Telescope.MemoryId.make(yield* random.uuidV4()),
        workspace_id: workspaceId,
        agent_id: agent.agent_id,
        scope,
        // Layers other than these two are not written yet.
        layer: scope === "person" ? "person" : "long_term",
        // Nobody owns a company agent, so its private memories would reach no one.
        level: input.level ?? (agent.owner_subject_id === null ? "confidential" : "private"),
        project_id: input.projectId ?? null,
        about_subject_id: input.aboutSubjectId ?? null,
        kind: input.kind ?? "fact",
        text: input.text,
        source_json:
          "run" in caller ? { runId: caller.run.runId, threadId: caller.run.threadId } : {},
        pinned: input.pinned === true ? 1 : 0,
        valid_from: at,
        invalid_at: null,
        last_retrieved_at: null,
        uses: 0,
        rev: 0,
        deleted: 0,
      };
      yield* db.insert(workspaceId, "memories", toRow(row));
      return toMemory(row);
    }
    const current = yield* existing(workspaceId, input.id);
    if (current.agent_id !== agent.agent_id) return yield* fail("not_found", "Memory not found.");
    if (input.op === "noop") return toMemory(current);
    if (current.invalid_at !== null && current.invalid_at <= at)
      return yield* fail("conflict", "This memory is already invalidated.");
    if (input.op === "invalidate") {
      yield* db.update(
        workspaceId,
        "memories",
        { invalid_at: at },
        { memory_id: current.memory_id },
      );
      return toMemory({ ...current, invalid_at: at });
    }
    if (input.text === undefined) return yield* fail("invalid", "update needs the new text.");
    // The id always names the current revision; earlier ones keep their text under `<id>@<rev>`.
    const next: MemoryRow = {
      ...current,
      kind: input.kind ?? current.kind,
      level: input.level ?? current.level,
      text: input.text,
      valid_from: at,
      rev: current.rev + 1,
    };
    yield* db.transaction(
      Effect.all([
        db.insert(
          workspaceId,
          "memories",
          toRow({
            ...current,
            memory_id: Telescope.MemoryId.make(`${current.memory_id}@${current.rev}`),
            invalid_at: at,
          }),
        ),
        db.update(
          workspaceId,
          "memories",
          { kind: next.kind, level: next.level, text: next.text, valid_from: at, rev: next.rev },
          { memory_id: current.memory_id },
        ),
      ]),
    );
    return toMemory(next);
  });

  const pin = Effect.fn("MemoryService.pin")(function* (
    caller: MemoryCaller,
    input: In<"telescope.memory.pin">,
  ) {
    const current = yield* existing(input.workspaceId, input.id);
    yield* requireWriter(caller, input.workspaceId, current.agent_id);
    const pinned = input.pinned ? 1 : 0;
    yield* db.update(input.workspaceId, "memories", { pinned }, { memory_id: current.memory_id });
    return toMemory({ ...current, pinned });
  });

  const callerForThread = Effect.fn("MemoryService.callerForThread")(function* (
    threadId: ThreadId,
  ) {
    const [run] = yield* db.latestRunForThread(threadId, decodeRuns);
    const memberId = run?.on_behalf_of_json[0];
    if (run === undefined || memberId === undefined)
      return yield* fail("forbidden", "Memory tools are for Telescope agent runs.");
    const agent: ThreadAgent = {
      memberId,
      workspaceId: run.workspace_id,
      run: { runId: run.run_id, agentId: run.agent_id, threadId },
    };
    return agent;
  });

  return MemoryService.of({ search, write, pin, callerForThread });
});

export const layer = Layer.effect(MemoryService, make).pipe(
  Layer.provide(Layer.merge(TelescopeDb.layer, WorkspaceService.layer)),
);
