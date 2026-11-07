import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

const { WS_METHODS } = Telescope;
const EXPOSURES = Telescope.AgentExposure.literals;

/**
 * Exposure levels the owner may pick from `saved`: any lower level, or exactly one step up.
 * Personal workspaces have no 主代理, so nothing there is dispatchable.
 */
export function selectableExposures(
  saved: Telescope.AgentExposure,
  workspaceKind: Telescope.Workspace["kind"],
): ReadonlySet<Telescope.AgentExposure> {
  const ceiling = EXPOSURES.indexOf(saved) + 1;
  return new Set(
    EXPOSURES.filter(
      (exposure, rank) =>
        rank <= ceiling && !(exposure === "dispatchable" && workspaceKind === "personal"),
    ),
  );
}

/** Mirrors the server: only workspace admins and the agent's project lead may merge PRs. */
export function ownerCanMergePRs(
  self: Telescope.Member,
  agent: Pick<Telescope.Agent, "projectId">,
  bindings: ReadonlyArray<Telescope.ProjectBinding>,
): boolean {
  return (
    self.role === "admin" ||
    (agent.projectId !== undefined &&
      bindings.some(
        (binding) =>
          binding.projectId === agent.projectId && binding.leadSubjectId === self.subjectId,
      ))
  );
}

/** Stored powers as they take effect: a merge right above the owner's role stays off. */
export function cappedPowers(
  powers: Telescope.StandingPowers,
  canMerge: boolean,
): Telescope.StandingPowers {
  return { ...powers, mergePRs: powers.mergePRs && canMerge };
}

export function createTelescopeAgentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  bindingsRevision: Atom.Atom<number>,
) {
  // The server creates a project's Chief Agent inside listMine, so a bind must re-read it.
  const listMine = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:agent:list-mine",
    tag: WS_METHODS.agentListMine,
    refreshTrigger: () => bindingsRevision,
  });
  const listCompany = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:agent:list-company",
    tag: WS_METHODS.agentListCompany,
  });
  const get = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:agent:get",
    tag: WS_METHODS.agentGet,
  });
  const bindings = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:project:list-bindings",
    tag: WS_METHODS.projectListBindings,
    refreshTrigger: () => bindingsRevision,
  });

  const refreshLists = (
    environmentId: EnvironmentId,
    workspaceId: Telescope.WorkspaceId,
    registry: AtomRegistry.AtomRegistry,
  ) => {
    registry.refresh(listMine({ environmentId, input: { workspaceId } }));
    registry.refresh(listCompany({ environmentId, input: { workspaceId } }));
  };
  const refreshAgent = (
    { environmentId }: { environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
    agent: Telescope.Agent,
  ) =>
    Effect.sync(() => {
      refreshLists(environmentId, agent.workspaceId, registry);
      registry.refresh(
        get({ environmentId, input: { workspaceId: agent.workspaceId, agentId: agent.id } }),
      );
    });

  return {
    listMine,
    listCompany,
    get,
    bindings,
    createCustom: createEnvironmentRpcCommand(runtime, {
      label: "telescope:agent:create-custom",
      tag: WS_METHODS.agentCreateCustom,
      onSuccess: (target, registry, agent) => refreshAgent(target, registry, agent),
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "telescope:agent:update",
      tag: WS_METHODS.agentUpdate,
      onSuccess: (target, registry, agent) => refreshAgent(target, registry, agent),
    }),
    updateCompany: createEnvironmentRpcCommand(runtime, {
      label: "telescope:agent:update-company",
      tag: WS_METHODS.agentUpdateCompany,
      onSuccess: (target, registry, agent) => refreshAgent(target, registry, agent),
    }),
  };
}
