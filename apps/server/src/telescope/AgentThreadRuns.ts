import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2Run,
  Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { PROMPT_VERSION } from "./AgentInstructions.ts";
import * as DelegationService from "./DelegationService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WakeQueueService from "./WakeQueueService.ts";

const REMEMBERED_RUNS = 4096;
const TERMINAL: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "rolled_back",
]);
const NO_TOKENS = { input: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
const UNREPORTED = "没有汇报";
/** Every state but a terminal one can still be cancelled. */
export const isOpen = (delegation: Telescope.Delegation) =>
  DelegationService.canMove(delegation.state, "CANCELED");

const workerWakeKey = (taskId: Telescope.DelegationId) => `delegation:${taskId}:worker`;
const decodeWakes = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ wake_id: Schema.String, status: Schema.String })),
);

const STARTED: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "starting",
  "running",
  "waiting",
]);

export const runSnapshot = (
  modelSelection: OrchestrationV2Run["modelSelection"],
  serves: {
    readonly codiMessageId: string;
    readonly delegationIds?: ReadonlyArray<Telescope.DelegationId>;
  },
) => ({
  promptVersion: PROMPT_VERSION,
  skillsVersions: {},
  powersVersion: "standing",
  model: modelSelection.model,
  provider: modelSelection.instanceId,
  contextManifest: [],
  ...serves,
});

const remember = (seen: Set<string>, id: string) => {
  seen.add(id);
  const oldest = seen.values().next();
  if (seen.size > REMEMBERED_RUNS && !oldest.done) seen.delete(oldest.value);
};

/**
 * Each Telescope run on an agent thread serves one Codi run, linked by its user message (D84). A
 * Codi run with no linked run (the member typing) opens one when it starts; a terminal Codi run
 * finishes its own, and a task that run served still WORKING fails as unreported (D66), with
 * its open Workers, unless one of them is live (D134). A Worker thread's ended run wakes its Chief.
 */
export const makeHandler = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const runs = yield* RunRecordService.RunRecordService;
  const delegations = yield* DelegationService.DelegationService;
  const wakes = yield* WakeQueueService.WakeQueueService;
  // A Codi run is updated many times; open for it once. A repeated terminal event finds no open run.
  const opened = new Set<string>();
  // The Codi run each agent thread's provider turns belong to, for their tokens.
  const serving = new Map<ThreadId, string>();

  // A Worker thread is no agent's own; its run serves its Worker task, which wakes the Chief once.
  const wakeChief = Effect.fn("AgentThreadRuns.wakeChief")(function* (done: Telescope.AgentRun) {
    const [memberId] = done.onBehalfOf;
    if (memberId === undefined) return;
    for (const delegationId of done.inputSnapshot.delegationIds ?? []) {
      const worker = yield* delegations.get({ workspaceId: done.workspaceId, delegationId });
      if (worker.hop !== "worker" || worker.parentId === undefined || !isOpen(worker)) continue;
      yield* wakes.enqueue(done.workspaceId, {
        reason: "dispatch",
        priority: 2,
        agentId: worker.toAgentId,
        subjectId: memberId,
        coalesceKey: workerWakeKey(worker.parentId),
        payload: { kind: "worker", delegationId: worker.parentId },
      });
    }
  });

  // Untraced: runs for every orchestration event; only agent threads reach the traced services.
  const handle = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
    if (event.type !== "run.created" && event.type !== "run.updated") return;
    const run = event.payload;
    const ending = TERMINAL.has(run.status);
    if (!ending && (!STARTED.has(run.status) || opened.has(run.id))) return;
    if (!ending) remember(opened, run.id);
    const owner = yield* db.agentThread(run.threadId);
    if (!ending) {
      if (owner === undefined) return;
      serving.set(run.threadId, run.userMessageId);
      if ((yield* db.openRunsOnThread(run.threadId, run.userMessageId)).length > 0) return;
      yield* runs.startFor(owner.workspaceId, owner.ownerSubjectId, {
        agentId: owner.agentId,
        threadId: run.threadId,
        inputSnapshot: runSnapshot(run.modelSelection, { codiMessageId: run.userMessageId }),
      });
      return;
    }
    const outputSummary = `Codi run ${run.status}.`;
    const ended = yield* Effect.forEach(
      yield* db.openRunsOnThread(run.threadId, run.userMessageId),
      (ref) => runs.finish(ref, { outputSummary, tokens: NO_TOKENS, resultLabels: [] }),
    );
    if (owner === undefined) return yield* Effect.forEach(ended, wakeChief, { discard: true });
    const served = new Set(ended.flatMap((done) => done.inputSnapshot.delegationIds ?? []));
    const unreported = (yield* delegations.byThread(owner.workspaceId, run.threadId)).filter(
      (delegation) =>
        served.has(delegation.id) &&
        delegation.state === "WORKING" &&
        delegation.hop === "agent" &&
        delegation.toAgentId === owner.agentId,
    );
    const workers =
      unreported.length === 0
        ? []
        : (yield* delegations.listForAgent(owner.workspaceId, owner.agentId)).filter(
            (delegation) => delegation.hop === "worker" && isOpen(delegation),
          );
    // A Worker is live while it waits for an answer, its run is open, or its settled wake has not
    // served a turn: queued, or running for a turn other than this one (AgentRuntime's message id).
    const live = Effect.fn("AgentThreadRuns.live")(function* (taskId: Telescope.DelegationId) {
      const hops = workers.filter((worker) => worker.parentId === taskId);
      if (hops.length === 0) return false;
      if (hops.some(({ state }) => state === "INPUT_REQUIRED" || state === "AUTH_REQUIRED"))
        return true;
      for (const { threadId } of hops)
        if (threadId !== undefined && (yield* db.openRunsOnThread(threadId)).length > 0)
          return true;
      const wakeRows = yield* db.select(
        owner.workspaceId,
        "wakes",
        decodeWakes,
        { coalesce_key: workerWakeKey(taskId) },
        { columns: ["wake_id", "status"] },
      );
      return wakeRows.some(
        ({ wake_id, status }) =>
          status === "queued" ||
          (status === "running" && run.userMessageId !== `telescope-wake:${wake_id}`),
      );
    });
    const memberId = owner.ownerSubjectId;
    const abandon = (delegationId: Telescope.DelegationId) =>
      delegations.abandon({ workspaceId: owner.workspaceId, delegationId, memberId }, UNREPORTED);
    for (const { id } of unreported) {
      if (yield* live(id)) continue;
      for (const worker of workers) if (worker.parentId === id) yield* abandon(worker.id);
      yield* abandon(id);
    }
  });
  return {
    servingOn: (threadId: ThreadId) => serving.get(threadId),
    handle: (event: OrchestrationV2DomainEvent) =>
      handle(event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("updating Telescope runs on an agent thread failed", { cause }),
        ),
      ),
  };
});
