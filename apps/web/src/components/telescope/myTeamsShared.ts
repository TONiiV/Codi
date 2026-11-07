import { createTelescopeAgentAtoms } from "@t3tools/client-runtime/telescope/agents";
import type { Telescope } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";
import { telescope } from "./telescopeState";

export const telescopeAgents = createTelescopeAgentAtoms(
  connectionAtomRuntime,
  telescope.bindingsRevisionAtom,
  telescope.get,
);

export const KIND_LABEL: Record<Telescope.AgentKind, string> = {
  chief_of_staff: "首席幕僚",
  chief_agent: "项目首席代理",
  custom: "自定义 agent",
  company_main: "主代理",
  department: "职能代理",
};

// The server names every new personal assistant this; a renamed one keeps its own name.
const DEFAULT_ASSISTANT_NAME = "Chief of Staff";

export function agentDisplayName(agent: Telescope.Agent): string {
  return agent.kind === "chief_of_staff" && agent.name === DEFAULT_ASSISTANT_NAME
    ? KIND_LABEL.chief_of_staff
    : agent.name;
}

export const EXPOSURE_LABEL: Record<Telescope.AgentExposure, string> = {
  hidden: "不暴露",
  visible: "可查看",
  contactable: "可联系",
  dispatchable: "可调度",
};

export const POWERS: ReadonlyArray<{
  id: keyof Telescope.StandingPowers;
  label: string;
  hint: string;
}> = [
  { id: "openTickets", label: "开工单", hint: "把任务拆成工单，挂到任务下面" },
  { id: "dispatchWorkers", label: "派 Worker", hint: "在项目的机器上起 Worker 接工单" },
  { id: "answerMembers", label: "回答别人", hint: "用提问人自己的权限回答项目里的问题" },
  { id: "mergePRs", label: "合并 PR", hint: "CI 绿、评审过就合并" },
];

export function powerSummary(powers: Telescope.StandingPowers) {
  return (
    POWERS.filter((power) => powers[power.id])
      .map((power) => power.label)
      .join("、") || "都先问"
  );
}
