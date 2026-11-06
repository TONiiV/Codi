import { type EnvironmentId, type ProjectId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

const { WS_METHODS } = Telescope;

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

/** One binding per workspace a project is bound to, as `boundWorkspaceIds` reads them. */
export function bindingsFromSummary(
  projects: ReadonlyArray<Telescope.ProjectBindingSummary>,
): ReadonlyArray<Telescope.ProjectBinding> {
  return projects.flatMap(({ workspaceIds, ...project }) =>
    workspaceIds.map((workspaceId) => ({ workspaceId, ...project })),
  );
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
  const refreshBindings = (
    { environmentId }: { environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) => Effect.sync(() => registry.refresh(bindingSummary({ environmentId, input: {} })));

  return {
    list,
    get,
    members,
    storedWorkspaceIdAtom,
    currentWorkspaceAtom,
    allBindingsAtom,
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
