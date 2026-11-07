import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  type AtomCommandResult,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import { failureText, WORKSPACE_ERROR_TEXT } from "./workspaces.ts";

const { WS_METHODS } = Telescope;

export type DelegationSummary = typeof Telescope.DelegationSummary.Type;

type State = Telescope.A2ATaskState;
const TERMINAL: ReadonlyArray<State> = ["COMPLETED", "FAILED", "CANCELED", "REJECTED"];
const ASKING: ReadonlyArray<State> = ["INPUT_REQUIRED", "AUTH_REQUIRED"];

export const isDelegationOpen = (state: State) => !TERMINAL.includes(state);

/**
 * Open questions of the given delegations, oldest first. A decided proposal, or one whose
 * delegation moved on or ended, is not a question any more.
 */
export function needsYou(
  delegations: ReadonlyArray<DelegationSummary>,
  decisions: ReadonlyArray<Telescope.Decision>,
): ReadonlyArray<{ delegation: DelegationSummary; proposal: Telescope.Decision }> {
  const proposals = new Map(
    decisions
      .filter((decision) => decision.status === "proposed")
      .map((decision) => [decision.id, decision]),
  );
  const items = delegations.flatMap((delegation) => {
    const proposal =
      delegation.decisionId === undefined ? undefined : proposals.get(delegation.decisionId);
    return proposal !== undefined && ASKING.includes(delegation.state)
      ? [{ delegation, proposal }]
      : [];
  });
  return items.sort((a, b) => a.proposal.createdAt.localeCompare(b.proposal.createdAt));
}

/** Mirrors the server: the owner of either agent of an open delegation may cancel it. */
export function offersCancel(
  delegation: Pick<DelegationSummary, "state" | "fromAgentId" | "toAgentId">,
  agents: ReadonlyArray<Pick<Telescope.Agent, "id" | "ownerSubjectId">>,
  self: Telescope.Member,
): boolean {
  return (
    isDelegationOpen(delegation.state) &&
    self.revokedAt === undefined &&
    agents.some(
      (agent) =>
        agent.ownerSubjectId === self.subjectId &&
        (agent.id === delegation.fromAgentId || agent.id === delegation.toAgentId),
    )
  );
}

const CANCEL_ERROR_TEXT = {
  ...WORKSPACE_ERROR_TEXT,
  not_found: "找不到这个委派，或者它不在你的委派链里。",
  forbidden: "你没有权限取消这个委派。",
  conflict: "这个委派已经结束，不用再取消了。",
};

export const cancelFailureText = (result: AtomCommandResult<unknown, unknown>) =>
  failureText(result, CANCEL_ERROR_TEXT);

interface WorkspaceTarget {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly workspaceId: Telescope.WorkspaceId };
}

export function createTelescopeDelegationAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  delegationNotices: (target: WorkspaceTarget) => Atom.Atom<number>,
) {
  return {
    // Every committed delegation write, an own cancel included, comes back as a notice.
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "telescope:delegation:list",
      tag: WS_METHODS.delegationList,
      refreshTrigger: ({ environmentId, input }) =>
        delegationNotices({ environmentId, input: { workspaceId: input.workspaceId } }),
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "telescope:delegation:cancel",
      tag: WS_METHODS.delegationCancel,
    }),
  };
}
