import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { offersOpenThread, openThreadFailureText } from "@t3tools/client-runtime/telescope/agents";
import type { EnvironmentId, Telescope, ThreadId } from "@t3tools/contracts";
import { MessagesSquareIcon } from "lucide-react";
import { useState } from "react";
import { AsyncResult } from "effect/reactivity";

import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentShellStatus } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { isThreadRouteSnapshotAuthoritative } from "../../threadRoutes";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { agentDisplayName, telescopeAgents } from "./myTeamsShared";
import { ErrorNote } from "./TelescopeAccountDialogs";
import { TelescopeNeedsYou } from "./TelescopeNeedsYou";
import { telescope, useTelescopeWorkspaces } from "./telescopeState";
import { useChatAgentId } from "./telescopeViews";

function ChatEmpty(props: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessagesSquareIcon />
        </EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
      {props.children === undefined ? null : <EmptyContent>{props.children}</EmptyContent>}
    </Empty>
  );
}

const PICK_A_CHAT = (
  <ChatEmpty title="选一个对话" description="从左边选一个 agent，和它的对话会显示在这里。" />
);

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner tone="muted" />
    </div>
  );
}

/** The agent's resident thread once the shell lists it; a deleted or archived one starts over. */
function AgentChat({
  environmentId,
  workspace,
  agent,
}: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  agent: Telescope.Agent;
}) {
  const [opened, setOpened] = useState<ThreadId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openThread = useAtomCommand(telescopeAgents.openThread, {
    label: "开始对话",
    reportFailure: false,
  });
  const mayOpen = useAtomValue(telescopeAgents.openThread.permissionAtom(environmentId));
  const detail = useEnvironmentQuery(
    telescope.get({ environmentId, input: { workspaceId: workspace.id } }),
  );
  const threadId = opened ?? agent.residentThreadId ?? null;
  const shell = useQuietThreadShell(
    threadId === null ? null : scopeThreadRef(environmentId, threadId),
  );
  const live = isThreadRouteSnapshotAuthoritative(useEnvironmentShellStatus(environmentId));
  const name = agentDisplayName(agent);

  if (threadId !== null && shell !== null && shell.archivedAt === null && shell.deletedAt == null)
    return (
      <ChatView
        key={threadId}
        environmentId={environmentId}
        threadId={threadId}
        routeKind="server"
        reserveTitleBarControlInset={false}
      />
    );
  // Not loaded yet, or just opened and the lists have not caught up: the shell lists it soon.
  const catchingUp = threadId === opened && agent.residentThreadId !== opened;
  if (threadId !== null && shell === null && (!live || catchingUp)) return <Loading />;

  const self = detail.data?.self;
  if (self === undefined && detail.error === null) return <Loading />;
  if (self === undefined || !mayOpen || !offersOpenThread(agent, self))
    return <ChatEmpty title={name} description="这个 agent 还没有和你的对话。" />;
  const start = async () => {
    setBusy(true);
    setError(null);
    const result = await openThread({
      environmentId,
      input: { workspaceId: workspace.id, agentId: agent.id },
    });
    setBusy(false);
    if (AsyncResult.isSuccess(result)) setOpened(result.value.threadId);
    else setError(openThreadFailureText(result));
  };
  return (
    <ChatEmpty title={name} description="你们还没有对话。开始后，你在这里说的话会直接发给它。">
      <Button disabled={busy} onClick={() => void start()}>
        {busy ? <Spinner /> : null}
        开始对话
      </Button>
      {error === null ? null : <ErrorNote text={error} />}
    </ChatEmpty>
  );
}

function WorkspaceChat({
  environmentId,
  workspace,
  agentId,
}: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  agentId: Telescope.AgentId;
}) {
  const scoped = { environmentId, input: { workspaceId: workspace.id } };
  const enterprise = workspace.kind === "enterprise";
  const mine = useEnvironmentQuery(telescopeAgents.listMine(scoped));
  const company = useEnvironmentQuery(enterprise ? telescopeAgents.listCompany(scoped) : null);
  // Only agents the list shows: an id from another workspace or a made-up one opens nothing.
  const agent =
    mine.data?.agents.find((candidate) => candidate.id === agentId) ??
    company.data?.agents.find(
      (candidate) => candidate.id === agentId && candidate.ownerSubjectId === null,
    );
  if (agent !== undefined)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TelescopeNeedsYou
          key={agent.id}
          environmentId={environmentId}
          workspace={workspace}
          agent={agent}
        />
        <AgentChat
          key={agent.id}
          environmentId={environmentId}
          workspace={workspace}
          agent={agent}
        />
      </div>
    );
  const loading =
    (mine.data === null && mine.error === null) ||
    (enterprise && company.data === null && company.error === null);
  return loading ? <Loading /> : PICK_A_CHAT;
}

/** The 对话 main pane: the selected agent's resident thread in the real ChatView. */
export function TelescopeChatPage() {
  const { environmentId, current } = useTelescopeWorkspaces();
  const agentId = useChatAgentId();
  if (environmentId === null || current === null || agentId === null) return PICK_A_CHAT;
  return <WorkspaceChat environmentId={environmentId} workspace={current} agentId={agentId} />;
}
