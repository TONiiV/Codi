import {
  type EnvironmentId,
  type ProjectId,
  type ProviderInstanceId,
  Telescope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
import { WORKSPACE_ERROR_TEXT, type WorkspaceErrorText } from "./workspaces.ts";

const { WS_METHODS, ANY_TASK_TYPE } = Telescope;

/** The groups in the order the resolver reads them (D58). */
const ROUTING_GROUP_LABELS = [
  "项目 + 精确类型",
  "项目 + 任意类型",
  "全部项目 + 精确类型",
  "全部项目 + 任意类型",
] as const;

const groupIndex = (rule: Telescope.RoutingRule) =>
  (rule.projectId === undefined ? 2 : 0) + (rule.taskType === ANY_TASK_TYPE ? 1 : 0);

/** `rules` come from `routing.list`, which returns them in creation order. */
export function groupRoutingRules(rules: ReadonlyArray<Telescope.RoutingRule>) {
  const ranked = rules
    .map((rule, order) => ({ rule, order }))
    .sort((left, right) => right.rule.priority - left.rule.priority || left.order - right.order)
    .map(({ rule }) => rule);
  return ROUTING_GROUP_LABELS.map((label, index) => ({
    label,
    rules: ranked.filter((rule) => groupIndex(rule) === index),
  })).filter((group) => group.rules.length > 0);
}

export function taskTypeLabel(taskType: string): string {
  return taskType === ANY_TASK_TYPE ? "任意类型" : taskType;
}

export const ROUTING_SKIP_REASON_TEXT: Record<Telescope.RoutingSkipReason, string> = {
  harness_not_allowed: "授权单不允许这个 harness",
  model_not_allowed: "授权单不允许这个模型",
  harness_unavailable: "这台服务器没有为这个项目启用这个 harness",
};

export const ROUTING_SOURCE_TEXT: Record<Telescope.RoutingResolution["source"], string> = {
  rule: "来自路由规则",
  agent_default: "来自 agent 自己的模型",
  none: "没有适用的规则，agent 也没有自己的模型",
  none_allowed: "所有候选都不被允许，这类任务不能运行",
};

export const ROUTING_ERROR_TEXT: WorkspaceErrorText = {
  ...WORKSPACE_ERROR_TEXT,
  not_found: "找不到这个项目、规则或 agent，请刷新后再试。",
  forbidden: "只有管理员能修改路由规则。",
  conflict: "这个 agent 在另一个项目里工作。",
};

const TASK_TYPE_MAX = 64;
const MODEL_MAX = 128;

/** The contract's cap, as Chinese copy; null when the text is acceptable. */
export function taskTypeProblem(text: string): string | null {
  const value = text.trim();
  if (value === "") return "请填写任务类型。";
  return value.length > TASK_TYPE_MAX ? `任务类型最多 ${TASK_TYPE_MAX} 个字符。` : null;
}

/** Whether a 试一下 reply asked about the inputs on screen; surrounding spaces ask the same. */
export const answersPreview = (
  asked: { readonly agentId: Telescope.AgentId; readonly taskType: string },
  current: { readonly agentId: Telescope.AgentId | undefined; readonly taskType: string },
) => asked.agentId === current.agentId && asked.taskType.trim() === current.taskType.trim();

export interface RoutingRuleDraft {
  readonly projectId: ProjectId | null;
  /** Blank means any task type. */
  readonly taskType: string;
  readonly harness: ProviderInstanceId | null;
  readonly model: string;
  readonly priority: string;
}

/** The fields to send, or the first problem with the draft. */
export function parseRoutingRuleDraft(draft: RoutingRuleDraft) {
  const problem = (text: string) => ({ problem: text }) as const;
  const taskType = draft.taskType.trim() || ANY_TASK_TYPE;
  if (taskType.length > TASK_TYPE_MAX) return problem(`任务类型最多 ${TASK_TYPE_MAX} 个字符。`);
  if (draft.harness === null) return problem("请选择 harness。");
  const model = draft.model.trim();
  if (model === "") return problem("请填写模型。");
  if (model.length > MODEL_MAX) return problem(`模型最多 ${MODEL_MAX} 个字符。`);
  const priority = Number(draft.priority.trim());
  if (!/^\d+$/.test(draft.priority.trim()) || !Number.isSafeInteger(priority))
    return problem("优先级是 0 或更大的整数。");
  const project = draft.projectId === null ? {} : { projectId: draft.projectId };
  return { fields: { ...project, taskType, harness: draft.harness, model, priority } } as const;
}

export function createTelescopeRoutingAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "telescope:routing:list",
    tag: WS_METHODS.routingList,
  });
  /** Also after a refusal: a rule another admin deleted must leave the list. */
  const refresh = (
    {
      environmentId,
      input,
    }: { environmentId: EnvironmentId; input: { workspaceId: Telescope.WorkspaceId } },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() =>
      registry.refresh(list({ environmentId, input: { workspaceId: input.workspaceId } })),
    );
  return {
    list,
    set: createEnvironmentRpcCommand(runtime, {
      label: "telescope:routing:set",
      tag: WS_METHODS.routingSet,
      onSettled: refresh,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "telescope:routing:delete",
      tag: WS_METHODS.routingDelete,
      onSettled: refresh,
    }),
    resolve: createEnvironmentRpcCommand(runtime, {
      label: "telescope:routing:resolve",
      tag: WS_METHODS.routingResolve,
    }),
  };
}
