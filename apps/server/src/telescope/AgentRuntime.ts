import { CommandId, MessageId, Telescope, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import { DEV_REPLAY_INSTANCE_ID } from "../provider/ProviderInstanceRegistryHydration.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as AgentInstructions from "./AgentInstructions.ts";
import { runSnapshot } from "./AgentThreadRuns.ts";
import * as AgentService from "./AgentService.ts";
import * as DelegationService from "./DelegationService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WakeQueueService from "./WakeQueueService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const STOPPED = "agent stopped";
const PROVENANCE = { createdBy: "agent", creationSource: "server" } as const;
const NO_TOKENS = { input: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
// A wake holds its agent's queue slot until the turn ends; a turn longer than this releases it.
const TURN_WAIT_MS = 6 * 60 * 60 * 1000;

const AgentRuntimeErrorReason = Schema.Literals(["no_model", "no_mcp"]);
class AgentRuntimeError extends Schema.TaggedError<AgentRuntimeError>()(
  "TelescopeAgentRuntimeError",
  { reason: AgentRuntimeErrorReason, agentId: Telescope.AgentId },
) {
  override get message(): string {
    return Telescope.AGENT_MODEL_REFUSALS[this.reason];
  }
}

const decodePayload = Schema.decodeUnknownOption(AgentInstructions.WakePayload);
const decodeStops = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ agent_id: Telescope.AgentId, state: Schema.String })),
);
const decodeResident = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ resident_thread_id: Schema.NullOr(ThreadId) })),
);

type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;

/** Runs each wake as a turn on its agent's resident thread (plan 2.3: run before session). */
export class AgentRuntime extends Context.Service<
  AgentRuntime,
  {
    /** A failed wake dies; the queue logs it and records it as failed. */
    readonly run: (wakeRun: WakeQueueService.WakeRun) => Effect.Effect<void>;
    /** The owner's chat: returns the agent's resident thread, creating it with no turn. */
    readonly openThread: (
      caller: WorkspaceService.SessionCaller,
      input: typeof Telescope.AgentGetInput.Type,
    ) => Effect.Effect<typeof Telescope.AgentOpenThreadResult.Type, Failure>;
  }
