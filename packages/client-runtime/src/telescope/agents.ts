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
import { failureText, rereadRoleWhenForbidden } from "./workspaces.ts";

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

const COPILOT_KINDS: ReadonlySet<Telescope.AgentKind> = new Set(["chief_of_staff", "chief_agent"]);

/**
 * The Copilot panel's choices (the assistant and Chief Agents, never the main pane's chat) and the
 * one it shows: the stored pick while it is still a choice, else the assistant.
 */
export function copilotAgents(
  mine: ReadonlyArray<Telescope.Agent>,
  stored: Telescope.AgentId | null,
  mainPane: Telescope.AgentId | null,
): { readonly choices: ReadonlyArray<Telescope.Agent>; readonly shown: Telescope.Agent | null } {
  const choices = mine.filter((agent) => COPILOT_KINDS.has(agent.kind) && agent.id !== mainPane);
  const shown =
    choices.find((agent) => agent.id === stored) ??
    choices.find((agent) => agent.kind === "chief_of_staff") ??
    choices[0] ??
    null;
  return { choices, shown };
}

const MODEL_REFUSALS: ReadonlyArray<string> = Object.values(Telescope.AGENT_MODEL_REFUSALS);
const isWorkspaceError = Schema.is(Telescope.WorkspaceError);

/** Says what to do when the model, its provider, or a missing scratch folder is why the chat cannot open. */
export function openThreadFailureText(result: AtomCommandResult<unknown, unknown>): string | null {
  const error = result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
  if (!isWorkspaceError(error) || error.reason !== "invalid") return failureText(result);
  if (MODEL_REFUSALS.includes(error.message))
    return "现在开不了这个对话：它需要一个能用 Codi 工具的模型。请在 设置 → 会话 → 新会话 → 模型 里选一个默认模型。";
  if (error.message === Telescope.AGENT_SCRATCH_REFUSAL)
    return "现在开不了这个对话：个人助理和其他不属于任何项目的 agent，都在 Codi 数据目录里用自己的文件夹工作，而 Codi 的数据目录在 Git 仓库里时不会建这个文件夹。请把 Codi 的数据目录放到 Git 仓库之外，再重启 Codi；或者去找项目的首席代理，它在自己的项目里工作。";
  return `现在开不了这个对话：${error.message}`;
}

export function createTelescopeAgentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  bindingsRevision: Atom.Atom<number>,
  workspaceGet: Parameters<typeof rereadRoleWhenForbidden>[0],
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
      onSettled: rereadRoleWhenForbidden(workspaceGet),
    }),
  };
}
