import * as Schema from "effect/Schema";

import { ProjectId, ThreadId } from "../baseSchemas.ts";
import {
  AgentId,
  BoardItemId,
  Count,
  DecisionId,
  DelegationId,
  LeaseId,
  Strings,
  SubjectId,
  TaskId,
  Text,
  Timestamp,
  WorkspaceId,
} from "./common.ts";
import { Decision, ForgeIssueRef, Lease, Task, TaskCommit, TaskStatus } from "./board.ts";

const InWorkspace = { workspaceId: WorkspaceId };

/** Bounds that keep every board read small; lengths are in UTF-16 code units. */
export const BOARD_LIMITS = {
  titleLength: 200,
  noteLength: 8 * 1024,
  decisionTextLength: 32 * 1024,
  freeTextEntries: 500,
  listedFreeTextEntries: 20,
} as const;
const Title = Text.check(Schema.isMaxLength(BOARD_LIMITS.titleLength));

/** Structured fields agents act on. `null` clears an optional field. */
export const TaskFields = Schema.Struct({
  title: Schema.optionalKey(Title),
  status: Schema.optionalKey(TaskStatus),
  projectId: Schema.optionalKey(Schema.NullOr(ProjectId)),
  ownerSubjectId: Schema.optionalKey(Schema.NullOr(SubjectId)),
  ownerAgentId: Schema.optionalKey(Schema.NullOr(AgentId)),
  forgeIssue: Schema.optionalKey(Schema.NullOr(ForgeIssueRef)),
  threadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  goalChain: Schema.optionalKey(Strings),
  /** Only older servers set the conflict marker; a client can only clear it once settled. */
  conflictDecisionId: Schema.optionalKey(Schema.Null),
});
export type TaskFields = typeof TaskFields.Type;

export const TaskCreateInput = Schema.Struct({
  ...InWorkspace,
  ...TaskFields.fields,
  title: Title,
});
/** `note` is appended to the task's free text under the caller's name; it never edits an entry. */
export const TaskUpdateInput = Schema.Struct({
  ...InWorkspace,
  taskId: TaskId,
  baseVersion: Count,
  set: Schema.optionalKey(TaskFields),
  note: Schema.optionalKey(Text.check(Schema.isMaxLength(BOARD_LIMITS.noteLength))),
});
/**
 * `overwrote`: the keys this write replaced whose last change after its `baseVersion` was another
 * author's. An author is an id plus the member it acts for, so `by` can be the writer's own id
 * when it wrote for another member. `name` reads "<agent> for <member>", or "an agent for <member>"
 * when the writer's member cannot see that agent. Older servers set `conflict` instead.
 */
export const TaskUpdateResult = Schema.Struct({
  ...Task.fields,
  overwrote: Schema.optionalKey(
    Schema.Array(Schema.Struct({ key: Schema.String, by: Text, name: Text, at: Timestamp })),
  ),
  conflict: Schema.optionalKey(Schema.Struct({ decisionId: DecisionId })),
});
export const TaskGetInput = Schema.Struct({ ...InWorkspace, taskId: TaskId });
export const TaskListInput = Schema.Struct({
  ...InWorkspace,
  projectId: Schema.optionalKey(ProjectId),
  status: Schema.optionalKey(TaskStatus),
});
/** Each task carries only its latest `listedFreeTextEntries` free-text entries; `get` has all. */
export const TaskListResult = Schema.Struct({ tasks: Schema.Array(Task) });

/** A `proposed` decision records `supersedes` as intent; only a `decided` one retires it. */
export const DecisionCreateInput = Schema.Struct({
  ...InWorkspace,
  title: Title,
  text: Schema.String.check(Schema.isMaxLength(BOARD_LIMITS.decisionTextLength)),
  status: Schema.optionalKey(Schema.Literals(["proposed", "decided"])),
  supersedes: Schema.optionalKey(DecisionId),
  options: Decision.fields.options,
  chosen: Decision.fields.chosen,
});
export const DecisionListResult = Schema.Struct({ decisions: Schema.Array(Decision) });

export const CommitListInput = Schema.Struct({ ...InWorkspace, taskId: BoardItemId });
export const CommitListResult = Schema.Struct({ commits: Schema.Array(TaskCommit) });

/** The lease holder is the caller's author: its agent, else the member. */
export const LeaseAcquireInput = Schema.Struct({ ...InWorkspace, taskId: TaskId });
export const LeaseScopedInput = Schema.Struct({ ...InWorkspace, leaseId: LeaseId });
/** The task's unexpired lease; absent while nobody holds it. */
export const LeaseGetResult = Schema.Struct({ lease: Schema.optionalKey(Lease) });

/**
 * A committed write to one board item or delegation, by its new version (a delegation's is its
 * message count). It never carries the item: a watcher re-reads what it shows. A lease change
 * reaches its task this way through the task's `leaseId`.
 */
export const BoardChange = Schema.Struct({
  kind: Schema.Literals(["task", "decision", "delegation"]),
  workspaceId: WorkspaceId,
  id: Schema.Union([BoardItemId, DelegationId]),
  version: Count,
});
export type BoardChange = typeof BoardChange.Type;
/**
 * `synchronized` opens every subscription; a write committed before it is not sent. `changes`
 * carries one write's notices, or all a watcher had queued, once per item at its newest version.
 */
export const BoardWatchItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("changes"), changes: Schema.Array(BoardChange) }),
  Schema.Struct({ kind: Schema.Literal("synchronized") }),
]);
export type BoardWatchItem = typeof BoardWatchItem.Type;

export class StaleTaskVersionError extends Schema.TaggedError<StaleTaskVersionError>()(
  "TelescopeStaleTaskVersionError",
  { taskId: TaskId, baseVersion: Count, currentVersion: Count },
) {
  override get message(): string {
    return `Task changed since version ${this.baseVersion}; it is now at ${this.currentVersion}.`;
  }
}

export class FreeTextLimitError extends Schema.TaggedError<FreeTextLimitError>()(
  "TelescopeFreeTextLimitError",
  { taskId: TaskId, limit: Count },
) {
  override get message(): string {
    return `Task already has ${this.limit} free-text entries.`;
  }
}
