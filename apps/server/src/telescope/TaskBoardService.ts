import { Telescope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
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
const decodeTask = Schema.decodeUnknownEffect(Telescope.Task);

const TASK_FIELDS = Object.keys(Telescope.TaskFields.fields) as ReadonlyArray<
  keyof Telescope.TaskFields
>;
const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
type Author = Actor & { readonly authorId: string };
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

/** The shared task board: tasks with a commit per write, and the append-only decision chain. */
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
      })),
    );

  /** Appends the commit for one write to a board item, chained to the item's previous commit. */
  const recordCommit = Effect.fn("TaskBoardService.recordCommit")(function* (
    author: Author,
    item: { readonly workspaceId: Telescope.WorkspaceId; readonly id: Telescope.BoardItemId },
    baseVersion: number,
    changedFields: Record<string, Schema.Json>,
    at: string,
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
      mergeLevel: 0,
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

  /**
   * The one write path for tasks: check the base version, apply structured fields, append free
   * text, bump the version and record the commit. Merging stale writes extends here.
   */
  const commitTask = Effect.fn("TaskBoardService.commitTask")(function* (
    author: Author,
    input: In<"telescope.task.update">,
    current: Telescope.Task,
  ) {
    if (current.version !== input.baseVersion)
      return yield* new Telescope.StaleTaskVersionError({
        taskId: current.id,
        baseVersion: input.baseVersion,
        currentVersion: current.version,
      });
    const fields = input.set ?? {};
    const changedFields: Record<string, Schema.Json> = {};
    for (const key of TASK_FIELDS) {
      if (key in fields && !sameJson(fields[key], current[key]))
        changedFields[key] = fields[key] ?? null;
    }
    const at = yield* now;
    const entry =
      input.note === undefined ? [] : [{ authorId: author.authorId, text: input.note, at }];
    if (entry.length > 0) changedFields.freeText = entry;
    if (Object.keys(changedFields).length === 0) return current;
    const limit = Telescope.BOARD_LIMITS.freeTextEntries;
    if (entry.length > 0 && current.freeText.length >= limit)
      return yield* new Telescope.FreeTextLimitError({ taskId: current.id, limit });

    const written = { ...changedFields, freeText: [...current.freeText, ...entry] };
    const stamp = { version: current.version + 1, updatedAt: at };
    const merged: Record<string, unknown> = { ...current, ...written, ...stamp };
    for (const key of TASK_FIELDS) if (merged[key] === null) delete merged[key];
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
    yield* recordCommit(author, next, current.version, changedFields, at);
    return next;
  });

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
    return yield* findTask(input.workspaceId, input.taskId);
  });

  const listTasks = Effect.fn("TaskBoardService.listTasks")(function* (
    actor: Actor,
    { workspaceId, ...filter }: In<"telescope.task.list">,
  ) {
    yield* requireMember(actor, workspaceId);
    const where = { kind: "task", ...toColumns(filter, "item_id") };
    const tasks = yield* db.select(workspaceId, "tasks", decodeTasks, where);
    const listed = Telescope.BOARD_LIMITS.listedFreeTextEntries;
    return { tasks: tasks.map((task) => ({ ...task, freeText: task.freeText.slice(-listed) })) };
  });

  const createDecision = Effect.fn("TaskBoardService.createDecision")(function* (
    actor: Actor,
    { workspaceId, ...input }: In<"telescope.decision.create">,
  ) {
    const author = yield* requireMember(actor, workspaceId);
    const { authorId } = author;
    const at = yield* now;
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
    return yield* db.transaction(
      Effect.gen(function* () {
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
        const created: Record<string, Schema.Json> = {
          title: input.title,
          text: input.text,
          status,
        };
        for (const key of ["supersedes", "options", "chosen"] as const) {
          const value = input[key];
          if (value !== undefined) created[key] = value;
        }
        yield* recordCommit(author, decision, 0, created, at);
        return decision;
      }),
    );
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

  return TaskBoardService.of({
    createTask,
    updateTask,
    getTask,
    listTasks,
    createDecision,
    listDecisions,
    listCommits,
  });
});

export const layer = Layer.effect(TaskBoardService, make).pipe(
  Layer.provide(Layer.merge(TelescopeDb.layer, WorkspaceService.layer)),
);
