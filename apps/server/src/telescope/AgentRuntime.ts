import { CommandId, MessageId, Telescope, ThreadId } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as AgentInstructions from "./AgentInstructions.ts";
import { runSnapshot } from "./AgentThreadRuns.ts";
import * as AgentService from "./AgentService.ts";
import * as DelegationService from "./DelegationService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WakeQueueService from "./WakeQueueService.ts";

const STOPPED = "agent stopped";
const NO_TOKENS = { input: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
// A wake holds its agent until the turn ends; a turn longer than this releases it.
const TURN_WAIT_MS = 6 * 60 * 60 * 1000;

const AgentRuntimeErrorReason = Schema.Literals(["no_model", "no_mcp"]);
const MESSAGES = {
  no_model: "Choose a model for this agent or a default model in Settings.",
  no_mcp: "This agent's provider cannot use Codi's tools, so it cannot host the agent's thread.",
} as const;
class AgentRuntimeError extends Schema.TaggedError<AgentRuntimeError>()(
  "TelescopeAgentRuntimeError",
  { reason: AgentRuntimeErrorReason, agentId: Telescope.AgentId },
) {
  override get message(): string {
    return MESSAGES[this.reason];
  }
}

const decodePayload = Schema.decodeUnknownOption(AgentInstructions.WakePayload);
const decodeStops = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ agent_id: Telescope.AgentId, state: Schema.String })),
);

/** Runs each wake as a turn on its agent's resident thread (plan 2.3: run before session). */
const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const agents = yield* AgentService.AgentService;
  const runs = yield* RunRecordService.RunRecordService;
  const delegations = yield* DelegationService.DelegationService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const providers = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
  const settings = yield* ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;
  // Delegation wakes carry no thread id, so the queue cannot keep two on one resident thread.
  const locks = new Map<Telescope.AgentId, Semaphore.Semaphore>();
  const lockFor = (agentId: Telescope.AgentId) =>
    Effect.sync(() => {
      const lock = locks.get(agentId) ?? Semaphore.makeUnsafe(1);
      locks.set(agentId, lock);
      return lock;
    });

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
    const capabilities = yield* (yield* providers.get(selection.instanceId)).getCapabilities();
    if (!capabilities.tools.supportsMcpTools)
      return yield* new AgentRuntimeError({ reason: "no_mcp", agentId: agent.id });
    const { projectId } =
      agent.projectId === undefined
        ? yield* folders.ensureScratchProject
        : { projectId: agent.projectId };
    return { selection, projectId };
  });

  const runTurn = Effect.fn("AgentRuntime.runTurn")(function* (
    wake: Telescope.Wake,
    agent: Telescope.Agent,
    via: ReadonlyArray<string>,
    items: ReadonlyArray<AgentInstructions.TurnItem>,
    held: ReadonlyArray<Telescope.Delegation>,
  ) {
    const { selection, projectId } = yield* prepare(agent).pipe(
      Effect.tapError((error) =>
        Effect.forEach(held, (delegation) => abandon(wake, delegation, error.message), {
          discard: true,
        }),
      ),
    );
    const resident =
      agent.residentThreadId === undefined
        ? null
        : yield* threads.getThreadShell(agent.residentThreadId);
    const reuse = resident !== null && resident.archivedAt === null ? resident : null;
    const threadId = reuse?.id ?? ThreadId.make(yield* random.uuidV4());
    const threadProject = reuse?.projectId ?? projectId;
    if (reuse === null) {
      yield* db.update(
        wake.workspaceId,
        "agents",
        { resident_thread_id: threadId },
        { agent_id: agent.id },
      );
    } else {
      // A turn the member started finishes the open run when it ends; start after it.
      yield* threads.waitForThread({ projectId: threadProject, threadId, timeoutMs: TURN_WAIT_MS });
    }
    const run = yield* runs.startFor(wake.workspaceId, wake.subjectId, {
      agentId: agent.id,
      via,
      threadId,
      inputSnapshot: runSnapshot(selection),
    });
    // D81: with no Codi turn started, no listener finishes this run, so the runtime does.
    const notStarted = (error: { readonly message: string }) =>
      runs
        .finish(
          { workspaceId: wake.workspaceId, runId: run.id },
          { outputSummary: `Failed: ${error.message}`, tokens: NO_TOKENS, resultLabels: [] },
        )
        .pipe(
          Effect.andThen(
            Effect.forEach(held, (delegation) => abandon(wake, delegation, error.message), {
              discard: true,
            }),
          ),
        );
    yield* Effect.forEach(
      held,
      (delegation) =>
        delegations.start({ workspaceId: wake.workspaceId, delegationId: delegation.id, threadId }),
      { discard: true },
    ).pipe(Effect.tapError(notStarted));
    const provenance = { createdBy: "agent", creationSource: "server" } as const;
    if (reuse === null)
      yield* threads
        .dispatch({
          type: "thread.create",
          commandId: CommandId.make(`telescope-wake:${wake.id}:thread`),
          threadId,
          projectId,
          title: agent.name,
          modelSelection: selection,
          runtimeMode: (yield* settings.getSettings).defaultRuntimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          ...provenance,
        })
        .pipe(Effect.tapError(notStarted));
    const sent = yield* threads
      .sendToThread({
        projectId: threadProject,
        commandId: CommandId.make(`telescope-wake:${wake.id}`),
        threadId,
        messageId: MessageId.make(`telescope-wake:${wake.id}`),
        text: AgentInstructions.renderTurn(agent, items, { firstTurn: reuse === null }),
        attachments: [],
        mode: "queue",
        ...provenance,
      })
      .pipe(Effect.tapError(notStarted));
    yield* threads.waitForThread({
      projectId: threadProject,
      threadId,
      runId: sent.run.id,
      timeoutMs: TURN_WAIT_MS,
    });
  });

  const abandon = (wake: Telescope.Wake, delegation: Telescope.Delegation, blockedOn: string) =>
    delegations.abandon(
      { workspaceId: wake.workspaceId, delegationId: delegation.id, memberId: wake.subjectId },
      blockedOn,
    );

  return Effect.fn("AgentRuntime.run")(function* ({ wake, payloads }: WakeQueueService.WakeRun) {
    const { agent } = yield* agents.powersOf(wake.workspaceId, wake.agentId);
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
      // A delegation cancelled after its wake was taken has nothing left to run.
      if (payload.kind === "report" || delegation.state === "SUBMITTED")
        items.push({ kind: payload.kind, delegation });
    }
    if (items.length === 0) return;
    const held = items.flatMap((item) => (item.kind === "delegation" ? [item.delegation] : []));
    const via = held[0] === undefined ? [] : [held[0].fromAgentId];
    if (yield* stopped(wake.workspaceId, [agent.id, ...via])) {
      yield* Effect.forEach(held, (delegation) => abandon(wake, delegation, STOPPED), {
        discard: true,
      });
      return;
    }
    const lock = yield* lockFor(agent.id);
    // Re-read under the lock: the wake before this one may have created the thread.
    yield* lock.withPermit(
      agents
        .powersOf(wake.workspaceId, wake.agentId)
        .pipe(Effect.flatMap((current) => runTurn(wake, current.agent, via, items, held))),
    );
  });
});

/** Provides the wake queue's runner, which logs a failed wake and records it as failed. */
export const layer = Layer.effect(
  WakeQueueService.WakeRunner,
  make.pipe(Effect.map((run) => (wakeRun: WakeQueueService.WakeRun) => Effect.orDie(run(wakeRun)))),
);
