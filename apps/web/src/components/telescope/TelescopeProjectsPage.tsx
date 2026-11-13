import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { bindingsFromSummary, failureText } from "@t3tools/client-runtime/telescope/workspaces";
import type { EnvironmentId, Telescope } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { FolderCodeIcon, PencilIcon, PlusIcon, Settings2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { openCommandPalette } from "../../commandPaletteBus";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { useEnvironmentIdentities } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectFavicon } from "../ProjectFavicon";
import { useSettingsProjectGroups } from "../settings/useSettingsProjectGroups";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { AgentSettingsDialog } from "./MyTeamsAgentDialog";
import { agentDisplayName, initials, telescopeAgents } from "./myTeamsShared";
import { NoWorkspace } from "./TasksParts";
import { ErrorNote } from "./TelescopeAccountDialogs";
import { QueryState } from "./TelescopeQueryState";
import { TelescopeEmptyState } from "./TelescopeShell";
import {
  projectRows,
  repositoryLabel,
  sentMountsAtom,
  unlinkedProjects,
  workspaceKey,
} from "./telescopeProjects";
import { telescope, useTelescopeWorkspaces } from "./telescopeState";

function AgentInitial({ agent, large = false }: { agent: Telescope.Agent; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-medium",
        large ? "size-10" : "size-6",
      )}
    >
      {initials(agent)}
    </span>
  );
}

function AssistantCard(props: {
  environmentId: EnvironmentId;
  workspaceId: Telescope.WorkspaceId;
  agent: Telescope.Agent;
  mayRename: boolean;
}) {
  const { agent } = props;
  const shown = agentDisplayName(agent);
  const update = useAtomCommand(telescopeAgents.update, "改名");
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    flushSync(() => {
      setDraft(null);
      setError(null);
    });
    renameButton.current?.focus();
  };
  const rename = async (name: string) => {
    if (name !== "" && name !== shown) {
      const result = await update({
        environmentId: props.environmentId,
        input: { workspaceId: props.workspaceId, agentId: agent.id, name },
      });
      if (!AsyncResult.isSuccess(result)) return setError(failureText(result));
    }
    close();
  };
  return (
    <section className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <AgentInitial agent={agent} large />
      <div className="min-w-0 flex-1">
        {draft === null ? (
          <div className="font-medium">{shown}</div>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void rename(draft.trim());
            }}
          >
            <Input
              nativeInput
              size="sm"
              autoFocus
              aria-label="个人助理名字"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => event.key === "Escape" && close()}
            />
            <Button type="submit" size="sm">
              保存
            </Button>
            <Button type="button" size="sm" variant="ghost-muted" onClick={close}>
              取消
            </Button>
          </form>
        )}
        {error === null ? null : <ErrorNote text={error} />}
        <div className="text-xs text-muted-foreground">
          你的个人助理（Chief of Staff），管你在各个项目里的 Chief Agent
        </div>
      </div>
      {draft === null && props.mayRename ? (
        <Button ref={renameButton} size="xs" variant="ghost-muted" onClick={() => setDraft(shown)}>
          <PencilIcon /> 改名
        </Button>
      ) : null}
    </section>
  );
}

