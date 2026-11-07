import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  type AtomCommandResult,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  squashAtomCommandFailure,
} from "../state/runtime.ts";
import { failureText } from "./workspaces.ts";

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

/** Only the owner starts an agent's chat; the server checks it again. */
export function offersOpenThread(agent: Telescope.Agent, self: Telescope.Member): boolean {
  return agent.ownerSubjectId === self.subjectId && self.revokedAt === undefined;
}

const MODEL_REFUSALS: ReadonlyArray<string> = Object.values(Telescope.AGENT_MODEL_REFUSALS);
const isWorkspaceError = Schema.is(Telescope.WorkspaceError);

/** Points at the default model only when the model or its provider is why the chat cannot open. */
export function openThreadFailureText(result: AtomCommandResult<unknown, unknown>): string | null {
  const error = result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
  if (!isWorkspaceError(error) || error.reason !== "invalid") return failureText(result);
  return MODEL_REFUSALS.includes(error.message)
    ? "现在开不了这个对话：它需要一个能用 Codi 工具的模型。请在 设置 → 会话 → 新会话 → 模型 里选一个默认模型。"
    : `现在开不了这个对话：${error.message}`;
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
    openThread: createEnvironmentRpcCommand(runtime, {
      label: "telescope:agent:open-thread",
      tag: WS_METHODS.agentOpenThread,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() => {
          refreshLists(environmentId, input.workspaceId, registry);
          registry.refresh(get({ environmentId, input }));
        }),
    }),
    updateCompany: createEnvironmentRpcCommand(runtime, {
      label: "telescope:agent:update-company",
      tag: WS_METHODS.agentUpdateCompany,
      onSuccess: (target, registry, agent) => refreshAgent(target, registry, agent),
    }),
  };
}
