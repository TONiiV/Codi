import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as MemoryService from "../../../telescope/MemoryService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { MemoryToolkit } from "./tools.ts";

const toFailure = (error: MemoryService.Failure) =>
  new OrchestratorMcpFailure(
    error._tag !== "TelescopeWorkspaceError" || error.reason === "storage"
      ? { code: "orchestration_error", message: "Telescope memory is unavailable." }
      : {
          code: error.reason === "forbidden" ? "capability_denied" : "invalid_request",
          message: error.message,
        },
  );

/** The calling thread's Telescope run decides the agent, workspace and member; the input cannot. */
const asThreadAgent = Effect.fn("mcp.memory.asThreadAgent")(function* <A>(
  use: (
    memory: MemoryService.MemoryService["Service"],
    agent: MemoryService.ThreadAgent,
  ) => Effect.Effect<A, MemoryService.Failure>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "Telescope memory");
  const memory = yield* MemoryService.MemoryService;
  return yield* memory.callerForThread(thread.threadId).pipe(
    Effect.flatMap((agent) => use(memory, agent)),
    Effect.mapError(toFailure),
  );
});

const handlers = {
  memory_search: McpToolAccess.readsAsCaller((input) =>
    asThreadAgent((memory, agent) =>
      memory.search(agent, { ...input, workspaceId: agent.workspaceId }),
    ),
  ),
  memory_write: McpToolAccess.actsAsCaller((input) =>
    asThreadAgent((memory, agent) =>
      memory
        .write(agent, { ...input, workspaceId: agent.workspaceId, agentId: agent.run.agentId })
        .pipe(Effect.map((written) => ({ memory: written }))),
    ),
  ),
} satisfies McpToolAccess.Handlers<typeof MemoryToolkit.tools>;

export const layer = McpToolAccess.toLayer(MemoryToolkit, handlers);
