import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { createTelescopeBoardAtoms } from "@t3tools/client-runtime/telescope/taskBoard";
import { Telescope } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

const { WS_METHODS } = Telescope;

// The shared reads refresh on board notices, and the shared writes rely on them for their echo.
const { decisions, tasks, createDecision, updateTask } =
  createTelescopeBoardAtoms(connectionAtomRuntime);

export const telescopeBoard = {
  workspaces: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "telescope:workspace:list",
    tag: WS_METHODS.workspaceList,
  }),
  decisions,
  tasks,
  decide: createDecision,
  updateTask,
};
