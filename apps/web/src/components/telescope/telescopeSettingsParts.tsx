import * as Routing from "@t3tools/client-runtime/telescope/routing";
import type { EnvironmentId, Telescope } from "@t3tools/contracts";

import { useProjects } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { useEnvironmentQuery, type EnvironmentQueryView } from "../../state/query";
import { ErrorNote } from "./TelescopeAccountDialogs";
import { telescope, useTelescopeWorkspaces } from "./telescopeState";

export interface Scoped {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  self: Telescope.Member;
}

export function StatusRow(props: { text: string; failed?: boolean; onRetry?: () => void }) {
  return (
    <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
      {props.failed ? <ErrorNote {...props} /> : props.text}
    </div>
  );
}

/** Loading or failed state of a query whose data is still missing. */
export function QueryStatus({
  query,
  what,
}: {
  query: EnvironmentQueryView<unknown>;
  what: string;
}) {
  const failed = query.error !== null;
  return (
    <StatusRow
      text={failed ? `${what}加载失败。` : `正在加载${what}…`}
      failed={failed}
      onRetry={query.refresh}
    />
  );
}

/** For an admin whose connection was paired without the Telescope admin scope. */
export const noAdminScopeText = (what: string) =>
  `这个连接没有 Telescope 管理权限，只能查看${what}。`;

/** Bound projects and the harnesses this server runs, under the names the page shows. */
export function useRoutingNames(environmentId: EnvironmentId, workspace: Telescope.Workspace) {
  const { bindings } = useTelescopeWorkspaces();
  const bound = useEnvironmentQuery(telescope.bindingSummary({ environmentId, input: {} }));
  const allProjects = useProjects();
  const projects = bindings
    .filter((binding) => binding.workspaceId === workspace.id)
    .map((binding) => ({
      value: binding.projectId,
      label:
        allProjects.find(
          (project) =>
            project.environmentId === binding.environmentId && project.id === binding.projectId,
        )?.title ?? binding.projectId,
    }));
  const harnesses = (useEnvironmentProviders().get(environmentId) ?? [])
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      value: provider.instanceId,
      label: provider.displayName ?? provider.instanceId,
    }));
  const unbound = (id: Telescope.RoutingRule["projectId"]) =>
    id !== undefined && bound.data !== null && !projects.some((entry) => entry.value === id);
  const project = (id: Telescope.RoutingRule["projectId"]) =>
    id === undefined
      ? "全部项目"
      : (projects.find((entry) => entry.value === id)?.label ??
        (unbound(id) ? `${id}（已解除绑定）` : id));
  const harness = (id: Telescope.RoutingRule["harness"]) =>
    harnesses.find((entry) => entry.value === id)?.label ?? id;
  const rule = (rule: Telescope.RoutingRule) =>
    `${project(rule.projectId)} · ${Routing.taskTypeLabel(rule.taskType)} → ${harness(rule.harness)} · ${rule.model}`;
  return { projects, harnesses, unbound, project, harness, rule };
}
export type RoutingNames = ReturnType<typeof useRoutingNames>;
