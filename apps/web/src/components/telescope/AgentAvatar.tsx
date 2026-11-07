import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { agentActivity } from "@t3tools/client-runtime/telescope/agents";
import type { EnvironmentId, Telescope } from "@t3tools/contracts";
import { lazy, Suspense } from "react";

import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useNeedsYou } from "./TelescopeNeedsYou";
import { governance, telescope, useTelescopeWorkspaces } from "./telescopeState";

// The engine loads with the first avatar on screen, so it stays out of the app's first chunk.
const AgentBloub = lazy(() => import("./AgentBloub"));

const SIZE = { sm: 20, md: 32, lg: 40 } as const;
const NO_STOPS: ReadonlyArray<Telescope.KillSwitch> = [];

function LiveAvatar(props: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  agent: Telescope.Agent;
  size: number;
}) {
  const { environmentId, workspace, agent } = props;
  const scoped = { environmentId, input: { workspaceId: workspace.id } };
  const resident = agent.residentThreadId;
  const thread = useQuietThreadShell(resident ? scopeThreadRef(environmentId, resident) : null);
  const { items } = useNeedsYou(environmentId, workspace.id);
  const self = useEnvironmentQuery(telescope.get(scoped)).data?.self;
  const mayRead = useAtomValue(governance.readPermissionAtom(environmentId));
  const stops = useEnvironmentQuery(
    mayRead && self?.role === "admin" ? governance.state(scoped) : null,
  );
  const activity = agentActivity(agent.id, thread, items, stops.data?.killSwitches ?? NO_STOPS);
  return <AgentBloub seed={agent.id} activity={activity} size={props.size} />;
}

/** An agent's bloub: shape and colour from its id, motion from what it is doing. */
export function AgentAvatar({ agent, size }: { agent: Telescope.Agent; size?: keyof typeof SIZE }) {
  const { environmentId, current } = useTelescopeWorkspaces();
  const px = SIZE[size ?? "md"];
  const blank = <span aria-hidden className="shrink-0" style={{ width: px, height: px }} />;
  if (environmentId === null || current === null) return blank;
  return (
    <Suspense fallback={blank}>
      <LiveAvatar environmentId={environmentId} workspace={current} agent={agent} size={px} />
    </Suspense>
  );
}
