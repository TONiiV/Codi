import { type EnvironmentId, type ProjectId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  type AtomCommandResult,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "../state/runtime.ts";

const { WS_METHODS } = Telescope;

export type WorkspaceErrorText = Record<Telescope.WorkspaceError["reason"], string>;

export const WORKSPACE_ERROR_TEXT: WorkspaceErrorText = {
  not_found: "找不到这个工作区或成员，请刷新后再试。",
  forbidden: "你没有权限做这件事。",
  expired: "已经过期，请刷新后再试。",
  conflict: "和当前状态冲突，请刷新后再试。",
  storage: "保存失败，请稍后再试。",
  invalid: "请求内容无效，请检查后重试。",
};

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);

/** Null on success; otherwise Chinese copy for the server's reason or the lost connection. */
export function failureText(
  result: AtomCommandResult<unknown, unknown>,
  text: WorkspaceErrorText = WORKSPACE_ERROR_TEXT,
): string | null {
  if (result._tag === "Success") return null;
  // A closed session settles its pending calls as interrupted; these commands cannot be cancelled.
  if (isAtomCommandInterrupted(result)) return "连接已断开，请检查连接后重试。";
  const error = squashAtomCommandFailure(result);
  return isWorkspaceError(error) ? text[error.reason] : "请求失败，请检查连接后再试。";
}

/** Where this device remembers its current workspace. */
export interface CurrentWorkspaceStorage {
  readonly read: () => Telescope.WorkspaceId | null;
  readonly write: (workspaceId: Telescope.WorkspaceId) => void;
}

/** The remembered workspace while it is still one of `workspaces`, else the first. */
export function resolveCurrentWorkspace(
  workspaces: ReadonlyArray<Telescope.Workspace>,
  storedId: Telescope.WorkspaceId | null,
): Telescope.Workspace | null {
  return workspaces.find((workspace) => workspace.id === storedId) ?? workspaces[0] ?? null;
}

/** The environment owner's built-in member: an admin of every workspace, never removable. */
export function isEnvironmentOwner(member: Telescope.Member): boolean {
  return member.subjectId === Telescope.OWNER_MEMBER_ID;
}

