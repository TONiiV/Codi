import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { bindingsFromSummary, failureText } from "@t3tools/client-runtime/telescope/workspaces";
import type { EnvironmentId, Telescope } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { CheckIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectFavicon } from "../ProjectFavicon";
import { useSettingsProjectGroups } from "../settings/useSettingsProjectGroups";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import {
  ErrorNote,
  InvitationCode,
  useCreateWorkspaceForm,
  useJoinWorkspaceForm,
} from "./TelescopeAccountDialogs";
import { telescope, useTelescopeWorkspaces } from "./telescopeState";
import { INVITE_CLOSED_KEY, firstRunAtom, firstRunStep, type FirstRunStep } from "./firstRunSteps";
import { sentMountsAtom, unlinkedProjects, workspaceKey } from "./telescopeProjects";

type OpenStep = "create" | Exclude<FirstRunStep, "done">;
const ORDER: ReadonlyArray<OpenStep> = ["create", "mount", "invite"];

function Step(props: {
  n: number;
  title: string;
  note?: string | undefined;
  state: "done" | "current" | "todo";
  children?: ReactNode;
}) {
  const { state } = props;
  return (
    <li
      aria-current={state === "current" ? "step" : undefined}
      className={cn("flex gap-3 rounded-lg border p-4", state === "current" && "bg-card")}
    >
      <span
        aria-hidden
        className={cn(
          "mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
          state === "current" && "border-primary bg-primary text-primary-foreground",
          state === "done" && "bg-muted text-muted-foreground",
        )}
      >
        {state === "done" ? <CheckIcon className="size-3.5" /> : props.n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div>
          <h3 className={cn("text-sm font-medium", state !== "current" && "text-muted-foreground")}>
            {props.title}
            {state === "done" ? <span className="sr-only">（已完成）</span> : null}
          </h3>
          {props.note === undefined ? null : (
            <p className="mt-0.5 text-xs text-muted-foreground">{props.note}</p>
          )}
        </div>
        {state === "current" ? props.children : null}
      </div>
    </li>
  );
}

/** The three steps; `children` is the body of the open one. */
function FirstRunPage(props: {
  step: OpenStep;
  workspace: Telescope.Workspace | null;
  mountDoneNote?: string;
  children: ReactNode;
}) {
  const stateOf = (step: OpenStep) =>
    ORDER.indexOf(step) < ORDER.indexOf(props.step)
      ? "done"
      : step === props.step
        ? "current"
        : "todo";
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 py-10">
      <div>
        <h2 className="text-2xl font-semibold">开始使用 Telescope</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          三步：建一个工作区，把项目接进来，再邀请同事。
        </p>
      </div>
      <ol className="flex flex-col gap-3">
        <Step
          n={1}
          title="建一个工作区，或加入已有的"
          note={props.workspace ? `工作区：${props.workspace.name}` : undefined}
          state={stateOf("create")}
        >
          {props.children}
        </Step>
        <Step
          n={2}
          title="接入项目"
          note={
            stateOf("mount") === "done"
              ? props.mountDoneNote
              : "把 Code 里的项目接进工作区，每个成员在项目里有自己的 Chief Agent。"
          }
          state={stateOf("mount")}
        >
          {props.children}
        </Step>
        <Step
          n={3}
          title="邀请同事"
          note="生成一个邀请码发给同事。这一步可以跳过。"
          state={stateOf("invite")}
        >
          {props.children}
        </Step>
      </ol>
    </div>
  );
}

function CreateOrJoin({ environmentId }: { environmentId: EnvironmentId }) {
  const [joining, setJoining] = useState(false);
  const setRun = useAtomSet(firstRunAtom);
  const mayCreate = useAtomValue(telescope.create.permissionAtom(environmentId));
  const options = {
    environmentId,
    defaultName: "",
    onDone: (workspaceId: Telescope.WorkspaceId) =>
      setRun({ key: workspaceKey(environmentId, workspaceId), mountPassed: false }),
  };
  const create = useCreateWorkspaceForm(options);
  const join = useJoinWorkspaceForm(options);
  const form = joining ? join : create;
  const canSubmit = form.canSubmit && (joining || mayCreate);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) void form.submit();
      }}
    >
      {form.fields}
      {form.error === null ? null : <ErrorNote text={form.error} />}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {joining ? "加入" : "新建"}
        </Button>
        <Button type="button" variant="ghost-muted" onClick={() => setJoining(!joining)}>
          {joining ? "改为新建工作区" : "有邀请码？加入已有的"}
        </Button>
      </div>
    </form>
  );
}

