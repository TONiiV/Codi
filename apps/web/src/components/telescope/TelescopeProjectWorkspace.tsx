import { useAtomValue } from "@effect/atom-react";
import { boundWorkspaceIds } from "@t3tools/client-runtime/telescope/workspaces";
import type { Telescope } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState, type ReactNode } from "react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { telescope, useTelescopeWorkspaces, WORKSPACE_KIND_LABEL } from "./telescopeState";

const UNBOUND = "unbound";

function useProjectWorkspaces() {
  const { environmentId, current, bindings } = useTelescopeWorkspaces();
  const workspaces =
    useEnvironmentQuery(
      environmentId === null ? null : telescope.list({ environmentId, input: {} }),
    ).data?.workspaces ?? [];
  // A project bound to several workspaces reads as the current one when it is among them.
  const workspaceOf = (group: SidebarProjectSnapshot) => {
    const bound = boundWorkspaceIds(bindings, group.memberProjectRefs);
    if (current !== null && bound.has(current.id)) return current;
    return workspaces.find((workspace) => bound.has(workspace.id)) ?? null;
  };
  const isUnbound = (group: SidebarProjectSnapshot) =>
    boundWorkspaceIds(bindings, group.memberProjectRefs).size === 0;
  return { environmentId, current, bindings, workspaces, workspaceOf, isUnbound };
}

/** Settings → Projects: projects grouped by workspace, unbound ones last. */
export function WorkspaceProjectSections(props: {
  groups: readonly SidebarProjectSnapshot[];
  render: (groups: readonly SidebarProjectSnapshot[]) => ReactNode;
  fallback: ReactNode;
}) {
  const { current, workspaces, workspaceOf, isUnbound } = useProjectWorkspaces();
  if (workspaces.length === 0) return props.fallback;
  const unbound = props.groups.filter((group) => isUnbound(group));
  const foreign = props.groups.filter((group) => !isUnbound(group) && workspaceOf(group) === null);
  return (
    <>
      {workspaces.map((workspace) => {
        const own = props.groups.filter((group) => workspaceOf(group)?.id === workspace.id);
        return (
          <SettingsSection
            key={workspace.id}
            title={workspace.name}
            titleAction={
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline" size="sm">
                  {WORKSPACE_KIND_LABEL[workspace.kind]}
                </Badge>
                {workspace.id === current?.id ? "当前 · " : null}
                {own.length} 个项目
              </span>
            }
          >
            {own.length > 0 ? (
              props.render(own)
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                这个工作区还没有项目。打开一个项目，在「工作区」里选它。
              </p>
            )}
          </SettingsSection>
        );
      })}
      {unbound.length > 0 ? (
        <SettingsSection title="未分配工作区">{props.render(unbound)}</SettingsSection>
      ) : null}
      {foreign.length > 0 ? (
        <SettingsSection title="其他工作区">{props.render(foreign)}</SettingsSection>
      ) : null}
    </>
  );
}

export function ProjectWorkspaceRow({ group }: { group: SidebarProjectSnapshot }) {
  const { environmentId, bindings, workspaces, workspaceOf, isUnbound } = useProjectWorkspaces();
  const mayBind = useAtomValue(telescope.bind.permissionAtom(environmentId));
  const bind = useAtomCommand(telescope.bind, "分配工作区");
  const unbind = useAtomCommand(telescope.unbind, "移出工作区");
  const [busy, setBusy] = useState(false);
  if (environmentId === null || workspaces.length === 0) return null;
  const value = workspaceOf(group);
  // Bound only to workspaces this caller is not in: only their admins can move it.
  const foreign = value === null && !isUnbound(group);
  const label = (workspace: Telescope.Workspace | null) =>
    workspace
      ? `${workspace.name} · ${WORKSPACE_KIND_LABEL[workspace.kind]}`
      : foreign
        ? "其他工作区"
        : "未分配";
  const move = async (next: Telescope.WorkspaceId | null) => {
    setBusy(true);
    const steps = group.memberProjectRefs.flatMap((ref) => {
      const project = { environmentId: ref.environmentId, projectId: ref.projectId };
      const bound = boundWorkspaceIds(bindings, [ref]);
      const leave = [...bound]
        .filter((workspaceId) => workspaceId !== next)
        .map((workspaceId) => () => unbind({ environmentId, input: { workspaceId, ...project } }));
      // Rebinding would reset the project's lead, so a kept binding is left alone.
      const join =
        next === null || bound.has(next)
          ? []
          : [() => bind({ environmentId, input: { workspaceId: next, ...project } })];
      return [...leave, ...join];
    });
    // A refused unbind stops the move, so the project never lands in two workspaces.
    for (const step of steps) {
      if (AsyncResult.isFailure(await step())) break;
    }
    setBusy(false);
  };
  return (
    <SettingsRow
      title="工作区"
      description="绑定到工作区的项目只在那个工作区里出现在 Code 的项目列表；未分配的项目到处都在。"
      control={
        <div className="w-full sm:w-48">
          <Select
            value={value?.id ?? UNBOUND}
            disabled={!mayBind || busy || foreign}
            onValueChange={(next) => {
              if (next === UNBOUND) void move(null);
              else {
                const picked = workspaces.find((workspace) => workspace.id === next);
                if (picked) void move(picked.id);
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full min-w-0" aria-label="工作区">
              <SelectValue>{label(value)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {workspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {label(workspace)}
                </SelectItem>
              ))}
              <SelectItem value={UNBOUND}>未分配</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}
