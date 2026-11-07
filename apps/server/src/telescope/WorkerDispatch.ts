import {
  CommandId,
  MessageId,
  type ModelSelection,
  type ProjectId,
  resolveProjectProviderInstanceEnabled,
  Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { renderBrief } from "./AgentInstructions.ts";
import { isOpen, runSnapshot } from "./AgentThreadRuns.ts";
import * as DelegationService from "./DelegationService.ts";
import * as GrantService from "./GrantService.ts";
import * as RoutingService from "./RoutingService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import type { ToolCaller } from "./ToolGateway.ts";

const WORKER_TASK_TYPE = "worker";
const NO_TOKENS = { input: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
const CANCELLED = "The task was cancelled before its Worker started.";
const NO_MODEL =
  "The project's routing allows no model for a Worker, so none was opened. Report it on your task with `delegation_report`.";

const allows = (list: ReadonlyArray<string> | undefined, value: string) =>
  list === undefined || list.length === 0 || list.includes(value);

/**
 * A Worker's model (plan 2.6): a rule or the agent's own model; with no candidate at all, the
 * server default, only inside the project's allowlist. Nothing when every candidate was refused.
 */
export const workerModel = (
  route: Telescope.RoutingResolution,
  fallback: ModelSelection | null,
  allowlist: Telescope.RoutingAllowlist | undefined,
): ModelSelection | undefined => {
  if (route.source !== "none") return route.modelSelection;
  return fallback !== null &&
    allows(allowlist?.harnesses, fallback.instanceId) &&
    allows(allowlist?.models, fallback.model)
    ? fallback
    : undefined;
};

interface DispatchInput {
  readonly delegationId: Telescope.DelegationId;
  readonly brief: typeof Telescope.DelegationBrief.Type;
}
type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;
const fail = (reason: Telescope.WorkspaceError["reason"], message: string) =>
  Effect.fail(new Telescope.WorkspaceError({ reason, message }));

/** Chief Agents' Workers: ordinary top-level threads in the Chief's project (D69). */
export class WorkerDispatch extends Context.Service<
  WorkerDispatch,
  {
    /**
     * A Worker for a task the calling Chief holds in WORKING; its run exists before its session.
     * No thread when the task was cancelled before it was created.
     */
    readonly dispatch: (
      caller: ToolCaller,
      input: DispatchInput,
    ) => Effect.Effect<
      { readonly delegation: Telescope.Delegation; readonly threadId: ThreadId | undefined },
      Failure
    >;
    /** `DelegationService.cancel`, then each cancelled Worker's turn is interrupted; threads stay. */
    readonly cancel: (
      by: DelegationService.Actor | DelegationService.MemberActor,
      delegationId: Telescope.DelegationId,
    ) => Effect.Effect<ReadonlyArray<Telescope.Delegation>, Failure>;
  }
>()("t3/telescope/WorkerDispatch") {}

const make = Effect.gen(function* () {
  const delegations = yield* DelegationService.DelegationService;
  const runs = yield* RunRecordService.RunRecordService;
  const routing = yield* RoutingService.RoutingService;
  const grants = yield* GrantService.GrantService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const settings = yield* ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;

  const route = Effect.fn("WorkerDispatch.route")(function* (
    caller: ToolCaller,
    projectId: ProjectId,
  ) {
    const resolved = yield* routing.resolve(caller.workspaceId, {
      agentId: caller.agentId,
      projectId,
      taskType: WORKER_TASK_TYPE,
    });
    const allowlist =
      resolved.source === "none"
        ? yield* grants.routingAllowlist(caller.workspaceId, projectId)
        : undefined;
    const current = yield* settings.getSettings.pipe(Effect.orDie);
    const selection = workerModel(resolved, current.defaultModelSelection, allowlist);
    // `RoutingService` already checked a resolved model; this covers the fallback.
    return selection !== undefined &&
      resolveProjectProviderInstanceEnabled(current, projectId, selection.instanceId)
      ? selection
      : yield* fail("forbidden", NO_MODEL);
  });

  const dispatch = Effect.fn("WorkerDispatch.dispatch")(function* (
    caller: ToolCaller,
    input: DispatchInput,
  ) {
    const { workspaceId, memberId, projectId } = caller;
    if (projectId === undefined)
      return yield* fail("forbidden", "Only a project's agent opens Worker threads.");
    const selection = yield* route(caller, projectId);
    const threadId = ThreadId.make(yield* random.uuidV4());
    const worker = yield* delegations.recordWorker(caller, {
      parentId: input.delegationId,
      brief: input.brief,
      threadId,
    });
    const messageId = MessageId.make(`telescope-worker:${worker.id}`);
    // The Worker acts through the Chief's chain, so its grant is the Chief's.
    const run = yield* runs.startFor(workspaceId, memberId, {
      agentId: caller.agentId,
      via: caller.onBehalfOf.slice(1),
      threadId,
      inputSnapshot: runSnapshot(selection, {
        codiMessageId: messageId,
        delegationIds: [worker.id],
      }),
    });
    // D81: with no Codi turn started, no listener finishes this run.
    const notStarted = (error: { readonly message: string }) =>
      runs
        .finish(
          { workspaceId, runId: run.id },
          { outputSummary: `Failed: ${error.message}`, tokens: NO_TOKENS, resultLabels: [] },
        )
        .pipe(
          Effect.andThen(
            delegations.abandon({ workspaceId, delegationId: worker.id, memberId }, error.message),
          ),
        );
    yield* delegations
      .start({ workspaceId, delegationId: worker.id })
      .pipe(Effect.tapError(notStarted));
    const latest = delegations.get({ workspaceId, delegationId: worker.id });
    const beforeCreate = yield* latest;
    if (!isOpen(beforeCreate)) {
      yield* runs.finish(
        { workspaceId, runId: run.id },
        { outputSummary: CANCELLED, tokens: NO_TOKENS, resultLabels: [] },
      );
      return { delegation: beforeCreate, threadId: undefined };
    }
    const provenance = { createdBy: "agent", creationSource: "server" } as const;
    const { defaultRuntimeMode } = yield* settings.getSettings.pipe(Effect.orDie);
    yield* threads
      .dispatch({
        type: "thread.create",
        commandId: CommandId.make(`telescope-worker:${worker.id}:thread`),
        threadId,
        projectId,
        title: input.brief.goal,
        modelSelection: selection,
        runtimeMode: defaultRuntimeMode,
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        ...provenance,
      })
      .pipe(
        Effect.andThen(
          threads.sendToThread({
            projectId,
            commandId: CommandId.make(`telescope-worker:${worker.id}`),
            threadId,
            messageId,
            modelSelection: selection,
            text: renderBrief(input.brief),
            attachments: [],
            mode: "queue",
            ...provenance,
          }),
        ),
        Effect.tapError(notStarted),
        Effect.mapError(
          (error) => new Telescope.WorkspaceError({ reason: "conflict", message: error.message }),
        ),
      );
    // A cancel before the send found no turn to interrupt.
    const afterSend = yield* latest;
    if (!isOpen(afterSend)) yield* interrupt(`telescope-cancel:${worker.id}:sent`, threadId);
    return { delegation: afterSend, threadId };
  });

  const interrupt = (commandId: string, threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(
      Effect.flatMap((shell) =>
        shell === null
          ? Effect.void
          : threads.interruptThread({
              projectId: shell.projectId,
              commandId: CommandId.make(commandId),
              threadId,
              reason: "The Worker's task was cancelled.",
            }),
      ),
      // The cancel is recorded; a Worker that cannot be stopped is left running.
      Effect.catchCause((cause) =>
        Effect.logWarning("interrupting a cancelled Worker failed", { cause }),
      ),
    );

  const cancel = Effect.fn("WorkerDispatch.cancel")(function* (
    by: DelegationService.Actor | DelegationService.MemberActor,
    delegationId: Telescope.DelegationId,
  ) {
    const cancelled = yield* delegations.cancel(by, delegationId);
    yield* Effect.forEach(
      cancelled,
      (row) =>
        row.hop === "worker" && row.threadId !== undefined
          ? interrupt(`telescope-cancel:${row.id}`, row.threadId)
          : Effect.void,
      { discard: true },
    );
    return cancelled;
  });

  return WorkerDispatch.of({ dispatch, cancel });
});

export const layer = Layer.effect(WorkerDispatch, make);
