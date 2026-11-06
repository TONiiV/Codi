import { useAtomValue } from "@effect/atom-react";
import { boundWorkspaceIds } from "@t3tools/client-runtime/telescope/workspaces";
import type { Telescope } from "@t3tools/contracts";
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
  return { environmentId, current, bindings, workspaces, workspaceOf };
}

/** Settings → Projects: projects grouped by workspace, unbound ones last. */
export function WorkspaceProjectSections(props: {
  groups: readonly SidebarProjectSnapshot[];
  render: (groups: readonly SidebarProjectSnapshot[]) => ReactNode;
  fallback: ReactNode;
}) {
  const { current, workspaces, workspaceOf } = useProjectWorkspaces();
  if (workspaces.length === 0) return props.fallback;
  const unbound = props.groups.filter((group) => workspaceOf(group) === null);
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
    </>
  );
}

export function ProjectWorkspaceRow({ group }: { group: SidebarProjectSnapshot }) {
  const { environmentId, bindings, workspaces, workspaceOf } = useProjectWorkspaces();
  const mayBind = useAtomValue(telescope.bind.permissionAtom(environmentId));
  const bind = useAtomCommand(telescope.bind, "分配工作区");
  const unbind = useAtomCommand(telescope.unbind, "移出工作区");
  const [busy, setBusy] = useState(false);
  if (environmentId === null || workspaces.length === 0) return null;
  const value = workspaceOf(group);
  const label = (workspace: Telescope.Workspace | null) =>
    workspace ? `${workspace.name} · ${WORKSPACE_KIND_LABEL[workspace.kind]}` : "未分配";
  const move = async (next: Telescope.WorkspaceId | null) => {
    setBusy(true);
    const bound = boundWorkspaceIds(bindings, group.memberProjectRefs);
    for (const { environmentId: projectEnvironmentId, projectId } of group.memberProjectRefs) {
      const project = { environmentId: projectEnvironmentId, projectId };
      for (const workspaceId of bound) {
        if (workspaceId !== next)
          await unbind({ environmentId, input: { workspaceId, ...project } });
      }
      if (next !== null) await bind({ environmentId, input: { workspaceId: next, ...project } });
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
            disabled={!mayBind || busy}
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