function Projects(props: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  self: Telescope.Member;
  agents: ReadonlyArray<Telescope.Agent>;
  projects: ReadonlyArray<Telescope.Project>;
}) {
  const { environmentId, workspace, self, agents, projects } = props;
  const codeProjects = useProjects();
  const groups = useSettingsProjectGroups();
  const machineLabel = new Map(
    useEnvironmentIdentities().map((env) => [env.environmentId, env.label]),
  );
  const machine = (id: EnvironmentId) => machineLabel.get(id) ?? "另一台机器";
  const summary = useEnvironmentQuery(telescope.bindingSummary({ environmentId, input: {} }));
  const mayConnect =
    useAtomValue(telescope.createProject.permissionAtom(environmentId)) && self.role === "admin";
  // Other workspaces' mounts come only from the summary, so nothing is offered before it loads.
  const canConnect = mayConnect && summary.data !== null;
  const mayUpdateAgents =
    useAtomValue(telescopeAgents.update.permissionAtom(environmentId)) && self.role !== "viewer";
  const createProject = useAtomCommand(telescope.createProject, "接入项目");
  const [connectError, setConnectError] = useState<string | null>(null);
  const sentAtom = sentMountsAtom(workspaceKey(environmentId, workspace.id));
  const sent = useAtomValue(sentAtom);
  const setSent = useAtomSet(sentAtom);
  const [editing, setEditing] = useState<Telescope.Agent | null>(null);
  const boundHeading = useRef<HTMLHeadingElement>(null);
  const rows = projectRows(projects, codeProjects, agents, self);
  const unlinked = unlinkedProjects(
    groups,
    bindingsFromSummary(summary.data?.projects ?? []),
    projects,
    self,
  );
  const assistant = agents.find((agent) => agent.kind === "chief_of_staff");
  // A directory stays sent until the data lists it as mounted, also across leaving the page: the
  // call returns before the refresh lands, and a second call would move the mount out of the
  // project the first created. A directory Code stopped listing is not known to be mounted.
  const mounted = (key: string) =>
    groups.some((group) => group.projectKey === key) &&
    !unlinked.some(({ group }) => group.projectKey === key);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the sent record is a session atom outside React; a mounted directory leaves it, so one that loses its mount later is offered again
  useEffect(() => {
    if (sent.some(mounted)) setSent((prev) => prev.filter((key) => !mounted(key)));
  });
  const connect = async (
    key: string,
    input: (typeof unlinked)[number]["input"],
    focusNext: HTMLElement | null,
  ) => {
    setConnectError(null);
    setSent((prev) => [...prev, key]);
    const result = await createProject({ environmentId, input });
    if (!AsyncResult.isSuccess(result)) {
      setSent((prev) => prev.filter((sentKey) => sentKey !== key));
      return setConnectError(failureText(result));
    }
    focusNext?.focus();
  };

  return (
    <div className="flex flex-col gap-8">
      {assistant ? (
        <AssistantCard
          environmentId={environmentId}
          workspaceId={workspace.id}
          agent={assistant}
          mayRename={mayUpdateAgents}
        />
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 ref={boundHeading} tabIndex={-1} className="text-sm font-medium outline-none">
          在 Telescope 里
        </h3>
        {rows.length === 0 ? (
          <TelescopeEmptyState view="projects" />
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目</TableHead>
                  <TableHead>目录</TableHead>
                  <TableHead>仓库</TableHead>
                  <TableHead>代码所在机器</TableHead>
                  <TableHead>你的 Chief Agent</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.flatMap(({ project, mounts }) =>
                  mounts.length === 0 ? (
                    <TableRow key={project.id}>
                      <TableCell>
                        <span className="font-medium">{project.name}</span>
                      </TableCell>
                      <TableCell colSpan={5}>
                        <span className="text-muted-foreground">还没有挂进目录</span>
                      </TableCell>
                    </TableRow>
                  ) : (
                    mounts.map(({ mount, code, chief, detail }, index) => (
                      <TableRow key={`${project.id}:${mount.environmentId}:${mount.projectId}`}>
                        <TableCell>
                          <span className="font-medium">{index === 0 ? project.name : null}</span>
                        </TableCell>
                        <TableCell>
                          <div
                            className={cn(
                              "flex items-center gap-2.5",
                              code ? "font-medium" : "text-muted-foreground",
                            )}
                          >
                            {code ? (
                              <ProjectFavicon project={code} className="size-4 shrink-0" />
                            ) : (
                              <FolderCodeIcon className="size-4 shrink-0 text-icon-muted" />
                            )}
                            {code?.title ??
                              (machineLabel.has(mount.environmentId)
                                ? "项目未加载"
                                : "在另一台机器上")}
                          </div>
                          <div className="max-w-48 truncate font-mono text-muted-foreground">
                            {code?.workspaceRoot}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="block max-w-48 truncate font-mono text-muted-foreground">
                            {code ? repositoryLabel(code) : null}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground">
                            {machine(mount.environmentId)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            {chief ? <AgentInitial agent={chief} /> : null}
                            <span className="flex flex-col">
                              {chief ? <span>{agentDisplayName(chief)}</span> : null}
                              <span className="text-muted-foreground">{detail}</span>
                            </span>
                          </span>
                        </TableCell>
                        <TableCell>
                          {chief && mayUpdateAgents ? (
                            <Button
                              size="xs"
                              variant="ghost-muted"
                              aria-label={`设定 ${code?.title ?? agentDisplayName(chief)}`}
                              onClick={() => setEditing(chief)}
                            >
                              <Settings2Icon /> 设定
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  ),
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">Microscope 里还没接入的项目</h3>
          <span className="text-xs text-muted-foreground">
            {summary.data === null
              ? summary.error === null
                ? "正在读取接入情况…"
                : "读不到接入情况，请刷新后再试。"
              : `${mayConnect ? "" : "请管理员接入。"}接入后，Chief Agent 会出现在左侧聊天列表`}
          </span>
        </div>
        {connectError === null ? null : <ErrorNote text={connectError} />}
        {unlinked.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Microscope 里的项目都已接入。新项目用「添加项目」，和 Microscope
            侧边栏的添加项目是同一个流程。
          </div>
        ) : (
          <ul className="divide-y rounded-lg border bg-card text-sm">
            {unlinked.map(({ group, input }) => (
              <li key={group.projectKey} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <ProjectFavicon project={group} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block font-medium">{group.displayName}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {group.workspaceRoot}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {[
                    ...new Set(group.memberProjectRefs.map((ref) => machine(ref.environmentId))),
                  ].join("、")}
                </span>
                <Badge variant="outline">{repositoryLabel(group)}</Badge>
                {canConnect ? (
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`接入 ${group.displayName}`}
                    disabled={sent.includes(group.projectKey)}
                    onClick={(event) => {
                      // The bound row unmounts, so focus moves to the row that takes its place.
                      const row = event.currentTarget.closest("li");
                      const next = (
                        row?.nextElementSibling ?? row?.previousElementSibling
                      )?.querySelector("button");
                      void connect(group.projectKey, input, next ?? boundHeading.current);
                    }}
                  >
                    {sent.includes(group.projectKey) ? "接入中…" : "接入"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing ? (
        <AgentSettingsDialog
          environmentId={environmentId}
          workspace={workspace}
          self={self}
          agent={editing}
          projects={projects}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function WorkspaceProjects(props: {
  environmentId: EnvironmentId;
  workspaceId: Telescope.WorkspaceId;
}) {
  const scoped = { environmentId: props.environmentId, input: { workspaceId: props.workspaceId } };
  const detail = useEnvironmentQuery(telescope.get(scoped));
  const mine = useEnvironmentQuery(telescopeAgents.listMine(scoped));
  const projects = useEnvironmentQuery(telescope.projects(scoped));
  return (
    <QueryState query={detail}>
      {({ workspace, self }) => (
        <QueryState query={mine}>
          {({ agents }) => (
            <QueryState query={projects}>
              {({ projects }) => (
                <Projects
                  key={workspace.id}
                  environmentId={props.environmentId}
                  workspace={workspace}
                  self={self}
                  agents={agents}
                  projects={projects}
                />
              )}
            </QueryState>
          )}
        </QueryState>
      )}
    </QueryState>
  );
}

/** The 项目 view: the workspace's projects, the caller's Chief Agent in each, and Code projects to bring in. */
export function TelescopeProjectsPage() {
  const { environmentId, current } = useTelescopeWorkspaces();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">项目</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            和 Microscope 里是同一个项目：名字、目录、仓库、机器都一样。每个成员在项目里有自己的
            Chief Agent，大家靠同一块任务板对齐。
          </p>
        </div>
        <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
          <PlusIcon /> 添加项目
        </Button>
      </div>
      {environmentId === null || current === null ? (
        <NoWorkspace />
      ) : (
        <WorkspaceProjects environmentId={environmentId} workspaceId={current.id} />
      )}
    </div>
  );
}
