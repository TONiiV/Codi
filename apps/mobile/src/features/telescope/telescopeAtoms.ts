import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { createTelescopeBoardAtoms } from "@t3tools/client-runtime/telescope/taskBoard";
import { Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { connectionAtomRuntime } from "../../connection/runtime";

const { WS_METHODS } = Telescope;

// The shared reads refresh on board notices; a local query family here would not.
const { decisions, tasks } = createTelescopeBoardAtoms(connectionAtomRuntime);

export const telescopeBoard = {
  workspaces: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "telescope:workspace:list",
    tag: WS_METHODS.workspaceList,
  }),
  decisions,
  tasks,
  decide: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "telescope:decision:decide",
    tag: WS_METHODS.decisionCreate,
    onSuccess: ({ environmentId, input }, registry) =>
      Effect.sync(() =>
        registry.refresh(decisions({ environmentId, input: { workspaceId: input.workspaceId } })),
      ),
  }),
  updateTask: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "telescope:task:update",
    tag: WS_METHODS.taskUpdate,
    onSuccess: ({ environmentId, input }, registry) =>
      Effect.sync(() =>
        registry.refresh(tasks({ environmentId, input: { workspaceId: input.workspaceId } })),
      ),
  }),
};
