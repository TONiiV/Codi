// PROTOTYPE, wipe me. Settings -> Projects shows which workspace owns each Code project: the
// project list is grouped by workspace, and one project's page can move it to another workspace.
import type { ReactNode } from "react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { WORKSPACE_KIND } from "./lighthouseData";
import {
  moveCodeProject,
  useCodeProjectWorkspace,
  useWorkspaceId,
  useWorkspaces,
} from "./workspaceStore";

export function WorkspaceProjectGroups({
  groups,
  render,
}: {
  groups: readonly SidebarProjectSnapshot[];
  render: (groups: readonly SidebarProjectSnapshot[]) => ReactNode;
}) {
  const workspaces = useWorkspaces();
  const current = useWorkspaceId();
  const workspaceOf = useCodeProjectWorkspace();
  return workspaces.map((w) => {
    const own = groups.filter((g) => workspaceOf(g) === w.id);
    return (
      <SettingsSection
        key={w.id}
        title={w.name}
        titleAction={
          <span className="flex items-center gap-1.5">
            <Badge variant="outline" size="sm">
              {WORKSPACE_KIND[w.kind]}
            </Badge>
            {w.id === current ? <span className="text-xs text-muted-foreground">当前</span> : null}
            <span className="text-xs text-muted-foreground">{own.length} 个项目</span>
          </span>
        }
      >
        {own.length > 0 ? (
          render(own)
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            这个工作区还没有项目。打开一个项目，在「工作区」里把它移过来。
          </p>
        )}
      </SettingsSection>
    );
  });
}

export function ProjectWorkspaceRow({ group }: { group: SidebarProjectSnapshot }) {
  const workspaces = useWorkspaces();
  const workspaceOf = useCodeProjectWorkspace();
  const value = workspaceOf(group);
  const workspace = workspaces.find((w) => w.id === value);
  return (
    <SettingsRow
      title="工作区"
      description="项目只在它所属工作区的 Microscope 里显示。"
      control={
        <div className="w-full sm:w-48">
          <Select
            value={value}
            onValueChange={(next) => {
              if (typeof next === "string") moveCodeProject(group.projectKey, next);
            }}
          >
            <SelectTrigger size="sm" className="w-full min-w-0" aria-label="工作区">
              <SelectValue>
                {workspace ? `${workspace.name} · ${WORKSPACE_KIND[workspace.kind]}` : value}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name} · {WORKSPACE_KIND[w.kind]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}
