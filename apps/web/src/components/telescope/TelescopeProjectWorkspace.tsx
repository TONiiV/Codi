import { useAtomValue } from "@effect/atom-react";
import {
  boundWorkspaceIds,
  failureText,
  WORKSPACE_ERROR_TEXT,
} from "@t3tools/client-runtime/telescope/workspaces";
import type { Telescope } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { FormDialog, TextField } from "./TelescopeAccountDialogs";
import { QueryStatus, type Scoped, StatusRow } from "./telescopeSettingsParts";
import { telescope, useTelescopeWorkspaces, WORKSPACE_KIND_LABEL } from "./telescopeState";

const UNBOUND = "unbound";
const NEW_PROJECT = "new";
const PROJECT = "project:";
const WORKSPACE = "workspace:";

const sameMount = (a: Telescope.ProjectMount, b: Telescope.ProjectMount) =>
  a.environmentId === b.environmentId && a.projectId === b.projectId;

function useProjectWorkspaces() {
  const { environmentId, current, bindings } = useTelescopeWorkspaces();
  const workspaces =
    useEnvironmentQuery(
      environmentId === null ? null : telescope.list({ environmentId, input: {} }),
    ).data?.workspaces ?? [];
  // A project mounted in several workspaces reads as the current one when it is among them.
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
                这个工作区还没有挂进来的项目。打开一个项目，在「Telescope 项目」里选它。
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

/** Which Telescope project mounts this Code project: one of the current workspace's, or a new one. */
export function ProjectWorkspaceRow({ group }: { group: SidebarProjectSnapshot }) {
  const { environmentId, current, bindings, workspaces, workspaceOf, isUnbound } =
    useProjectWorkspaces();
  const projects =
    useEnvironmentQuery(
      environmentId === null || current === null
        ? null
        : telescope.projects({ environmentId, input: { workspaceId: current.id } }),
    ).data?.projects ?? [];
  const mayMount = useAtomValue(telescope.addMount.permissionAtom(environmentId));
  const createProject = useAtomCommand(telescope.createProject, "新建 Telescope 项目");
  const addMount = useAtomCommand(telescope.addMount, "挂到 Telescope 项目");
  const removeMount = useAtomCommand(telescope.removeMount, "移出 Telescope 项目");
  const [busy, setBusy] = useState(false);
  if (environmentId === null || current === null || workspaces.length === 0) return null;
  const refs = group.memberProjectRefs.map(({ environmentId, projectId }) => ({
    environmentId,
    projectId,
  }));
  const holderOf = (ref: Telescope.ProjectMount) =>
    projects.find((project) => project.mounts.some((mount) => sameMount(mount, ref)));
  const holder = refs.map(holderOf).find((project) => project !== undefined);
  const workspace = workspaceOf(group);
  // Mounted only in workspaces this caller is not in: only their admins can move it.
  const foreign = workspace === null && !isUnbound(group);
  const value =
    holder !== undefined
      ? `${PROJECT}${holder.id}`
      : workspace === null
        ? UNBOUND
        : `${WORKSPACE}${workspace.id}`;
  const others = workspaces.filter((entry) => entry.id !== current.id);
  const label = (next: string) => {
    if (next === UNBOUND) return foreign ? "其他工作区" : "未分配";
    if (next === NEW_PROJECT) return `${current.name} · 新项目`;
    if (next.startsWith(PROJECT))
      return `${current.name} · ${projects.find((p) => `${PROJECT}${p.id}` === next)?.name ?? "…"}`;
    const other = workspaces.find((entry) => `${WORKSPACE}${entry.id}` === next);
    return other ? `${other.name} · ${WORKSPACE_KIND_LABEL[other.kind]}` : "…";
  };

  const move = async (next: string) => {
    setBusy(true);
    const target = next.startsWith(PROJECT) ? next.slice(PROJECT.length) : null;
    const leave = refs.flatMap((ref) =>
      workspaces.flatMap((own) =>
        boundWorkspaceIds(bindings, [ref]).has(own.id) &&
        !(own.id === current.id && target !== null && holderOf(ref)?.id === target)
          ? [() => removeMount({ environmentId, input: { workspaceId: own.id, mount: ref } })]
          : [],
      ),
    );
    const into = (workspaceId: Telescope.WorkspaceId) => () =>
      createProject({
        environmentId,
        input: { workspaceId, name: group.displayName, mounts: refs },
      });
    const join =
      next === UNBOUND
        ? []
        : next === NEW_PROJECT
          ? [into(current.id)]
          : next.startsWith(WORKSPACE)
            ? [into(next.slice(WORKSPACE.length) as Telescope.WorkspaceId)]
            : refs
                .filter((ref) => holderOf(ref)?.id !== target)
                .map((mount) => () => {
                  const projectId = target as Telescope.TelescopeProjectId;
                  return addMount({
                    environmentId,
                    input: { workspaceId: current.id, projectId, mount },
                  });
                });
    // A refused step stops the move, so the project never lands in two workspaces.
    for (const step of [...leave, ...join]) {
      if ((await step())._tag !== "Success") break;
    }
    setBusy(false);
  };
  return (
    <SettingsRow
      title="Telescope 项目"
      description="挂进某个工作区项目的目录，只在那个工作区里出现在 Code 的项目列表；未分配的项目到处都在。"
      control={
        <div className="w-full sm:w-56">
          <Select
            value={value}
            disabled={!mayMount || busy || foreign}
            onValueChange={(next) => {
              if (typeof next === "string" && next !== value) void move(next);
            }}
          >
            <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Telescope 项目">
              <SelectValue>{label(value)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {projects.map((project) => (
                <SelectItem key={project.id} value={`${PROJECT}${project.id}`}>
                  {label(`${PROJECT}${project.id}`)}
                </SelectItem>
              ))}
              <SelectItem value={NEW_PROJECT}>{label(NEW_PROJECT)}</SelectItem>
              {others.map((other) => (
                <SelectItem key={other.id} value={`${WORKSPACE}${other.id}`}>
                  {label(`${WORKSPACE}${other.id}`)}
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

const DELETE_ERROR_TEXT = {
  ...WORKSPACE_ERROR_TEXT,
  conflict: "这个项目还有任务。先把任务移到别的项目，再删除它。",
};

function ProjectNameDialog(
  props: Scoped & { project: Telescope.Project | null; onClose: () => void },
) {
  const { environmentId, workspace, project } = props;
  const create = useAtomCommand(telescope.createProject, "新建 Telescope 项目");
  const update = useAtomCommand(telescope.updateProject, "重命名 Telescope 项目");
  const [name, setName] = useState(project?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title={project === null ? "新建项目" : "重命名项目"}
      description="任务属于项目。新项目先不挂目录，到 设置 → 项目 里把 Code 项目挂进来。"
      submitLabel={project === null ? "新建" : "保存"}
      canSubmit={!busy && name.trim() !== "" && name.trim() !== project?.name}
      error={error}
      onClose={props.onClose}
      onSubmit={async () => {
        setBusy(true);
        setError(null);
        const workspaceId = workspace.id;
        const result =
          project === null
            ? await create({ environmentId, input: { workspaceId, name: name.trim() } })
            : await update({
                environmentId,
                input: { workspaceId, projectId: project.id, name: name.trim() },
              });
        setBusy(false);
        if (result._tag === "Success") props.onClose();
        else setError(failureText(result));
      }}
    >
      <TextField label="名字" autoFocus value={name} onChange={setName} />
    </FormDialog>
  );
}

/** Telescope settings: the workspace's projects, which tasks belong to. */
export function ProjectsSection(props: Scoped) {
  const { environmentId, workspace, self } = props;
  const scoped = { environmentId, input: { workspaceId: workspace.id } };
  const query = useEnvironmentQuery(telescope.projects(scoped));
  const members = useEnvironmentQuery(telescope.members(scoped)).data?.members ?? [];
  const codiProjects = useProjects();
  const mayEdit =
    useAtomValue(telescope.updateProject.permissionAtom(environmentId)) && self.role === "admin";
  const remove = useAtomCommand(telescope.deleteProject, {
    label: "删除 Telescope 项目",
    reportFailure: false,
  });
  const [editing, setEditing] = useState<Telescope.Project | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountTitle = (mount: Telescope.ProjectMount) =>
    codiProjects.find(
      (project) => project.environmentId === mount.environmentId && project.id === mount.projectId,
    )?.title ?? mount.projectId;
  const describe = (project: Telescope.Project) => {
    const lead = members.find((member) => member.subjectId === project.leadSubjectId);
    const mounts =
      project.mounts.length === 0 ? "还没有挂目录" : project.mounts.map(mountTitle).join("、");
    return lead === undefined ? mounts : `${mounts} · 负责人：${lead.displayName}`;
  };
  const drop = async (project: Telescope.Project) => {
    setError(null);
    const result = await remove({
      environmentId,
      input: { workspaceId: workspace.id, projectId: project.id },
    });
    setError(failureText(result, DELETE_ERROR_TEXT));
  };
  return (
    <SettingsSection
      id="telescope-projects"
      title="项目"
      titleAction={
        mayEdit ? (
          <Button size="xs" variant="outline" onClick={() => setEditing("new")}>
            新建项目
          </Button>
        ) : null
      }
    >
      <StatusRow text="任务属于项目。一个项目可以挂多个 Code 项目目录，在 设置 → 项目 → Telescope 项目 里挂。" />
      {query.data === null ? <QueryStatus query={query} what="项目" /> : null}
      {query.data?.projects.length === 0 ? <StatusRow text="这个工作区还没有项目。" /> : null}
      {query.data?.projects.map((project) => (
        <SettingsRow
          key={project.id}
          className="wrap-anywhere"
          title={project.name}
          description={describe(project)}
          control={
            mayEdit ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(project)}>
                  重命名
                </Button>
                <Button size="sm" variant="outline" onClick={() => void drop(project)}>
                  删除
                </Button>
              </>
            ) : null
          }
        />
      ))}
      {error === null ? null : <StatusRow text={error} failed />}
      {editing === null ? null : (
        <ProjectNameDialog
          {...props}
          project={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsSection>
  );
}
