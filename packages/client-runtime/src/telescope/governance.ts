import { type EnvironmentId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentGuardedRpcQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "../state/runtime.ts";

const { WS_METHODS } = Telescope;

export type KillSwitchState = Telescope.KillSwitch["state"];
type GovernanceState = typeof Telescope.GovernanceState.Type;

/** An agent with no stop on record is running. */
export function killSwitchState(
  state: GovernanceState,
  agentId: Telescope.AgentId,
): KillSwitchState {
  return state.killSwitches.find((row) => row.agentId === agentId)?.state ?? "running";
}

export function budgetOf(
  state: GovernanceState,
  scope: Telescope.Budget["scope"],
  scopeId: string,
): Telescope.Budget | undefined {
  return state.budgets.find((budget) => budget.scope === scope && budget.scopeId === scopeId);
}

/** The gateway counts a level only once it has a budget row, so a missing row is uncounted, not zero. */
export function budgetUsageText(budget: Telescope.Budget | undefined): string {
  if (budget === undefined) return "不限次数，设上限后开始计数";
  const { usedCalls: used, limitCalls: limit } = budget;
  return limit === undefined
    ? `已用 ${used} 次调用，不限次数`
    : `已用 ${used} / ${limit} 次调用${used >= limit ? "，已用完" : ""}`;
}

export type GovernanceRow =
  | {
      readonly scope: "company" | "project" | "person";
      readonly scopeId: string;
      readonly title: string;
    }
  | { readonly scope: "agent"; readonly scopeId: Telescope.AgentId; readonly title: string };

/**
 * Budget rows in page order: company, bound projects, members, agents.
 * An older server sends no `agents`; then the caller's own and company lists stand in.
 */
export function governanceRows(
  state: GovernanceState,
  page: {
    readonly company: { readonly id: string; readonly title: string };
    readonly projects: ReadonlyArray<{ readonly value: string; readonly label: string }>;
    readonly members: ReadonlyArray<Telescope.Member>;
    readonly self: Telescope.SubjectId;
    readonly fallbackAgents: ReadonlyArray<Telescope.GovernanceAgent>;
  },
): ReadonlyArray<GovernanceRow> {
  const agents = (state.agents ?? page.fallbackAgents).filter(
    (agent, index, all) => all.findIndex((other) => other.id === agent.id) === index,
  );
  const ownerName = (owner: Telescope.SubjectId) =>
    page.members.find((member) => member.subjectId === owner)?.displayName ?? owner;
  return [
    { scope: "company", scopeId: page.company.id, title: page.company.title },
    ...page.projects.map((project): GovernanceRow => ({
      scope: "project",
      scopeId: project.value,
      title: project.label,
    })),
    ...page.members
      .filter((member) => member.revokedAt === undefined)
      .map((member): GovernanceRow => ({
        scope: "person",
        scopeId: member.subjectId,
        title: member.displayName,
      })),
    ...agents.map((agent): GovernanceRow => ({
      scope: "agent",
      scopeId: agent.id,
      title:
        agent.ownerSubjectId === null || agent.ownerSubjectId === page.self
          ? agent.name
          : `${ownerName(agent.ownerSubjectId)} 的 ${agent.name}`,
    })),
  ];
}

/** Blank removes the limit; anything but a whole number from 0 up is null. */
export function parseCallLimit(text: string): { readonly limitCalls?: number } | null {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  const limit = Number(trimmed);
  return /^\d+$/.test(trimmed) && Number.isSafeInteger(limit) ? { limitCalls: limit } : null;
}

export function createTelescopeGovernanceAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const { query: state, permissionAtom: readPermissionAtom } =
    createEnvironmentGuardedRpcQueryAtomFamily(runtime, {
      label: "telescope:governance:get",
      tag: WS_METHODS.governanceGet,
    });
  const refresh = (
    target: { environmentId: EnvironmentId; input: { workspaceId: Telescope.WorkspaceId } },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() =>
      registry.refresh(
        state({
          environmentId: target.environmentId,
          input: { workspaceId: target.input.workspaceId },
        }),
      ),
    );
  return {
    state,
    readPermissionAtom,
    setBudget: createEnvironmentRpcCommand(runtime, {
      label: "telescope:budget:set",
      tag: WS_METHODS.budgetSet,
      onSuccess: refresh,
    }),
    setKillSwitch: createEnvironmentRpcCommand(runtime, {
      label: "telescope:kill-switch:set",
      tag: WS_METHODS.killSwitchSet,
      onSuccess: refresh,
    }),
  };
}
