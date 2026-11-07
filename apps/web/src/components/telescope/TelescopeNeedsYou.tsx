import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  cancelFailureText,
  createTelescopeDelegationAtoms,
  type DelegationSummary,
  isDelegationOpen,
  needsYou,
  offersCancel,
} from "@t3tools/client-runtime/telescope/delegations";
import type { EnvironmentId, Telescope } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DecisionOptions, useDecide } from "./DecisionsPage";
import { agentDisplayName, telescopeAgents } from "./myTeamsShared";
import { ErrorNote } from "./TelescopeAccountDialogs";
import { telescope, telescopeBoard } from "./telescopeState";

const telescopeDelegations = createTelescopeDelegationAtoms(
  connectionAtomRuntime,
  telescopeBoard.decisions,
  telescopeBoard.delegationNotices,
);

const STATE = {
  SUBMITTED: { label: "已派出", badge: "outline" },
  WORKING: { label: "进行中", badge: "info" },
  INPUT_REQUIRED: { label: "等你回答", badge: "warning" },
  AUTH_REQUIRED: { label: "等你批准", badge: "warning" },
  COMPLETED: { label: "已完成", badge: "success" },
  FAILED: { label: "失败", badge: "error" },
  CANCELED: { label: "已取消", badge: "secondary" },
  REJECTED: { label: "被拒绝", badge: "secondary" },
} as const satisfies Record<Telescope.A2ATaskState, { label: string; badge: string }>;

function DelegationMeta(props: { environmentId: EnvironmentId; delegation: DelegationSummary }) {
  const { state, threadId, hop } = props.delegation;
  return (
    <>
      <Badge variant={STATE[state].badge}>{STATE[state].label}</Badge>
      {hop === "worker" && threadId !== undefined ? (
        <Button
          variant="link"
          size="xs"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId))}
            />
          }
        >
          Worker 对话
        </Button>
      ) : null}
    </>
  );
}

/**
 * Top of a conversation: the open 需要你定 questions of the viewer's delegations, decided in place,
 * then the selected agent's open delegations with their Worker threads and 取消.
 */
export function TelescopeNeedsYou({
  environmentId,
  workspace,
  agent,
}: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  agent: Telescope.Agent;
}) {
  const workspaceId = workspace.id;
  const scoped = { environmentId, input: { workspaceId } };
  const listed = (input: Omit<typeof Telescope.DelegationListInput.Type, "workspaceId">) =>
    telescopeDelegations.list({ environmentId, input: { workspaceId, ...input } });
  const board = useEnvironmentQuery(telescopeBoard.decisions(scoped));
  const asking = useEnvironmentQuery(listed({ state: "INPUT_REQUIRED", limit: 200 }));
  const approving = useEnvironmentQuery(listed({ state: "AUTH_REQUIRED", limit: 200 }));
  // Only the viewer's own agents have delegations it can list.
  const personal = agent.ownerSubjectId !== null;
  const ofAgent = useEnvironmentQuery(personal ? listed({ agentId: agent.id }) : null);
  // Until the first read lands, an empty list would claim there are none.
  const showOwn = personal && (ofAgent.data !== null || ofAgent.error !== null);
  const mine = useEnvironmentQuery(telescopeAgents.listMine(scoped)).data?.agents ?? [];
  const self = useEnvironmentQuery(telescope.get(scoped)).data?.self;
  const mayCancel = useAtomValue(telescopeDelegations.cancel.permissionAtom(environmentId));
  const cancel = useAtomCommand(telescopeDelegations.cancel, { reportFailure: false });
  const { busy, choose, dialog } = useDecide({ environmentId, workspaceId }, board);
  const [armed, setArmed] = useState<Telescope.DelegationId | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const names = new Map(mine.map((each) => [each.id, agentDisplayName(each)]));
  const nameOf = (id: Telescope.AgentId) => names.get(id) ?? "其他 agent";
  const questions = [...(asking.data?.delegations ?? []), ...(approving.data?.delegations ?? [])];
  const items = needsYou(questions, board.data?.decisions ?? []);
  const open = (ofAgent.data?.delegations ?? []).filter((each) => isDelegationOpen(each.state));
  const confirmCancel = async (delegationId: Telescope.DelegationId) => {
    setArmed(null);
    setCanceling(true);
    setCancelError(null);
    const result = await cancel({ environmentId, input: { workspaceId, delegationId } });
    setCanceling(false);
    setCancelError(cancelFailureText(result));
  };
  if (items.length === 0 && !showOwn) return null;

  return (
    <div className="flex max-h-[45%] shrink-0 flex-col gap-4 overflow-y-auto border-b px-4 py-3 text-sm">
      {items.length === 0 ? null : (
        <section aria-label="需要你定" className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-muted-foreground">需要你定 · {items.length}</h2>
          <ul className="flex flex-col gap-3">
            {items.map(({ delegation, proposal }) => (
              <li key={proposal.id} className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {nameOf(delegation.toAgentId)}
                  <DelegationMeta environmentId={environmentId} delegation={delegation} />
                </span>
                <span className="font-medium wrap-anywhere">{proposal.title}</span>
                {proposal.text ? (
                  <p className="line-clamp-3 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
                    {proposal.text}
                  </p>
                ) : null}
                <DecisionOptions
                  decision={proposal}
                  busy={busy}
                  onChoose={(option) => choose(proposal, option)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {showOwn ? (
        <section aria-label="委派" className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-muted-foreground">委派 · {open.length}</h2>
          {cancelError === null ? null : <ErrorNote text={cancelError} />}
          {open.length === 0 ? (
            <p className="text-muted-foreground">
              {ofAgent.error === null ? "现在没有进行中的委派。" : "没有读到委派，请检查连接。"}
            </p>
          ) : null}
          {open.map((delegation) => (
            <div key={delegation.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 basis-40 truncate">{delegation.brief.goal}</span>
              <span className="text-xs text-muted-foreground">
                {nameOf(delegation.fromAgentId)} →{" "}
                {delegation.hop === "worker" ? "Worker" : nameOf(delegation.toAgentId)}
              </span>
              <DelegationMeta environmentId={environmentId} delegation={delegation} />
              {mayCancel && self !== undefined && offersCancel(delegation, mine, self) ? (
                <Button
                  size="xs"
                  variant={armed === delegation.id ? "destructive" : "outline"}
                  disabled={canceling}
                  onClick={() =>
                    armed === delegation.id
                      ? void confirmCancel(delegation.id)
                      : setArmed(delegation.id)
                  }
                >
                  {armed === delegation.id ? "确认取消，Worker 会停下" : "取消"}
                </Button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {dialog}
    </div>
  );
}
