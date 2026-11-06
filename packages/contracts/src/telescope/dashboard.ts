import * as Schema from "effect/Schema";

import { ProjectId, ThreadId } from "../baseSchemas.ts";
import { AgentId, AgentRunId, Count, DecisionId, TaskId, Text, Timestamp } from "./common.ts";
import { RunTokens } from "./runtime.ts";

export const OpenTaskStatus = Schema.Literals([
  "todo",
  "in_progress",
  "in_review",
  "needs_decision",
]);
export type OpenTaskStatus = typeof OpenTaskStatus.Type;

/** Who has the task: an unexpired lease's holder, else its owner. */
export const DashboardHolder = Schema.Struct({
  via: Schema.Literals(["lease", "owner"]),
  /** The agent's or member's name, or its id once that record is gone. */
  name: Text,
});

export const DashboardTask = Schema.Struct({
  id: TaskId,
  title: Text,
  status: OpenTaskStatus,
  projectId: Schema.optionalKey(ProjectId),
  holder: Schema.optionalKey(DashboardHolder),
  /** When the task entered its current status. */
  statusSince: Timestamp,
  conflictDecisionId: Schema.optionalKey(DecisionId),
});
export type DashboardTask = typeof DashboardTask.Type;

export const DashboardRun = Schema.Struct({
  id: AgentRunId,
  agentId: AgentId,
  agentName: Text,
  threadId: Schema.optionalKey(ThreadId),
  startedAt: Timestamp,
  /** The run's latest tool call; absent before its first. */
  step: Schema.optionalKey(Schema.Struct({ tool: Text, at: Timestamp })),
  calls: Count,
  tokens: RunTokens,
});
export type DashboardRun = typeof DashboardRun.Type;

/**
 * Where work is waiting in one workspace. `tasks` holds open tasks, longest in their status
 * first; `runs` holds unfinished runs, oldest first. Both lists are capped; the counts are not.
 */
export const DashboardSummary = Schema.Struct({
  generatedAt: Timestamp,
  openTasks: Schema.Struct({
    todo: Count,
    in_progress: Count,
    in_review: Count,
    needs_decision: Count,
  }),
  tasks: Schema.Array(DashboardTask),
  runs: Schema.Array(DashboardRun),
  wakes: Schema.Struct({
    queued: Count,
    running: Count,
    oldestQueuedAt: Schema.optionalKey(Timestamp),
  }),
  pendingDecisions: Count,
});
export type DashboardSummary = typeof DashboardSummary.Type;
