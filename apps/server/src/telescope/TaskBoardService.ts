import { Telescope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import { mergeStale } from "./TaskMerge.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

type Columns = Record<string, string | number | null>;

const JSON_FIELDS = new Set([
  "forgeIssue",
  "goalChain",
  "freeText",
  "options",
  "onBehalfOf",
  "changedFields",
]);
/**
 * Columns are the snake_case field names; JSON values live in `<name>_json` TEXT columns.
 * `workspaceId` is left out because the repository writes `workspace_id` itself.
 */
const toColumns = (item: Readonly<Record<string, unknown>>, idColumn: string): Columns =>
  Object.fromEntries(
    Object.entries(item)
      .filter(([key]) => key !== "workspaceId")
      .map(([key, value]) => {
        const column =
          key === "id" ? idColumn : key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        if (JSON_FIELDS.has(key))
          return [`${column}_json`, value === null ? null : JSON.stringify(value)];
        return [column, typeof value === "string" || typeof value === "number" ? value : null];
      }),
  );
const parseJson = (text: unknown) => {
  try {
    return typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    return text;
  }
};
const RawRows = Schema.Array(Schema.Record(Schema.String, Schema.Unknown));
const decodeRaw = Schema.decodeUnknownEffect(RawRows);
/** Null columns become absent keys; columns the schema does not name are dropped by decoding. */
const rowsAs = <S extends Schema.Top>(schema: S, idColumn: string) => {
  const decode = Schema.decodeUnknownEffect(Schema.Array(schema));
  return (rows: unknown) =>
    decodeRaw(rows).pipe(
      Effect.flatMap((raw) =>
        decode(
          raw.map((row) =>
            Object.fromEntries(
              Object.entries(row)
                .filter(([, value]) => value !== null)
                .map(([column, value]) => [
                  column === idColumn
                    ? "id"
                    : column
                        .replace(/_json$/, "")
                        .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
                  column.endsWith("_json") ? parseJson(value) : value,
                ]),
            ),
          ),
        ),
      ),
    );
};
const decodeTasks = rowsAs(Telescope.Task, "item_id");
const decodeDecisions = rowsAs(Telescope.Decision, "item_id");
const decodeCommits = rowsAs(Telescope.TaskCommit, "commit_id");
const decodeLeases = rowsAs(Telescope.Lease, "lease_id");
const decodeTask = Schema.decodeUnknownEffect(Telescope.Task);

const TASK_FIELDS = Object.keys(Telescope.TaskFields.fields) as ReadonlyArray<
  keyof Telescope.TaskFields
>;
const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const LEASE_TTL = { minutes: 2 };
const isExpired = (lease: Telescope.Lease, at: string) =>
  Date.parse(lease.expiresAt) <= Date.parse(at);

const fail = (reason: Telescope.WorkspaceError["reason"], message: string) =>
  Effect.fail(new Telescope.WorkspaceError({ reason, message }));

/**
 * Who writes. `caller` is the auth session; `WorkspaceService` resolves it to the member it acts
 * as. An agent acting for that member passes its own `authorId` and the delegation chain, member
 * first.
 */
export type Actor = {
  readonly caller: WorkspaceService.Caller;
  readonly authorId?: string;
  readonly onBehalfOf?: ReadonlyArray<string>;
  readonly deviceSig?: string;
};
/** An actor after membership is checked: `authorId` is the agent or else the member id. */
type Author = Actor & { readonly authorId: string; readonly memberId: string };
type Committer = Pick<Author, "authorId" | "onBehalfOf" | "deviceSig">;
type Merge = Pick<Telescope.TaskCommit, "mergeLevel" | "mergeReason">;
type FreeTextEntry = Telescope.Task["freeText"][number];
/** Writes the server makes on its own, such as expiring a lease. */
const SERVER: Committer = { authorId: "server" };
type Failure =
  | Telescope.WorkspaceError
  | Telescope.StaleTaskVersionError
  | Telescope.FreeTextLimitError
  | PersistenceSqlError
  | PersistenceDecodeError;
type Rpcs = (typeof Telescope.TaskBoardRpcs)[number];
type In<Tag extends Rpcs["_tag"]> = Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>;
type Method<Tag extends Rpcs["_tag"]> = (
  actor: Actor,
  input: In<Tag>,
) => Effect.Effect<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>, Failure>;

/**
 * The shared task board: tasks with a commit per write, the append-only decision chain, and
 * leases that give a task one holder at a time.
 */
export class TaskBoardService extends Context.Service<
  TaskBoardService,
  {
    readonly createTask: Method<"telescope.task.create">;
    readonly updateTask: Method<"telescope.task.update">;
    readonly getTask: Method<"telescope.task.get">;
    readonly listTasks: Method<"telescope.task.list">;
    readonly createDecision: Method<"telescope.decision.create">;
    readonly listDecisions: Method<"telescope.decision.list">;
    readonly listCommits: Method<"telescope.commit.list">;
    readonly acquireLease: Method<"telescope.lease.acquire">;
    readonly heartbeatLease: Method<"telescope.lease.heartbeat">;
    readonly releaseLease: Method<"telescope.lease.release">;
  }
>()("t3/telescope/TaskBoardService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const random = yield* SecureRandom.SecureRandom;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const requireMember = (actor: Actor, workspaceId: Telescope.WorkspaceId) =>
    workspaces.get(actor.caller, { workspaceId }).pipe(
      Effect.map(({ self }): Author => ({
        ...actor,
        authorId: actor.authorId ?? self.subjectId,
        memberId: self.subjectId,
      })),
    );

  /** Appends the commit for one write to a board item, chained to the item's previous commit. */
  const recordCommit = Effect.fn("TaskBoardService.recordCommit")(function* (
    author: Committer,
    item: { readonly workspaceId: Telescope.WorkspaceId; readonly id: Telescope.BoardItemId },
    baseVersion: number,
    changedFields: Record<string, Schema.Json>,
    at: string,
    merge: Merge = { mergeLevel: 0 },
  ) {
    const [parent] = yield* db.select(item.workspaceId, "task_commits", decodeCommits, {
      task_id: item.id,
      base_version: baseVersion - 1,
    });
    const commit: Telescope.TaskCommit = {
      id: Telescope.TaskCommitId.make(yield* random.uuidV4()),
      ...(parent === undefined ? {} : { parentId: parent.id }),
      workspaceId: item.workspaceId,
      taskId: item.id,
      authorId: author.authorId,
      ...(author.onBehalfOf === undefined ? {} : { onBehalfOf: author.onBehalfOf }),
      ...(author.deviceSig === undefined ? {} : { deviceSig: author.deviceSig }),
      baseVersion,
      changedFields,
      mergeLevel: merge.mergeLevel,
      ...(merge.mergeReason === undefined ? {} : { mergeReason: merge.mergeReason }),
      createdAt: at,
    };
    yield* db.insert(item.workspaceId, "task_commits", toColumns(commit, "commit_id"));
  });

  const findTask = Effect.fn("TaskBoardService.findTask")(function* (
    workspaceId: Telescope.WorkspaceId,
    taskId: Telescope.Task["id"],
  ) {
    const where = { kind: "task", item_id: taskId };
    const [task] = yield* db.select(workspaceId, "tasks", decodeTasks, where);
    if (task === undefined) return yield* fail("not_found", "Task not found.");
    return task;
  });

  /** Writes `fields` and appends `notes` as the task's next version, with its commit. */
  const applyCommit = Effect.fn("TaskBoardService.applyCommit")(function* (
    author: Committer,
    current: Telescope.Task,
    fields: Record<string, Schema.Json>,
    notes: ReadonlyArray<FreeTextEntry>,
    at: string,
    merge?: Merge,
  ) {
    const changedFields = notes.length === 0 ? fields : { ...fields, freeText: notes };
    const written = { ...fields, freeText: [...current.freeText, ...notes] };
    const stamp = { version: current.version + 1, updatedAt: at };
    const merged: Record<string, unknown> = { ...current, ...written, ...stamp };
    for (const key of [...TASK_FIELDS, "leaseId"]) if (merged[key] === null) delete merged[key];
    const next = yield* decodeTask(merged).pipe(
      Effect.mapError(
        () => new Telescope.WorkspaceError({ reason: "conflict", message: "Invalid task fields." }),
      ),
    );
    yield* current.version === 0
      ? db.insert(next.workspaceId, "tasks", toColumns(next, "item_id"))
      : db.update(next.workspaceId, "tasks", toColumns({ ...written, ...stamp }, "item_id"), {
          item_id: next.id,
          version: current.version,
        });
    yield* recordCommit(author, next, current.version, changedFields, at, merge);
    return next;
  });

  const activeLease = Effect.fn("TaskBoardService.activeLease")(function* (
    task: Telescope.Task,
    at: string,
  ) {
    const where = { task_id: task.id };
    const [lease] = yield* db.select(task.workspaceId, "leases", decodeLeases, where);
    return lease === undefined || isExpired(lease, at) ? undefined : lease;
  });

  /**
   * The one write path for tasks. A stale `baseVersion` is merged onto the current version by
   * `mergeStale`; a conflict no rule settles moves the task to `needs_decision` and proposes a
   * decision that records both sides.
   */
  const commitTask = Effect.fn("TaskBoardService.commitTask")(function* (
    author: Author,
    input: In<"telescope.task.update">,
    current: Telescope.Task,
  ) {
    if (input.baseVersion > current.version)
      return yield* new Telescope.StaleTaskVersionError({
        taskId: current.id,
        baseVersion: input.baseVersion,
        currentVersion: current.version,
      });
    const set = input.set ?? {};
    const mine: Record<string, Schema.Json> = {};
    for (const key of TASK_FIELDS) {
      if (key in set && !sameJson(set[key], current[key])) mine[key] = set[key] ?? null;
    }
    const at = yield* now;
    const notes =
      input.note === undefined ? [] : [{ authorId: author.authorId, text: input.note, at }];
    const limit = Telescope.BOARD_LIMITS.freeTextEntries;
    if (notes.length > 0 && current.freeText.length >= limit)
      return yield* new Telescope.FreeTextLimitError({ taskId: current.id, limit });
    if (input.baseVersion === current.version) {
      if (Object.keys(mine).length === 0 && notes.length === 0) return current;
      return yield* applyCommit(author, current, mine, notes, at);
    }

    const where = { task_id: current.id };
    const history = yield* db.select(current.workspaceId, "task_commits", decodeCommits, where);
    const lease = yield* activeLease(current, at);
    const { fields, conflicts, ...merge } = mergeStale({
      current,
      mine,
      history,
      baseVersion: input.baseVersion,
      authorId: author.authorId,
      leaseHolder: lease?.holderAgentId,
    });
    if (conflicts.length > 0) {
      const decision = yield* proposeConflict(author, current, input, conflicts, at);
      const marked = { ...fields, conflictDecisionId: decision.id };
      const next = yield* applyCommit(author, current, marked, notes, at, {
        mergeLevel: 2,
        mergeReason: `${merge.mergeReason}; no rule settles ${conflicts.join(", ")}; decision ${decision.id}`,
      });
      return { ...next, conflict: { decisionId: decision.id } };
    }
    const unchanged = Object.keys(fields).length === 0 && notes.length === 0;
    if (unchanged && merge.mergeLevel === 0) return current;
    return yield* applyCommit(author, current, fields, notes, at, merge);
  });

  /**
   * The proposed decision for the fields of a stale write no rule settles; its text holds both
   * sides. The task points at it through `conflictDecisionId`.
   */
  const proposeConflict = (
    author: Author,
    current: Telescope.Task,
    input: In<"telescope.task.update">,
    fields: ReadonlyArray<string>,
    at: string,
  ) => {
    const incoming: Readonly<Record<string, unknown>> = input.set ?? {};
    const existing: Readonly<Record<string, unknown>> = current;
    const sides = (key: string) => ({
      current: existing[key] ?? null,
      incoming: incoming[key] ?? null,
    });
    const title = `冲突：${current.title}`.slice(0, Telescope.BOARD_LIMITS.titleLength).trim();
    return writeDecision(
      author,
      current.workspaceId,
      {
        title,
        text: JSON.stringify({
          taskId: current.id,
          version: current.version,
          incoming: { authorId: author.authorId, baseVersion: input.baseVersion, set: incoming },
          conflicts: Object.fromEntries(fields.map((key) => [key, sides(key)])),
        }),
        status: "proposed",
        options: [
          { id: "keep", label: "保留当前值" },
          { id: "incoming", label: "采用新提交" },
        ],
      },
      at,
    );
  };

  const createTask = Effect.fn("TaskBoardService.createTask")(function* (
    actor: Actor,
    { workspaceId, ...set }: In<"telescope.task.create">,
  ) {
    const author = yield* requireMember(actor, workspaceId);
    const taskId = Telescope.TaskId.make(yield* random.uuidV4());
    const at = yield* now;
    const blank: Telescope.Task = {
      kind: "task",
      id: taskId,
      workspaceId,
      title: "",
      status: "todo",
      goalChain: [],
      freeText: [],
      createdAt: at,
      updatedAt: at,
      version: 0,
    };
    return yield* db.transaction(
      commitTask(author, { workspaceId, taskId, baseVersion: 0, set }, blank),
    );
  });

  const updateTask = Effect.fn("TaskBoardService.updateTask")(function* (
    actor: Actor,
    input: In<"telescope.task.update">,
  ) {
    const author = yield* requireMember(actor, input.workspaceId);
    return yield* db.transaction(
      findTask(input.workspaceId, input.taskId).pipe(
        Effect.flatMap((current) => commitTask(author, input, current)),
      ),
    );
  });

  const getTask = Effect.fn("TaskBoardService.getTask")(function* (
    actor: Actor,
    input: In<"telescope.task.get">,
  ) {
    yield* requireMember(actor, input.workspaceId);
    yield* expireLeases(input.workspaceId);
    return yield* findTask(input.workspaceId, input.taskId);
  });

  const listTasks = Effect.fn("TaskBoardService.listTasks")(function* (
    actor: Actor,
    { workspaceId, ...filter }: In<"telescope.task.list">,
  ) {
    yield* requireMember(actor, workspaceId);
    yield* expireLeases(workspaceId);
    const where = { kind: "task", ...toColumns(filter, "item_id") };
    const tasks = yield* db.select(workspaceId, "tasks", decodeTasks, where);
    const listed = Telescope.BOARD_LIMITS.listedFreeTextEntries;
    return { tasks: tasks.map((task) => ({ ...task, freeText: task.freeText.slice(-listed) })) };
  });

  const writeDecision = Effect.fn("TaskBoardService.writeDecision")(function* (
    author: Author,
    workspaceId: Telescope.WorkspaceId,
    input: Omit<In<"telescope.decision.create">, "workspaceId">,
    at: string,
  ) {
    const { authorId } = author;
    const status = input.status ?? "decided";
    const decision: Telescope.Decision = {
      ...input,
      kind: "decision",
      id: Telescope.DecisionId.make(yield* random.uuidV4()),
      workspaceId,
      authorId,
      status,
      ...(status === "decided" ? { decidedBy: authorId, decidedAt: at } : {}),
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const findDecision = (id: Telescope.DecisionId) =>
      db
        .select(workspaceId, "tasks", decodeDecisions, { kind: "decision", item_id: id })
        .pipe(Effect.map(([found]) => found));
    const retire = (old: Telescope.Decision) =>
      db
        .update(
          workspaceId,
          "tasks",
          { status: "superseded", updated_at: at, version: old.version + 1 },
          { kind: "decision", item_id: old.id, version: old.version },
        )
        .pipe(Effect.andThen(recordCommit(author, old, old.version, { status: "superseded" }, at)));
    if (decision.supersedes !== undefined) {
      const old = yield* findDecision(decision.supersedes);
      if (old === undefined) return yield* fail("not_found", "Decision not found.");
      // Two decisions replacing the same one is a conflict for a person to settle.
      if (old.status === "superseded")
        return yield* fail("conflict", "That decision has already been superseded.");
      if (status === "decided") {
        // Deciding a proposal also retires what it proposed to replace: one step, no recursion.
        const target =
          old.status === "proposed" && old.supersedes !== undefined
            ? yield* findDecision(old.supersedes)
            : undefined;
        if (target?.status === "superseded")
          return yield* fail("conflict", "That decision has already been superseded.");
        yield* retire(old);
        if (target !== undefined) yield* retire(target);
      }
    }
    yield* db.insert(workspaceId, "tasks", toColumns(decision, "item_id"));
    const created: Record<string, Schema.Json> = { title: input.title, text: input.text, status };
    for (const key of ["supersedes", "options", "chosen"] as const) {
      const value = input[key];
      if (value !== undefined) created[key] = value;
    }
    yield* recordCommit(author, decision, 0, created, at);
    return decision;
  });

  const createDecision = Effect.fn("TaskBoardService.createDecision")(function* (
    actor: Actor,
    { workspaceId, ...input }: In<"telescope.decision.create">,
  ) {
    const author = yield* requireMember(actor, workspaceId);
    return yield* db.transaction(writeDecision(author, workspaceId, input, yield* now));
  });

  const listDecisions = Effect.fn("TaskBoardService.listDecisions")(function* (
    actor: Actor,
    { workspaceId }: In<"telescope.decision.list">,
  ) {
    yield* requireMember(actor, workspaceId);
    const where = { kind: "decision" };
    return { decisions: yield* db.select(workspaceId, "tasks", decodeDecisions, where) };
  });

  const listCommits = Effect.fn("TaskBoardService.listCommits")(function* (
    actor: Actor,
    { workspaceId, taskId }: In<"telescope.commit.list">,
  ) {
    yield* requireMember(actor, workspaceId);
    const where = { task_id: taskId };
    const commits = yield* db.select(workspaceId, "task_commits", decodeCommits, where);
    return { commits: commits.toSorted((a, b) => a.baseVersion - b.baseVersion) };
  });

  /** Removes a lease and clears it from its task, so the task can be acquired again. */
  const dropLease = Effect.fn("TaskBoardService.dropLease")(function* (
    author: Committer,
    lease: Telescope.Lease,
    at: string,
  ) {
    yield* db.remove(lease.workspaceId, "leases", { lease_id: lease.id });
    const where = { kind: "task", item_id: lease.taskId };
    const [task] = yield* db.select(lease.workspaceId, "tasks", decodeTasks, where);
    if (task?.leaseId === lease.id) yield* applyCommit(author, task, { leaseId: null }, [], at);
  });

  /** Expiry runs on every board read, so no timer has to be alive for a lease to lapse. */
  const expireLeases = Effect.fn("TaskBoardService.expireLeases")(function* (
    workspaceId: Telescope.WorkspaceId,
  ) {
    const at = yield* now;
    const leases = db.select(workspaceId, "leases", decodeLeases);
    const expired = (all: ReadonlyArray<Telescope.Lease>) => all.filter((l) => isExpired(l, at));
    if (expired(yield* leases).length === 0) return;
    // Re-read under the writer lock so a heartbeat that committed after the first read survives.
    yield* db.transaction(
      Effect.flatMap(leases, (all) =>
        Effect.forEach(expired(all), (lease) => dropLease(SERVER, lease, at)),
      ),
    );
  });

  const acquireLease = Effect.fn("TaskBoardService.acquireLease")(function* (
    actor: Actor,
    { workspaceId, taskId }: In<"telescope.lease.acquire">,
  ) {
    const author = yield* requireMember(actor, workspaceId);
    const time = yield* DateTime.now;
    const at = DateTime.formatIso(time);
    return yield* db.transaction(
      Effect.gen(function* () {
        const where = { task_id: taskId };
        const [held] = yield* db.select(workspaceId, "leases", decodeLeases, where);
        if (held !== undefined && !isExpired(held, at))
          return yield* fail("conflict", `Task is leased until ${held.expiresAt}.`);
        if (held !== undefined) yield* dropLease(SERVER, held, at);
        const task = yield* findTask(workspaceId, taskId);
        const lease: Telescope.Lease = {
          id: Telescope.LeaseId.make(yield* random.uuidV4()),
          workspaceId,
          taskId,
          holderAgentId: Telescope.AgentId.make(author.authorId),
          holderSubjectId: author.memberId,
          acquiredAt: at,
          heartbeatAt: at,
          expiresAt: DateTime.formatIso(DateTime.add(time, LEASE_TTL)),
        };
        yield* db.insert(workspaceId, "leases", toColumns(lease, "lease_id"));
        yield* applyCommit(author, task, { leaseId: lease.id }, [], at);
        return lease;
      }),
    );
  });

  const heldLease = Effect.fn("TaskBoardService.heldLease")(function* (
    member: Author,
    { workspaceId, leaseId }: In<"telescope.lease.heartbeat">,
    at: string,
  ) {
    const where = { lease_id: leaseId };
    const [lease] = yield* db.select(workspaceId, "leases", decodeLeases, where);
    if (lease === undefined || isExpired(lease, at))
      return yield* fail("not_found", "Lease not found or expired.");
    // Any device or agent of the holding member may renew or release, so a stuck agent's lease
    // can be freed by its member without waiting for expiry.
    if (lease.holderSubjectId !== member.memberId)
      return yield* fail("forbidden", "Only the lease holder can do this.");
    return lease;
  });

  const heartbeatLease = Effect.fn("TaskBoardService.heartbeatLease")(function* (
    actor: Actor,
    input: In<"telescope.lease.heartbeat">,
  ) {
    const member = yield* requireMember(actor, input.workspaceId);
    const time = yield* DateTime.now;
    const at = DateTime.formatIso(time);
    return yield* db.transaction(
      Effect.gen(function* () {
        const lease = yield* heldLease(member, input, at);
        const expiresAt = DateTime.formatIso(DateTime.add(time, LEASE_TTL));
        const set = { heartbeat_at: at, expires_at: expiresAt };
        yield* db.update(input.workspaceId, "leases", set, { lease_id: lease.id });
        return { ...lease, heartbeatAt: at, expiresAt };
      }),
    );
  });

  const releaseLease = Effect.fn("TaskBoardService.releaseLease")(function* (
    actor: Actor,
    input: In<"telescope.lease.release">,
  ) {
    const member = yield* requireMember(actor, input.workspaceId);
    const at = yield* now;
    yield* db.transaction(
      heldLease(member, input, at).pipe(Effect.flatMap((lease) => dropLease(member, lease, at))),
    );
    return {};
  });

  return TaskBoardService.of({
    createTask,
    updateTask,
    getTask,
    listTasks,
    createDecision,
    listDecisions,
    listCommits,
    acquireLease,
    heartbeatLease,
    releaseLease,
  });
});

export const layer = Layer.effect(TaskBoardService, make).pipe(
  Layer.provide(Layer.merge(TelescopeDb.layer, WorkspaceService.layer)),
);