>()("t3/telescope/AgentRuntime") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const workspaces = yield* WorkspaceService.WorkspaceService;
  const agents = yield* AgentService.AgentService;
  const runs = yield* RunRecordService.RunRecordService;
  const delegations = yield* DelegationService.DelegationService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const providers = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
  const settings = yield* ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;

  const stopped = Effect.fn("AgentRuntime.stopped")(function* (
    workspaceId: Telescope.WorkspaceId,
    chain: ReadonlyArray<string>,
  ) {
    const rows = yield* db.select(workspaceId, "kill_switches", decodeStops);
    return rows.some((row) => chain.includes(row.agent_id) && row.state !== "running");
  });

  const prepare = Effect.fn("AgentRuntime.prepare")(function* (agent: Telescope.Agent) {
    const selection = agent.modelSelection ?? (yield* settings.getSettings).defaultModelSelection;
    if (selection === null)
      return yield* new AgentRuntimeError({ reason: "no_model", agentId: agent.id });
    // Replay has no tools at all; it may host a thread only so dev UI checks cost nothing (D87).
    if (selection.instanceId !== DEV_REPLAY_INSTANCE_ID) {
      const capabilities = yield* (yield* providers.get(selection.instanceId)).getCapabilities();
      if (!capabilities.tools.supportsMcpTools)
        return yield* new AgentRuntimeError({ reason: "no_mcp", agentId: agent.id });
    }
    const { projectId } =
      agent.projectId === undefined
        ? yield* folders.ensureScratchProject
        : { projectId: agent.projectId };
    return { selection, projectId };
  });

  const openResident = Effect.fn("AgentRuntime.openResident")(function* (agent: Telescope.Agent) {
    const resident =
      agent.residentThreadId === undefined
        ? null
        : yield* threads.getThreadShell(agent.residentThreadId);
    return resident !== null && resident.archivedAt === null ? resident : null;
  });

  /** D88: writes `threadId` only while the row still holds what `agent` read; returns the winner. */
  const claimThread = Effect.fn("AgentRuntime.claimThread")(function* (
    agent: Telescope.Agent,
    threadId: ThreadId,
  ) {
    yield* db.update(
      agent.workspaceId,
      "agents",
      { resident_thread_id: threadId },
      { agent_id: agent.id, resident_thread_id: agent.residentThreadId ?? null },
    );
    const [row] = yield* db.select(agent.workspaceId, "agents", decodeResident, {
      agent_id: agent.id,
    });
    const winner = row?.resident_thread_id ?? null;
    if (winner === null)
      return yield* new Telescope.WorkspaceError({
        reason: "conflict",
        message: "The agent's thread changed while it was opening. Try again.",
      });
    return winner;
  });

  // Keyed by the thread, so a caller that lost the claim replays the winner's create.
  const createThread = Effect.fn("AgentRuntime.createThread")(function* (
    agent: Telescope.Agent,
    threadId: ThreadId,
    { projectId, selection }: Effect.Success<ReturnType<typeof prepare>>,
  ) {
    return yield* threads.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`telescope-resident:${threadId}`),
      threadId,
      projectId,
      title: agent.name,
      modelSelection: selection,
      runtimeMode: (yield* settings.getSettings).defaultRuntimeMode,
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      ...PROVENANCE,
    });
  });

  const abandon = (wake: Telescope.Wake, delegation: Telescope.Delegation, blockedOn: string) =>
    delegations.abandon(
      { workspaceId: wake.workspaceId, delegationId: delegation.id, memberId: wake.subjectId },
      blockedOn,
    );

  const openThread = Effect.fn("AgentRuntime.openThread")(function* (
    caller: WorkspaceService.SessionCaller,
    input: typeof Telescope.AgentGetInput.Type,
  ) {
    const { self } = yield* workspaces.get(caller, { workspaceId: input.workspaceId });
    const { agent } = yield* agents.powersOf(input.workspaceId, input.agentId);
    if (agent.ownerSubjectId !== self.subjectId)
      return yield* new Telescope.WorkspaceError({
        reason: "not_found",
        message: "That agent is not one of yours.",
      });
    const invalid = (error: { readonly message: string }) =>
      new Telescope.WorkspaceError({ reason: "invalid", message: error.message });
    const reuse = yield* openResident(agent).pipe(Effect.mapError(invalid));
    if (reuse !== null) return { threadId: reuse.id };
    const prepared = yield* prepare(agent).pipe(Effect.mapError(invalid));
    const fresh = ThreadId.make(yield* random.uuidV4());
    const threadId = yield* claimThread(agent, fresh);
    if (threadId === fresh)
      yield* createThread(agent, threadId, prepared).pipe(Effect.mapError(invalid));
    return { threadId };
  });

  const run = Effect.fn("AgentRuntime.run")(function* ({
    wake,
    payloads,
  }: WakeQueueService.WakeRun) {
    const { agent } = yield* agents.powersOf(wake.workspaceId, wake.agentId);
    const reuse = yield* openResident(agent);
    // A turn the member started finishes its own run when it ends; start after it.
    if (reuse !== null)
      yield* threads.waitForThread({
        projectId: reuse.projectId,
        threadId: reuse.id,
        timeoutMs: TURN_WAIT_MS,
      });
    // Read after the wait (D84): the agent may be stopped or a task cancelled by now.
    const decoded = payloads.flatMap((value) => Option.toArray(decodePayload(value)));
    // Wakes merged into this one repeat its payload.
    const unique = new Map(decoded.map((payload) => [JSON.stringify(payload), payload])).values();
    const items: Array<AgentInstructions.TurnItem> = [];
    for (const payload of unique) {
      if (payload.kind === "message") {
        items.push(payload);
        continue;
      }
      const delegation = yield* delegations.get({
        workspaceId: wake.workspaceId,
        delegationId: payload.delegationId,
      });
      // An answer or a Worker's turn end serves a task in WORKING; a cancel since then drops it.
      const live = payload.kind === "answer" || payload.kind === "worker" ? "WORKING" : "SUBMITTED";
      if (payload.kind === "report" || delegation.state === live)
        items.push({ kind: payload.kind, delegation });
    }
    if (items.length === 0) return;
    const held = items.flatMap((item) =>
      item.kind === "delegation" || item.kind === "worker" || item.kind === "answer"
        ? [item.delegation]
        : [],
    );
    const via = held[0] === undefined ? [] : [held[0].fromAgentId];
    const abandonHeld = (blockedOn: string) =>
      Effect.forEach(held, (delegation) => abandon(wake, delegation, blockedOn), {
        discard: true,
      });
    if (yield* stopped(wake.workspaceId, [agent.id, ...via])) return yield* abandonHeld(STOPPED);
    const { selection, projectId } = yield* prepare(agent).pipe(
      Effect.tapError((error) => abandonHeld(error.message)),
    );
    const fresh = ThreadId.make(yield* random.uuidV4());
    const threadId = reuse?.id ?? (yield* claimThread(agent, fresh));
    // Only the caller whose id the registry took may reset it (D95).
    const claimed = threadId === fresh;
    const threadProject = reuse?.projectId ?? projectId;
    // The run serves exactly the Codi run this message starts (D84).
    const messageId = MessageId.make(`telescope-wake:${wake.id}`);
    const run = yield* runs
      .startFor(wake.workspaceId, wake.subjectId, {
        agentId: agent.id,
        via,
        threadId,
        inputSnapshot: runSnapshot(selection, {
          codiMessageId: messageId,
          delegationIds: held.map((delegation) => delegation.id),
        }),
      })
      .pipe(
        Effect.tapError((error) =>
          // A later wake must not reuse a thread this wake never created.
          (claimed
            ? db.update(
                wake.workspaceId,
                "agents",
                { resident_thread_id: null },
                { agent_id: agent.id, resident_thread_id: threadId },
              )
            : Effect.void
          ).pipe(Effect.andThen(abandonHeld(error.message))),
        ),
      );
    // D81: with no Codi turn started, no listener finishes this run, so the runtime does.
    const notStarted = (error: { readonly message: string }) =>
      runs
        .finish(
          { workspaceId: wake.workspaceId, runId: run.id },
          { outputSummary: `Failed: ${error.message}`, tokens: NO_TOKENS, resultLabels: [] },
        )
        .pipe(Effect.andThen(abandonHeld(error.message)));
    yield* Effect.forEach(
      held.filter((delegation) => delegation.state === "SUBMITTED"),
      (delegation) =>
        delegations.start({ workspaceId: wake.workspaceId, delegationId: delegation.id, threadId }),
      { discard: true },
    ).pipe(Effect.tapError(notStarted));
    if (reuse === null)
      yield* createThread(agent, threadId, { selection, projectId }).pipe(
        Effect.tapError(notStarted),
      );
    const sent = yield* threads
      .sendToThread({
        projectId: threadProject,
        commandId: CommandId.make(`telescope-wake:${wake.id}`),
        threadId,
        messageId,
        modelSelection: selection,
        // A thread the member opened from the chat page has had no turn yet.
        text: AgentInstructions.renderTurn(agent, items, {
          firstTurn: reuse === null || reuse.latestRunId === null,
        }),
        attachments: [],
        mode: "queue",
        ...PROVENANCE,
      })
      .pipe(Effect.tapError(notStarted));
    yield* threads.waitForThread({
      projectId: threadProject,
      threadId,
      runId: sent.run.id,
      timeoutMs: TURN_WAIT_MS,
    });
  }, Effect.orDie);

  return AgentRuntime.of({ run, openThread });
});

export const layer = Layer.effect(AgentRuntime, make);

/** The wake queue's runner; a failed wake dies, and the queue logs it and records it as failed. */
export const layerWakeRunner = Layer.effect(
  WakeQueueService.WakeRunner,
  Effect.map(AgentRuntime, (runtime) => runtime.run),
);
