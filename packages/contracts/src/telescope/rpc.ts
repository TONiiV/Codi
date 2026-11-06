import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  Agent,
  AgentCreateCustomInput,
  AgentGetInput,
  AgentGetResult,
  AgentListResult,
  AgentUpdateInput,
} from "./agent.ts";
import {
  MemoryPinInput,
  MemorySearchInput,
  MemorySearchResult,
  MemoryWriteInput,
} from "./memory.ts";
import {
  AgentRun,
  Memory,
  RunCallsResult,
  RunListInput,
  RunListResult,
  RunScopedInput,
  WakeListResult,
} from "./runtime.ts";
import {
  Invitation,
  Member,
  MemberAcceptInput,
  MemberInviteInput,
  MemberLinkCodeInput,
  MemberListResult,
  MemberRevokeInput,
  MemberSetRoleInput,
  ProjectBinding,
  ProjectBindingSummaryResult,
  ProjectListBindingsResult,
  ProjectUnbindInput,
  Workspace,
  WorkspaceCreateInput,
  WorkspaceError,
  WorkspaceGetResult,
  WorkspaceListInput,
  WorkspaceListResult,
  WorkspaceScopedInput,
} from "./workspace.ts";
import {
  CommitListInput,
  CommitListResult,
  DecisionCreateInput,
  DecisionListResult,
  FreeTextLimitError,
  LeaseAcquireInput,
  LeaseScopedInput,
  StaleTaskVersionError,
  TaskCreateInput,
  TaskGetInput,
  TaskListInput,
  TaskListResult,
  TaskUpdateInput,
  TaskUpdateResult,
} from "./taskBoard.ts";
import { Decision, Lease, Task } from "./board.ts";
import { TokenSaverReport, TokenSaverRunInput } from "./tokenSaver.ts";
import {
  Budget,
  BudgetSetInput,
  GovernanceState,
  KillSwitch,
  KillSwitchSetInput,
} from "./governance.ts";
import {
  GrantAuditListInput,
  GrantAuditListResult,
  GrantExplainInput,
  GrantExplainResult,
} from "./grant.ts";
import { DashboardSummary } from "./dashboard.ts";

export const WS_METHODS = {
  workspaceCreate: "telescope.workspace.create",
  workspaceList: "telescope.workspace.list",
  workspaceGet: "telescope.workspace.get",
  memberInvite: "telescope.member.invite",
  memberLinkCode: "telescope.member.linkCode",
  memberAccept: "telescope.member.accept",
  memberList: "telescope.member.list",
  memberSetRole: "telescope.member.setRole",
  memberRevoke: "telescope.member.revoke",
  memberRestore: "telescope.member.restore",
  projectBind: "telescope.project.bind",
  projectUnbind: "telescope.project.unbind",
  projectListBindings: "telescope.project.listBindings",
  projectBindingSummary: "telescope.project.bindingSummary",
  taskCreate: "telescope.task.create",
  taskUpdate: "telescope.task.update",
  taskGet: "telescope.task.get",
  taskList: "telescope.task.list",
  decisionCreate: "telescope.decision.create",
  decisionList: "telescope.decision.list",
  commitList: "telescope.commit.list",
  agentListMine: "telescope.agent.listMine",
  agentGet: "telescope.agent.get",
  agentCreateCustom: "telescope.agent.createCustom",
  agentUpdate: "telescope.agent.update",
  agentListCompany: "telescope.agent.listCompany",
  agentUpdateCompany: "telescope.agent.updateCompany",
  runList: "telescope.run.list",
  runGet: "telescope.run.get",
  runCalls: "telescope.run.calls",
  leaseAcquire: "telescope.lease.acquire",
  leaseHeartbeat: "telescope.lease.heartbeat",
  leaseRelease: "telescope.lease.release",
  wakeList: "telescope.wake.list",
  tokenSaverRun: "telescope.tokensaver.run",
  grantExplain: "telescope.grant.explain",
  grantAuditList: "telescope.grant.audit.list",
  budgetSet: "telescope.budget.set",
  killSwitchSet: "telescope.killSwitch.set",
  governanceGet: "telescope.governance.get",
  memorySearch: "telescope.memory.search",
  memoryWrite: "telescope.memory.write",
  memoryPin: "telescope.memory.pin",
  dashboardSummary: "telescope.dashboard.summary",
} as const;

const error = Schema.Union([WorkspaceError, EnvironmentAuthorizationError]);
const make = <const Tag extends string, P extends Schema.Top, S extends Schema.Top>(
  tag: Tag,
  payload: P,
  success: S,
) => Rpc.make(tag, { payload, success, error });