function MountProjects(props: {
  environmentId: EnvironmentId;
  workspaceId: Telescope.WorkspaceId;
  self: Telescope.Member;
  projects: ReadonlyArray<Telescope.Project>;
}) {
  const { environmentId, self, projects } = props;
  const sentAtom = sentMountsAtom(workspaceKey(environmentId, props.workspaceId));
  const groups = useSettingsProjectGroups();
  const summary = useEnvironmentQuery(telescope.bindingSummary({ environmentId, input: {} }));
  const createProject = useAtomCommand(telescope.createProject, "接入项目");
  const setRun = useAtomSet(firstRunAtom);
  const sent = useAtomValue(sentAtom);
  const setSent = useAtomSet(sentAtom);
  const [error, setError] = useState<string | null>(null);
  const unlinked = unlinkedProjects(
    groups,
    bindingsFromSummary(summary.data?.projects ?? []),
    projects,
    self,
  );
  // A directory stays disabled from the click until the data lists it as mounted, also across leaving
  // the page: the call returns before the refresh lands, and a second call would move the mount out of
  // the project the first created.
  const connect = async (key: string, input: (typeof unlinked)[number]["input"]) => {
    setError(null);
    setSent((prev) => [...prev, key]);
    const result = await createProject({ environmentId, input });
    if (AsyncResult.isSuccess(result)) return;
    setSent((prev) => prev.filter((sentKey) => sentKey !== key));
    setError(failureText(result));
  };
  return (
    <div className="flex flex-col gap-3">
      {summary.data === null ? (
        summary.error === null ? (
          <p className="text-sm text-muted-foreground">正在读取接入情况…</p>
        ) : (
          <ErrorNote text="读不到接入情况。" onRetry={summary.refresh} />
        )
      ) : unlinked.length === 0 ? (
        <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          Code 里没有还没接入的项目。先添加一个。
          <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
            <PlusIcon /> 添加项目
          </Button>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {unlinked.map(({ group, input }) => (
            <li key={group.projectKey} className="flex items-center gap-3 px-3 py-2.5">
              <ProjectFavicon project={group} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{group.displayName}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {group.workspaceRoot}
                </span>
              </span>
              <Button
                size="xs"
                variant="outline"
                aria-label={`接入 ${group.displayName}`}
                disabled={sent.includes(group.projectKey)}
                onClick={() => void connect(group.projectKey, input)}
              >
                {sent.includes(group.projectKey) ? "接入中…" : "接入"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error === null ? null : <ErrorNote text={error} />}
      <Button
        size="xs"
        variant="ghost-muted"
        className="self-start"
        onClick={() => setRun((run) => run && { ...run, mountPassed: true })}
      >
        先跳过，之后在项目页接入
      </Button>
    </div>
  );
}

function InviteCoworker(props: {
  environmentId: EnvironmentId;
  workspaceId: Telescope.WorkspaceId;
}) {
  const invite = useAtomCommand(telescope.invite, "生成邀请码");
  const [, setClosed] = useLocalStorage(INVITE_CLOSED_KEY, false, Schema.Boolean);
  const setRun = useAtomSet(firstRunAtom);
  const [invitation, setInvitation] = useState<Telescope.Invitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ending the run holds for this session even when storage refuses the write.
  const close = () => {
    setClosed(true);
    setRun(null);
  };
  return (
    <div className="flex flex-col gap-3">
      {invitation === null ? (
        <Button
          variant="outline"
          className="self-start"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const result = await invite({
              environmentId: props.environmentId,
              input: { workspaceId: props.workspaceId, role: "member" },
            });
            setBusy(false);
            if (result._tag === "Success") setInvitation(result.value);
            else setError(failureText(result));
          }}
        >
          <PlusIcon />
          生成邀请码
        </Button>
      ) : (
        <InvitationCode invitation={invitation} />
      )}
      {error === null ? null : <ErrorNote text={error} />}
      <Button
        size="xs"
        variant={invitation === null ? "ghost-muted" : "default"}
        className="self-start"
        onClick={close}
      >
        {invitation === null ? "跳过" : "完成"}
      </Button>
    </div>
  );
}

/** What `NoWorkspace` shows once the list has loaded and is empty. */
export function FirstRunCreate({ environmentId }: { environmentId: EnvironmentId }) {
  return (
    <FirstRunPage step="create" workspace={null}>
      <CreateOrJoin environmentId={environmentId} />
    </FirstRunPage>
  );
}

function WorkspaceFirstRun(props: {
  environmentId: EnvironmentId;
  workspace: Telescope.Workspace;
  mountPassed: boolean;
  children: ReactNode;
}) {
  const { environmentId, workspace } = props;
  const scoped = { environmentId, input: { workspaceId: workspace.id } };
  const detail = useEnvironmentQuery(telescope.get(scoped));
  const projects = useEnvironmentQuery(telescope.projects(scoped));
  const mayConnect = useAtomValue(telescope.createProject.permissionAtom(environmentId));
  const mayInvite = useAtomValue(telescope.invite.permissionAtom(environmentId));
  const [inviteClosed] = useLocalStorage(INVITE_CLOSED_KEY, false, Schema.Boolean);
  const setRun = useAtomSet(firstRunAtom);
  const hasProject = (projects.data?.projects.length ?? 0) > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the run is a session atom outside React; once a project shows up the mount step is over, even if it is removed later
  useEffect(() => {
    if (hasProject)
      setRun((run) => (run === null || run.mountPassed ? run : { ...run, mountPassed: true }));
  }, [hasProject, setRun]);
  if (detail.data === null || projects.data === null)
    return detail.error !== null || projects.error !== null ? (
      props.children
    ) : (
      <Spinner className="m-auto" />
    );
  const { self } = detail.data;
  const isAdmin = self.role === "admin";
  const projectCount = projects.data.projects.length;
  const step = firstRunStep({
    projectCount,
    mayConnect: mayConnect && isAdmin,
    mountPassed: props.mountPassed,
    mayInvite: mayInvite && isAdmin,
    inviteClosed,
  });
  if (step !== "mount" && step !== "invite") return props.children;
  return (
    <FirstRunPage
      step={step}
      workspace={workspace}
      mountDoneNote={
        projectCount > 0
          ? `已接入 ${projectCount} 个项目`
          : mayConnect && isAdmin
            ? "之后可以在项目页接入"
            : "请管理员接入项目"
      }
    >
      {step === "mount" ? (
        <MountProjects
          environmentId={environmentId}
          workspaceId={workspace.id}
          self={self}
          projects={projects.data.projects}
        />
      ) : (
        <InviteCoworker environmentId={environmentId} workspaceId={workspace.id} />
      )}
    </FirstRunPage>
  );
}

function HeldFirstRun(props: { runKey: string; mountPassed: boolean; children: ReactNode }) {
  const { environmentId, current } = useTelescopeWorkspaces();
  // Without a workspace the page's own NoWorkspace shows the first step, and its loading and failed states.
  return environmentId === null ||
    current === null ||
    workspaceKey(environmentId, current.id) !== props.runKey ? (
    props.children
  ) : (
    <WorkspaceFirstRun
      environmentId={environmentId}
      workspace={current}
      mountPassed={props.mountPassed}
    >
      {props.children}
    </WorkspaceFirstRun>
  );
}

/**
 * Keeps the first-run steps up after the first one: once this session made or joined a workspace,
 * that workspace's pages give way to the project and invite steps until those are done, skipped, or
 * not the caller's to do.
 */
export function FirstRunGate({ children }: { children: ReactNode }) {
  const run = useAtomValue(firstRunAtom);
  return run === null ? (
    children
  ) : (
    <HeldFirstRun runKey={run.key} mountPassed={run.mountPassed}>
      {children}
    </HeldFirstRun>
  );
}