interface ProjectRef {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

/** Workspaces any of `refs` is bound to; a project group binds all its members together. */
export function boundWorkspaceIds(
  bindings: ReadonlyArray<Telescope.ProjectBinding>,
  refs: ReadonlyArray<ProjectRef>,
): ReadonlySet<Telescope.WorkspaceId> {
  return new Set(
    bindings
      .filter((binding) =>
        refs.some(
          (ref) =>
            ref.environmentId === binding.environmentId && ref.projectId === binding.projectId,
        ),
      )
      .map((binding) => binding.workspaceId),
  );
}

/** Unbound projects stay visible everywhere; bound ones only in a workspace they belong to. */
export function hiddenOutsideWorkspace(
  bound: ReadonlySet<Telescope.WorkspaceId>,
  currentId: Telescope.WorkspaceId | null,
): boolean {
  return bound.size > 0 && (currentId === null || !bound.has(currentId));
}

/** Bindings a move to `next` removes: only the caller's own, so a foreign one never strands it. */
export function workspacesToLeave(
  bound: ReadonlySet<Telescope.WorkspaceId>,
  next: Telescope.WorkspaceId | null,
  own: ReadonlyArray<Telescope.Workspace>,
): ReadonlyArray<Telescope.WorkspaceId> {
  return [...bound].filter((id) => id !== next && own.some((workspace) => workspace.id === id));
}

/** One binding per workspace a project is bound to, as `boundWorkspaceIds` reads them. */
export function bindingsFromSummary(
  projects: ReadonlyArray<Telescope.ProjectBindingSummary>,
): ReadonlyArray<Telescope.ProjectBinding> {
  return projects.flatMap(({ workspaceIds, ...project }) =>
    workspaceIds.map((workspaceId) => ({ workspaceId, ...project })),
  );
}

export interface DashboardListCount {
  readonly total: number;
  readonly shown: number;
}

/** The dashboard lists are capped, so totals come from the uncapped counts, never list lengths. */
export function dashboardListCounts(summary: Telescope.DashboardSummary): {
  readonly tasks: DashboardListCount;
  readonly runs: DashboardListCount;
} {
  return {
    tasks: {
      total: Object.values(summary.openTasks).reduce((sum, n) => sum + n, 0),
      shown: summary.tasks.length,
    },
    runs: { total: summary.openRuns, shown: summary.runs.length },
  };
}

export function createTelescopeWorkspaceAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  storage: CurrentWorkspaceStorage,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:workspace:list",
    tag: WS_METHODS.workspaceList,
  });
  const get = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:workspace:get",
    tag: WS_METHODS.workspaceGet,
  });
  const members = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:member:list",
    tag: WS_METHODS.memberList,
  });
  const bindingSummary = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:project:binding-summary",
    tag: WS_METHODS.projectBindingSummary,
  });
  const dashboard = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:dashboard:summary",
    tag: WS_METHODS.dashboardSummary,
  });

  const storedWorkspaceIdAtom = Atom.writable(
    () => storage.read(),
    (ctx, workspaceId: Telescope.WorkspaceId) => {
      storage.write(workspaceId);
      ctx.setSelf(workspaceId);
    },
  ).pipe(Atom.keepAlive, Atom.withLabel("telescope:current-workspace-id"));

  const workspacesOf = (getAtom: Atom.AtomContext, environmentId: EnvironmentId) =>
    AsyncResult.getOrElse(getAtom(list({ environmentId, input: {} })), () => null)?.workspaces ??
    [];

  const currentWorkspaceAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((getAtom) =>
      resolveCurrentWorkspace(workspacesOf(getAtom, environmentId), getAtom(storedWorkspaceIdAtom)),
    ).pipe(Atom.withLabel(`telescope:current-workspace:${environmentId}`)),
  );

  /** Every binding on the environment, including workspaces the caller is not in (D16). */
  const allBindingsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((getAtom) =>
      bindingsFromSummary(
        AsyncResult.getOrElse(getAtom(bindingSummary({ environmentId, input: {} })), () => null)
          ?.projects ?? [],
      ),
    ).pipe(Atom.withLabel(`telescope:all-bindings:${environmentId}`)),
  );

  const switchTo = (
    { environmentId }: { environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
    workspaceId: Telescope.WorkspaceId,
  ) =>
    Effect.sync(() => {
      registry.refresh(list({ environmentId, input: {} }));
      registry.refresh(bindingSummary({ environmentId, input: {} }));
      registry.set(storedWorkspaceIdAtom, workspaceId);
    });
  const inWorkspace = (target: {
    environmentId: EnvironmentId;
    input: { workspaceId: Telescope.WorkspaceId };
  }) => ({ environmentId: target.environmentId, input: { workspaceId: target.input.workspaceId } });
  const refreshMembers = (
    target: Parameters<typeof inWorkspace>[0],
    registry: AtomRegistry.AtomRegistry,
  ) => Effect.sync(() => registry.refresh(members(inWorkspace(target))));
  /** Bumped by this client's bind and unbind, so views built on bindings re-read them. */
  const bindingsRevisionAtom = Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel("telescope:bindings-revision"),
  );
  const refreshBindings = (
    { environmentId }: { environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() => {
      registry.refresh(bindingSummary({ environmentId, input: {} }));
      registry.set(bindingsRevisionAtom, registry.get(bindingsRevisionAtom) + 1);
    });

  return {
    list,
    get,
    members,
    bindingSummary,
    switchTo,
    dashboard,
    storedWorkspaceIdAtom,
    currentWorkspaceAtom,
    allBindingsAtom,
    bindingsRevisionAtom,
    create: createEnvironmentRpcCommand(runtime, {
      label: "telescope:workspace:create",
      tag: WS_METHODS.workspaceCreate,
      onSuccess: (target, registry, workspace) => switchTo(target, registry, workspace.id),
    }),
    invite: createEnvironmentRpcCommand(runtime, {
      label: "telescope:member:invite",
      tag: WS_METHODS.memberInvite,
    }),
    linkCode: createEnvironmentRpcCommand(runtime, {
      label: "telescope:member:link-code",
      tag: WS_METHODS.memberLinkCode,
    }),
    accept: createEnvironmentRpcCommand(runtime, {
      label: "telescope:member:accept",
      tag: WS_METHODS.memberAccept,
      onSuccess: (target, registry, member) => switchTo(target, registry, member.workspaceId),
    }),
    setRole: createEnvironmentRpcCommand(runtime, {
      label: "telescope:member:set-role",
      tag: WS_METHODS.memberSetRole,
      onSuccess: refreshMembers,
    }),
    revoke: createEnvironmentRpcCommand(runtime, {
      label: "telescope:member:revoke",
      tag: WS_METHODS.memberRevoke,
      onSuccess: refreshMembers,
    }),
    bind: createEnvironmentRpcCommand(runtime, {
      label: "telescope:project:bind",
      tag: WS_METHODS.projectBind,
      onSuccess: refreshBindings,
    }),
    unbind: createEnvironmentRpcCommand(runtime, {
      label: "telescope:project:unbind",
      tag: WS_METHODS.projectUnbind,
      onSuccess: refreshBindings,
    }),
  };
}