export const WorkspaceRpcs = [
  make(WS_METHODS.workspaceCreate, WorkspaceCreateInput, Workspace),
  make(WS_METHODS.workspaceList, WorkspaceListInput, WorkspaceListResult),
  make(WS_METHODS.workspaceGet, WorkspaceScopedInput, WorkspaceGetResult),
  make(WS_METHODS.memberInvite, MemberInviteInput, Invitation),
  make(WS_METHODS.memberLinkCode, MemberLinkCodeInput, Invitation),
  make(WS_METHODS.memberAccept, MemberAcceptInput, Member),
  make(WS_METHODS.memberList, WorkspaceScopedInput, MemberListResult),
  make(WS_METHODS.memberSetRole, MemberSetRoleInput, Member),
  make(WS_METHODS.memberRevoke, MemberRevokeInput, Member),
  make(WS_METHODS.memberRestore, MemberRevokeInput, Member),
  make(WS_METHODS.projectBind, ProjectBinding, ProjectBinding),
  make(WS_METHODS.projectUnbind, ProjectUnbindInput, Schema.Struct({})),
  make(WS_METHODS.projectListBindings, WorkspaceScopedInput, ProjectListBindingsResult),
  make(WS_METHODS.projectBindingSummary, Schema.Struct({}), ProjectBindingSummaryResult),
] as const;

const boardError = Schema.Union([
  WorkspaceError,
  StaleTaskVersionError,
  FreeTextLimitError,
  EnvironmentAuthorizationError,
]);
const makeBoard = <const Tag extends string, P extends Schema.Top, S extends Schema.Top>(
  tag: Tag,
  payload: P,
  success: S,
) => Rpc.make(tag, { payload, success, error: boardError });

export const TaskBoardRpcs = [
  makeBoard(WS_METHODS.taskCreate, TaskCreateInput, Task),
  makeBoard(WS_METHODS.taskUpdate, TaskUpdateInput, TaskUpdateResult),
  makeBoard(WS_METHODS.taskGet, TaskGetInput, Task),
  makeBoard(WS_METHODS.taskList, TaskListInput, TaskListResult),
  makeBoard(WS_METHODS.decisionCreate, DecisionCreateInput, Decision),
  makeBoard(WS_METHODS.decisionList, WorkspaceScopedInput, DecisionListResult),
  makeBoard(WS_METHODS.commitList, CommitListInput, CommitListResult),
  makeBoard(WS_METHODS.leaseAcquire, LeaseAcquireInput, Lease),
  makeBoard(WS_METHODS.leaseHeartbeat, LeaseScopedInput, Lease),
  makeBoard(WS_METHODS.leaseRelease, LeaseScopedInput, Schema.Struct({})),
] as const;

export const AgentRpcs = [
  make(WS_METHODS.agentListMine, WorkspaceScopedInput, AgentListResult),
  make(WS_METHODS.agentGet, AgentGetInput, AgentGetResult),
  make(WS_METHODS.agentCreateCustom, AgentCreateCustomInput, Agent),
  make(WS_METHODS.agentUpdate, AgentUpdateInput, Agent),
  make(WS_METHODS.agentListCompany, WorkspaceScopedInput, AgentListResult),
  make(WS_METHODS.agentUpdateCompany, AgentUpdateInput, Agent),
] as const;

export const RunRpcs = [
  make(WS_METHODS.runList, RunListInput, RunListResult),
  make(WS_METHODS.runGet, RunScopedInput, AgentRun),
  make(WS_METHODS.runCalls, RunScopedInput, RunCallsResult),
] as const;

export const WakeRpcs = [make(WS_METHODS.wakeList, WorkspaceScopedInput, WakeListResult)] as const;

export const TokenSaverRpcs = [
  makeBoard(WS_METHODS.tokenSaverRun, TokenSaverRunInput, TokenSaverReport),
] as const;

export const GrantRpcs = [
  make(WS_METHODS.grantExplain, GrantExplainInput, GrantExplainResult),
  make(WS_METHODS.grantAuditList, GrantAuditListInput, GrantAuditListResult),
  make(WS_METHODS.budgetSet, BudgetSetInput, Budget),
  make(WS_METHODS.killSwitchSet, KillSwitchSetInput, KillSwitch),
  make(WS_METHODS.governanceGet, WorkspaceScopedInput, GovernanceState),
] as const;

export const MemoryRpcs = [
  make(WS_METHODS.memorySearch, MemorySearchInput, MemorySearchResult),
  make(WS_METHODS.memoryWrite, MemoryWriteInput, Memory),
  make(WS_METHODS.memoryPin, MemoryPinInput, Memory),
] as const;

export const DashboardRpcs = [
  make(WS_METHODS.dashboardSummary, WorkspaceScopedInput, DashboardSummary),
] as const;
