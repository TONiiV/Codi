import * as Schema from "effect/Schema";

import { ProjectId, ThreadId } from "../baseSchemas.ts";
import {
  AgentId,
  BoardItemId,
  Count,
  DecisionId,
  LeaseId,
  Strings,
  SubjectId,
  TaskId,
  Text,
  WorkspaceId,
} from "./common.ts";
import { Decision, ForgeIssueRef, Task, TaskCommit, TaskStatus } from "./board.ts";

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
  /** Only a merge sets the conflict marker; a client can only clear it once settled. */
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
/** `conflict` is set when this write opened a decision for fields no merge rule settles. */
export const TaskUpdateResult = Schema.Struct({
  ...Task.fields,
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
