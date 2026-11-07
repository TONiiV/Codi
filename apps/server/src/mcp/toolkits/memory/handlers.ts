import type * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import * as MemoryService from "../../../telescope/MemoryService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { gated } from "../telescope/gate.ts";
import { MemoryToolkit } from "./tools.ts";

/** Through the gateway: the calling thread's run decides the agent, workspace and member. */
const asRunAgent = Effect.fn("mcp.memory.asRunAgent")(function* <A>(
  tool: "memory_search" | "memory_write",
  args: Schema.Json,
  use: (
    memory: MemoryService.MemoryService["Service"],
    agent: MemoryService.ThreadAgent,
  ) => Effect.Effect<A, MemoryService.Failure>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "Telescope memory");
  const memory = yield* MemoryService.MemoryService;
  return yield* gated(tool, args, (caller) =>
    use(memory, {
      memberId: caller.memberId,
      workspaceId: caller.workspaceId,
      run: { runId: caller.runId, agentId: caller.agentId, threadId: thread.threadId },
    }),
  );
});

const handlers = {
  memory_search: McpToolAccess.readsAsCaller((input) =>
    asRunAgent("memory_search", input, (memory, agent) =>
      memory.search(agent, { ...input, workspaceId: agent.workspaceId }),
    ),
  ),
  memory_write: McpToolAccess.actsAsCaller((input) =>
    asRunAgent("memory_write", input, (memory, agent) =>
      memory
        .write(agent, { ...input, workspaceId: agent.workspaceId, agentId: agent.run.agentId })
        .pipe(Effect.map((written) => ({ memory: written }))),
    ),
  ),
} satisfies McpToolAccess.Handlers<typeof MemoryToolkit.tools>;

export const layer = McpToolAccess.toLayer(MemoryToolkit, handlers);
