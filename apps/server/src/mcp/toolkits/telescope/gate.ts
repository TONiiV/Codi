import {
  EnvironmentId,
  OrchestratorMcpFailure,
  type Telescope,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
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
        message:
          error.reason === "linked"
            ? error.message
            : `${error.message} Do not retry; tell your member.`,
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
    message: "Telescope is unavailable.",
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

/**
 * Codi tools that open a thread, write into another one or change scheduled work (D78), by
 * whether this call does: in a Telescope run each is `dispatch_worker`.
 */
const DISPATCHES = new Map<
  string,
  (input: { readonly action?: unknown; readonly threadId?: unknown }, caller?: ThreadId) => boolean
>([
  ...[
    "delegate_task",
    "create_threads",
    "t3_thread_send",
    "t3_thread_send_attachments",
    "t3_thread_launch",
    "schedule_task",
    "delete_scheduled_task",
    "run_scheduled_task_now",
  ].map((tool) => [tool, () => true] as const),
  ["t3_thread_transfer", ({ action }) => action !== "status"],
  // PR events later start turns in the watching thread.
  ["watch_pull_request", ({ threadId }, caller) => threadId !== undefined && threadId !== caller],
]);

export const dispatchesWork = (tool: string) => DISPATCHES.has(tool);

// Decoded tool input is plain JSON once its unset optional keys are dropped.
const asJson = (input: object): Schema.Json => JSON.parse(JSON.stringify(input));

const isEnvironmentId = Schema.is(EnvironmentId);

/** Where the input sends work: its own `environmentId` and each `target`'s, at any depth. */
const destinations = (input: unknown, key = "target"): ReadonlyArray<EnvironmentId> =>
  typeof input !== "object" || input === null
    ? []
    : Object.entries(input).flatMap(([name, value]) =>
        name === "environmentId" && key === "target" && isEnvironmentId(value)
          ? [value]
          : destinations(value, Array.isArray(input) ? key : name),
      );

/**
 * `use` as tool `tool`: a dispatching call on a thread with an open run goes through the
 * gateway, and is refused there when it sends work to a linked environment.
 */
export const gateDispatch = Effect.fn("mcp.telescope.gateDispatch")(function* <A, E, R>(
  tool: string,
  input: object,
  use: Effect.Effect<A, E, R>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  // Optional so toolkit tests run without Telescope; the server always provides it.
  const gateway = yield* Effect.serviceOption(ToolGateway.ToolGateway);
  const thread = scope.thread?.threadId;
  if (thread === undefined || Option.isNone(gateway) || !DISPATCHES.get(tool)?.(input, thread))
    return yield* use;
  const linked = destinations(input).some(
    (environmentId) => PeerForwarding.remoteTarget(scope, environmentId) !== undefined,
  );
  const exit = yield* gateway.value
    .callIfRun(
      thread,
      "dispatch_worker",
      asJson(input),
      Effect.exit(use),
      linked ? "linked" : undefined,
    )
    .pipe(Effect.mapError(toFailure));
  return yield* exit;
});
