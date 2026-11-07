import type { Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Struct from "effect/Struct";

import * as AgentService from "../../../telescope/AgentService.ts";
import * as DelegationService from "../../../telescope/DelegationService.ts";
import * as TaskBoardService from "../../../telescope/TaskBoardService.ts";
import * as ToolGateway from "../../../telescope/ToolGateway.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { type Failure, gated } from "./gate.ts";
import { TelescopeToolkit } from "./tools.ts";

/** Board writes are signed by the run's agent, acting for the chain the run carries. */
const onBoard =
  <A>(
    use: (
      board: TaskBoardService.TaskBoardService["Service"],
      actor: TaskBoardService.Actor,
      workspaceId: Telescope.WorkspaceId,
    ) => Effect.Effect<A, Failure>,
  ) =>
  (caller: ToolGateway.ToolCaller) =>
    Effect.flatMap(TaskBoardService.TaskBoardService, (board) =>
      use(
        board,
        { caller, authorId: caller.agentId, onBehalfOf: caller.onBehalfOf },
        caller.workspaceId,
      ),
    );

/** Delegations are signed by the run's agent, for the member and chain the run carries. */
const onDelegations =
  <A>(
    use: (
      delegations: DelegationService.DelegationService["Service"],
      actor: DelegationService.Actor,
    ) => Effect.Effect<A, Failure>,
  ) =>
  (caller: ToolGateway.ToolCaller) =>
    Effect.flatMap(DelegationService.DelegationService, (delegations) =>
      use(delegations, {
        workspaceId: caller.workspaceId,
        memberId: caller.memberId,
        agentId: caller.agentId,
        onBehalfOf: caller.onBehalfOf,
        runId: caller.runId,
      }),
    );
const summary = (delegation: Telescope.Delegation) => Struct.omit(delegation, ["messages"]);

const handlers = {
  ticket_list: McpToolAccess.readsAsCaller((input) =>
    gated(
      "ticket_list",
      input,
      onBoard((board, actor, workspaceId) => board.listTasks(actor, { ...input, workspaceId })),
    ),
  ),
  ticket_get: McpToolAccess.readsAsCaller((input) =>
    gated(
      "ticket_get",
      input,
      onBoard((board, actor, workspaceId) => board.getTask(actor, { ...input, workspaceId })),
    ),
  ),
  open_ticket: McpToolAccess.actsAsCaller((input) =>
    gated(
      "open_ticket",
      input,
      onBoard((board, actor, workspaceId) => board.createTask(actor, { ...input, workspaceId })),
    ),
  ),
  ticket_update: McpToolAccess.actsAsCaller((input) =>
    gated(
      "ticket_update",
      input,
      onBoard((board, actor, workspaceId) => board.updateTask(actor, { ...input, workspaceId })),
    ),
  ),
  ticket_lease: McpToolAccess.actsAsCaller((input) =>
    gated(
      "ticket_lease",
      input,
      onBoard((board, actor, workspaceId) => board.acquireLease(actor, { ...input, workspaceId })),
    ),
  ),
  ticket_lease_renew: McpToolAccess.actsAsCaller((input) =>
    gated(
      "ticket_lease_renew",
      input,
      onBoard((board, actor, workspaceId) =>
        board.heartbeatLease(actor, { ...input, workspaceId }),
      ),
    ),
  ),
  ticket_lease_release: McpToolAccess.actsAsCaller((input) =>
    gated(
      "ticket_lease_release",
      input,
      onBoard((board, actor, workspaceId) => board.releaseLease(actor, { ...input, workspaceId })),
    ),
  ),
  decision_list: McpToolAccess.readsAsCaller(() =>
    gated(
      "decision_list",
      {},
      onBoard((board, actor, workspaceId) => board.listDecisions(actor, { workspaceId })),
    ),
  ),
  decision_record: McpToolAccess.actsAsCaller((input) =>
    gated(
      "decision_record",
      input,
      onBoard((board, actor, workspaceId) =>
        board.createDecision(actor, { ...input, workspaceId }),
      ),
    ),
  ),
  agent_list: McpToolAccess.actsAsCaller(() =>
    gated("agent_list", {}, (caller) =>
      Effect.flatMap(AgentService.AgentService, (agents) =>
        agents.listMine(caller, { workspaceId: caller.workspaceId }),
      ),
    ),
  ),
  delegate: McpToolAccess.actsAsCaller((input) =>
    gated(
      "delegate",
      input,
      onDelegations((delegations, actor) =>
        delegations.delegate(actor, input).pipe(Effect.map(summary)),
      ),
    ),
  ),
  delegation_list: McpToolAccess.readsAsCaller(() =>
    gated(
      "delegation_list",
      {},
      onDelegations((delegations, actor) =>
        delegations
          .listForAgent(actor.workspaceId, actor.agentId)
          .pipe(Effect.map((rows) => ({ delegations: rows.map(summary) }))),
      ),
    ),
  ),
  delegation_report: McpToolAccess.actsAsCaller((input) =>
    gated(
      "delegation_report",
      input,
      onDelegations((delegations, actor) =>
        delegations.report(actor, input).pipe(Effect.map(summary)),
      ),
    ),
  ),
  delegation_cancel: McpToolAccess.actsAsCaller((input) =>
    gated(
      "delegation_cancel",
      input,
      onDelegations((delegations, actor) =>
        delegations
          .cancel(actor, input.delegationId)
          .pipe(Effect.map((rows) => ({ canceled: rows.map((row) => row.id) }))),
      ),
    ),
  ),
} satisfies McpToolAccess.Handlers<typeof TelescopeToolkit.tools>;

export const layer = McpToolAccess.toLayer(TelescopeToolkit, handlers);
