import { OrchestratorMcpFailure, type Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";

import type { PersistenceDecodeError, PersistenceSqlError } from "../../../persistence/Errors.ts";
import * as ToolGateway from "../../../telescope/ToolGateway.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export type Failure =
  | ToolGateway.ToolGatewayDenied
  | Telescope.WorkspaceError
  | Telescope.StaleTaskVersionError
  | Telescope.FreeTextLimitError
  | PersistenceSqlError
  | PersistenceDecodeError;

const toFailure = (error: Failure) => {
  switch (error._tag) {
    case "TelescopeToolGatewayDenied":
      return new OrchestratorMcpFailure({
        code: "capability_denied",
        message: `${error.message} Do not retry; tell your member.`,
      });
    case "TelescopeWorkspaceError":
      if (error.reason !== "storage")
        return new OrchestratorMcpFailure({
          code: error.reason === "forbidden" ? "capability_denied" : "invalid_request",
          message: error.message,
        });
      break;
    case "TelescopeStaleTaskVersionError":
    case "TelescopeFreeTextLimitError":
      return new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
  }
  return new OrchestratorMcpFailure({
    code: "orchestration_error",
    message: "The Telescope board is unavailable.",
  });
};

/** Every call goes through the gateway; the thread's open run decides who it acts as. */
export const gated = Effect.fn("mcp.telescope.gated")(function* <A, R>(
  tool: Telescope.GatewayTool,
  args: Schema.Json,
  use: (caller: ToolGateway.ToolCaller) => Effect.Effect<A, Failure, R>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "Telescope tools");
  const gateway = yield* ToolGateway.ToolGateway;
  return yield* gateway.call(thread.threadId, tool, args, use).pipe(Effect.mapError(toFailure));
});

const gateIfRun = Effect.fn("mcp.telescope.gatedIfRun")(function* <A, E, R>(
  tool: Telescope.GatewayTool,
  args: Schema.Json,
  use: Effect.Effect<A, E, R>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  // Optional so toolkit tests run without Telescope; the server always provides it.
  const gateway = yield* Effect.serviceOption(ToolGateway.ToolGateway);
  if (scope.thread === undefined || Option.isNone(gateway)) return yield* use;
  const exit = yield* gateway.value
    .callIfRun(scope.thread.threadId, tool, args, Effect.exit(use))
    .pipe(Effect.mapError(toFailure));
  return yield* exit;
});

/** A Codi tool in a Telescope run goes through the gateway; anywhere else it runs as before. */
export const gatedIfRun =
  (tool: Telescope.GatewayTool, input: object) =>
  <A, E, R>(use: Effect.Effect<A, E, R>) =>
    // Decoded tool input is plain JSON once its unset optional keys are dropped.
    gateIfRun(tool, JSON.parse(JSON.stringify(input)), use);
