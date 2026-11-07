import { OrchestratorMcpFailure, Telescope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as AgentService from "../../../telescope/AgentService.ts";
import * as TaskBoardService from "../../../telescope/TaskBoardService.ts";
import * as ToolGateway from "../../../telescope/ToolGateway.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ToolGateway.ToolGateway,
  TaskBoardService.TaskBoardService,
  AgentService.AgentService,
];
/** The thread's Telescope run names the workspace, so no tool takes one. */
const boardTool = <
  const Name extends Telescope.GatewayTool,
  P extends Schema.Constraint,
  S extends Schema.Constraint,
>(
  name: Name,
  options: {
    readonly title: string;
    readonly description: string;
    readonly parameters: P;
    readonly success: S;
    readonly readonly: boolean;
  },
) =>
  Tool.make(name, {
    description: options.description,
    parameters: options.parameters,
    success: options.success,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  })
    .annotate(Tool.Title, options.title)
    .annotate(Tool.Readonly, options.readonly)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false);

const TicketListTool = boardTool("ticket_list", {
  title: "List tickets",
  description:
    "List the tickets on your Telescope board, optionally by `projectId` or `status`. Each ticket shows only its latest notes; `ticket_get` has all. Board tickets are not `delegate_task` tasks.",
  parameters: Telescope.TaskListInput.mapFields(Struct.omit(["workspaceId"])),
  success: Telescope.TaskListResult,
  readonly: true,
});

const TicketGetTool = boardTool("ticket_get", {
  title: "Read ticket",
  description:
    "Read one Telescope ticket by `taskId`, with all its notes. Pass its `version` as `baseVersion` to `ticket_update`.",
  parameters: Telescope.TaskGetInput.mapFields(Struct.omit(["workspaceId"])),
  success: Telescope.Task,
  readonly: true,
});

const OpenTicketTool = boardTool("open_ticket", {
  title: "Open ticket",
  description:
    "Open a ticket on the Telescope board for work that should be tracked. Check `ticket_list` first so you do not open a duplicate. `goalChain`: the project and company goals it serves.",
  parameters: Telescope.TaskCreateInput.mapFields(Struct.omit(["workspaceId"])),
  success: Telescope.Task,
  readonly: false,
});

const TicketUpdateTool = boardTool("ticket_update", {
  title: "Update ticket",
  description:
    "Change a Telescope ticket's fields with `set`, or append a `note`; notes are never edited. `baseVersion`: the `version` you read. A stale write is merged; fields no rule settles open a decision for a member to settle, returned as `conflict`.",
  parameters: Telescope.TaskUpdateInput.mapFields(Struct.omit(["workspaceId"])),
  success: Telescope.TaskUpdateResult,
  readonly: false,
});

const TicketLeaseTool = boardTool("ticket_lease", {
  title: "Lease ticket",
  description:
    "Claim a Telescope ticket before you work on it, so no other agent takes it. Fails while someone else holds it. The lease lapses at `expiresAt` unless you renew it with `ticket_lease_renew`; release it with `ticket_lease_release` when done.",
  parameters: Telescope.LeaseAcquireInput.mapFields(Struct.omit(["workspaceId"])),
  success: Telescope.Lease,
  readonly: false,
});

const TicketLeaseRenewTool = boardTool("ticket_lease_renew", {
  title: "Renew ticket lease",
  description:
    "Extend a ticket lease, by `leaseId`, before its `expiresAt`. You or any agent or device of the member you act for may renew it.",
  parameters: Telescope.LeaseScopedInput.mapFields(Struct.omit(["workspaceId"])),
  success: Telescope.Lease,
  readonly: false,
});

const TicketLeaseReleaseTool = boardTool("ticket_lease_release", {
  title: "Release ticket lease",
  description:
    "Release a ticket lease, by `leaseId`, so others can take the ticket. You or any agent or device of the member you act for may release it.",
  parameters: Telescope.LeaseScopedInput.mapFields(Struct.omit(["workspaceId"])),
  success: Schema.Struct({}),
  readonly: false,
});

const DecisionListTool = boardTool("decision_list", {
  title: "List decisions",
  description:
    "List the decisions on your Telescope board, including proposed and superseded ones. Check them before you act against an earlier decision.",
  parameters: Tool.EmptyParams,
  success: Telescope.DecisionListResult,
  readonly: true,
});

const DecisionRecordTool = boardTool("decision_record", {
  title: "Record decision",
  description:
    "Record a decision on the Telescope board. `status` defaults to decided; use proposed to ask a member to decide (需要你定). `supersedes`: the id of the decision it replaces. Only a member settles a proposal; record your recommendation as a new proposal instead.",
  parameters: Telescope.DecisionCreateInput.mapFields(Struct.omit(["workspaceId"])),
  success: Telescope.Decision,
  readonly: false,
});

const AgentListTool = boardTool("agent_list", {
  title: "List agents",
  description:
    "List the agents of the member you act for: their chief of staff, project Chief Agents and custom agents, with each one's project and standing powers.",
  parameters: Tool.EmptyParams,
  success: Telescope.AgentListResult,
  readonly: false,
});

export const TelescopeToolkit = Toolkit.make(
  TicketListTool,
  TicketGetTool,
  OpenTicketTool,
  TicketUpdateTool,
  TicketLeaseTool,
  TicketLeaseRenewTool,
  TicketLeaseReleaseTool,
  DecisionListTool,
  DecisionRecordTool,
  AgentListTool,
);
