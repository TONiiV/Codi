import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { agentActivity } from "@t3tools/client-runtime/telescope/agents";
import type { EnvironmentId, Telescope } from "@t3tools/contracts";
import { lazy, Suspense } from "react";

import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useNeedsYou } from "./TelescopeNeedsYou";
import { telescope, telescopeGovernance } from "./telescopeState";

// The engine loads with the first avatar on screen, so it stays out of the app's first chunk.
const AgentBloub = lazy(() => import("./AgentBloub"));

const SIZE = { sm: "size-5", md: "size-8", lg: "size-10" } as const;
const NO_STOPS: ReadonlyArray<Telescope.KillSwitch> = [];

function useAgentActivity(
  environmentId: EnvironmentId,
  workspace: Telescope.Workspace,
  agent: Telescope.Agent,
) {
  const scoped = { environmentId, input: { workspaceId: workspace.id } };
  const thread = useQuietThreadShell(
    agent.residentThreadId === undefined
      ? null
      : scopeThreadRef(environmentId, agent.residentThreadId),
  );
  const { items } = useNeedsYou(environmentId, workspace.id);
  const self = useEnvironmentQuery(telescope.get(scoped)).data?.self;
  const mayRead = useAtomValue(telescopeGovernance.readPermissionAtom(environmentId));
  const governance = useEnvironmentQuery(
    mayRead && self?.role === "admin" ? telescopeGovernance.state(scoped) : null,
  );
  return agentActivity(agent.id, thread, items, governance.data?.killSwitches ?? NO_STOPS);
}

/** An agent's bloub: shape and colour from its id, motion from what it is doing. */
export function AgentAvatar({
  environmentId,
  workspace,
  agent,
  size = "md",
}: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  agent: Telescope.Agent;
  size?: keyof typeof SIZE;
}) {
  const activity = useAgentActivity(environmentId, workspace, agent);
  return (
    <Suspense fallback={<span aria-hidden className={cn("shrink-0", SIZE[size])} />}>
      <AgentBloub seed={agent.id} activity={activity} className={SIZE[size]} />
    </Suspense>
  );
}
