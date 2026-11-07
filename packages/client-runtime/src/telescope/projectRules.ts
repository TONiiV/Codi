import { type EnvironmentId, type ProviderInstanceId, Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { type Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import { WORKSPACE_ERROR_TEXT, type WorkspaceErrorText } from "./workspaces.ts";

const { WS_METHODS } = Telescope;

const MODEL_MAX = 128;
const ALLOWLIST_MAX = 64;

export const PROJECT_RULE_ERROR_TEXT: WorkspaceErrorText = {
  ...WORKSPACE_ERROR_TEXT,
  not_found: "这个项目已解除绑定，请刷新后再试。",
  forbidden: "只有管理员能修改项目规则。",
};

const ALL_POWERS: Telescope.StandingPowers = {
  openTickets: true,
  dispatchWorkers: true,
  answerMembers: true,
  mergePRs: true,
};

const isWorkspaceError = Schema.is(Telescope.WorkspaceError);

interface InWorkspace {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly workspaceId: Telescope.WorkspaceId };
}

const isEmpty = (list: ReadonlyArray<string> | undefined) =>
  list === undefined || list.length === 0;

/** The server cannot delete a rule (D110), so one that removes nothing reads as the default. */
export function isDefaultProjectRule(rule: Telescope.ProjectRule): boolean {
  return (
    !rule.stored ||
    (Object.values(rule.powers).every(Boolean) &&
      isEmpty(rule.routing?.harnesses) &&
      isEmpty(rule.routing?.models))
  );
}

export function allowlistSummary(
  routing: Telescope.RoutingAllowlist | null,
  harnessName: (id: ProviderInstanceId) => string,
): string {
  const harnesses = routing?.harnesses ?? [];
  const models = routing?.models ?? [];
  if (harnesses.length === 0 && models.length === 0) return "任意 harness 和模型";
  return [
    harnesses.length === 0 ? "任意 harness" : harnesses.map(harnessName).join("、"),
    models.length === 0 ? "任意模型" : models.join("、"),
  ].join(" · ");
}

export interface ProjectRuleDraft {
  readonly powers: Telescope.StandingPowers;
  /** Null means 不限. */
  readonly harnesses: ReadonlyArray<ProviderInstanceId> | null;
  /** Null means 不限; otherwise one model per line or comma separated. */
  readonly models: string | null;
}

export const DEFAULT_PROJECT_RULE_DRAFT: ProjectRuleDraft = {
  powers: ALL_POWERS,
  harnesses: null,
  models: null,
};

export function projectRuleDraft(rule: Telescope.ProjectRule): ProjectRuleDraft {
  const { harnesses, models } = rule.routing ?? {};
  return {
    powers: rule.powers,
    harnesses: isEmpty(harnesses) ? null : (harnesses ?? null),
    models: isEmpty(models) ? null : (models ?? []).join("\n"),
  };
}

/** The fields to send, or the first problem with the draft. 不限 is sent as no list, never an empty one. */
export function parseProjectRuleDraft(draft: ProjectRuleDraft) {
  const problem = (text: string) => ({ problem: text }) as const;
  const harnesses = draft.harnesses === null ? null : [...new Set(draft.harnesses)];
  if (harnesses !== null && harnesses.length === 0)
    return problem("请至少选一个 harness，或选不限。");
  if (harnesses !== null && harnesses.length > ALLOWLIST_MAX)
    return problem(`最多选 ${ALLOWLIST_MAX} 个 harness。`);
  const models =
    draft.models === null
      ? null
      : [
          ...new Set(
            draft.models
              .split(/[\n,，]/)
              .map((model) => model.trim())
              .filter((model) => model !== ""),
          ),
        ];
  if (models !== null && models.length === 0) return problem("请至少填一个模型，或选不限。");
  if (models?.some((model) => model.length > MODEL_MAX))
    return problem(`每个模型最多 ${MODEL_MAX} 个字符。`);
  if (models !== null && models.length > ALLOWLIST_MAX)
    return problem(`最多填 ${ALLOWLIST_MAX} 个模型。`);
  const routing =
    harnesses === null && models === null
      ? null
      : { ...(harnesses === null ? {} : { harnesses }), ...(models === null ? {} : { models }) };
  return { fields: { powers: draft.powers, routing } } as const;
}

export function createTelescopeProjectRuleAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  /** The workspace read that carries the caller's role, re-read when a save is refused for it. */
  workspaceGet: (target: InWorkspace) => Atom.Atom<unknown>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:project-rule:list",
    tag: WS_METHODS.projectRuleList,
  });
  return {
    list,
    /** Re-reads the list, so an editor opened on an old page starts from the server's rule. */
    current: (
      registry: AtomRegistry.AtomRegistry,
      { environmentId, input }: InWorkspace & { input: Pick<Telescope.ProjectRule, "projectId"> },
    ) => {
      const rules = list({ environmentId, input: { workspaceId: input.workspaceId } });
      registry.refresh(rules);
      return AtomRegistry.getResult(registry, rules, { suspendOnWaiting: true }).pipe(
        Effect.map((result) => result.rules.find((rule) => rule.projectId === input.projectId)),
      );
    },
    /** Also after a refusal: a project another admin unbound must leave the list. */
    set: createEnvironmentRpcCommand(runtime, {
      label: "telescope:project-rule:set",
      tag: WS_METHODS.projectRuleSet,
      onSettled: (
        { environmentId, input }: InWorkspace,
        registry: AtomRegistry.AtomRegistry,
        exit,
      ) =>
        Effect.sync(() => {
          const target = { environmentId, input: { workspaceId: input.workspaceId } };
          registry.refresh(list(target));
          const error = Option.getOrUndefined(Exit.findErrorOption(exit));
          if (isWorkspaceError(error) && error.reason === "forbidden")
            registry.refresh(workspaceGet(target));
        }),
    }),
  };
}
