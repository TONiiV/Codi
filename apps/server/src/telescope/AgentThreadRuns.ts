import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2Run,
  Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { latestRestartContinuation } from "../orchestration-v2/ThreadManagementService.ts";
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
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown));

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

// A restart continuation resumes the Codi run it names, so a chain of them is one Codi turn.
export const firstOfChain = (
  codiRuns: ReadonlyArray<OrchestrationV2Run>,
  run: OrchestrationV2Run,
): OrchestrationV2Run => {
  const resumed = codiRuns.find((candidate) => candidate.id === run.restartContinuationOfRunId);
  return resumed === undefined ? run : firstOfChain(codiRuns, resumed);
};

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
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const wakes = yield* WakeQueueService.WakeQueueService;
  // A Codi run is updated many times; open for it once. A repeated terminal event finds no open run.
  const opened = new Set<string>();
  // The Codi run each agent thread's provider turns belong to, for their tokens.
  const serving = new Map<ThreadId, string>();
  // The startup pass and the event handler must not interleave, as two events never do.
  const lock = yield* Semaphore.make(1);
  // Each waits for the outcome of a Codi continuation, then looks at its Telescope run again.
  const rechecks = yield* FiberSet.make();
  const codiRunsOn = (threadId: ThreadId) =>
    projections.getThreadRecords(threadId, ["runs"]).pipe(
      Effect.map((records) => records.runs),
      Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed([]) }),
    );
  // Read before the server takes commands: a run opened later may not have its Codi run yet.
  // Rows decode one by one in the pass, so one bad row cannot hide the others.
  const leftOpen = yield* db.allWorkspaceIds.pipe(
    Effect.flatMap((workspaceIds) =>
      Effect.forEach(workspaceIds, (workspaceId) =>
        db.select(workspaceId, "runs", decodeRows, { finished_at: null }),
      ),
    ),
    Effect.map((rows) => rows.flat()),
    Effect.catchCause((cause) =>
      Effect.logWarning("reading open Telescope runs failed", { cause }).pipe(Effect.as([])),
    ),
  );
  // Codi owes a retry to a continuation that failed to start only once it sees that failure, so
  // one that failed before this server started has no retry coming.
  const failedBeforeStart = new Set(
    (yield* Effect.forEach(leftOpen, (row) =>
      RunRecordService.decodeRuns([row]).pipe(
        Effect.flatMap(([run]) =>
          run?.thread_id == null ? Effect.succeed([]) : codiRunsOn(run.thread_id),
        ),
        Effect.map((codiRuns) =>
          codiRuns.flatMap(({ id, status }) => (status === "failed" ? [id] : [])),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("reading a Telescope run's Codi runs failed", { cause }).pipe(
            Effect.as([]),
          ),
        ),
      ),
    )).flat(),
  );

  // A failed Codi run, such as a queued one Codi refused to start (D118), says why it failed.
  const failureOf = Effect.fn("AgentThreadRuns.failureOf")(function* (run: OrchestrationV2Run) {
    const message = yield* projections
      .getThreadRecords(run.threadId, ["turnItems"], {
        turnItemRunIds: [run.id],
        turnItemTypes: ["error"],
      })
      .pipe(
        Effect.map(({ turnItems }) =>
          turnItems.flatMap((item) => (item.type === "error" ? [item.failure.message] : [])).at(-1),
        ),
        Effect.orElseSucceed(() => undefined),
      );
    return message ?? UNREPORTED;
  });

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

  // A Codi run's end, or its absence (`run` undefined): its Telescope runs finish and follow up.
  const settle = Effect.fn("AgentThreadRuns.settle")(function* (
    threadId: ThreadId,
    codiMessageId: string,
    run: OrchestrationV2Run | undefined,
  ) {
    const owner = yield* db.agentThread(threadId);
    const outputSummary = `Codi run ${run?.status ?? "missing"}.`;
    const ended = yield* Effect.forEach(
      yield* db.openRunsOnThread(threadId, codiMessageId),
      (ref) => runs.finish(ref, { outputSummary, tokens: NO_TOKENS, resultLabels: [] }),
    );
    if (owner === undefined) return yield* Effect.forEach(ended, wakeChief, { discard: true });
    const served = new Set(ended.flatMap((done) => done.inputSnapshot.delegationIds ?? []));
    const unreported = (yield* delegations.byThread(owner.workspaceId, threadId)).filter(
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
          (status === "running" && codiMessageId !== `telescope-wake:${wake_id}`),
      );
    });
    const memberId = owner.ownerSubjectId;
    const blockedOn = run?.status === "failed" ? yield* failureOf(run) : UNREPORTED;
    const abandon = (delegationId: Telescope.DelegationId, reason: string) =>
      delegations.abandon({ workspaceId: owner.workspaceId, delegationId, memberId }, reason);
    for (const { id } of unreported) {
      if (yield* live(id)) continue;
      for (const worker of workers)
        if (worker.parentId === id) yield* abandon(worker.id, UNREPORTED);
      yield* abandon(id, blockedOn);
    }
  });

  // A restart continuation serves the Telescope run of the Codi run its chain started with.
  const servedMessageId = Effect.fn("AgentThreadRuns.servedMessageId")(function* (
    run: OrchestrationV2Run,
  ) {
    if (run.restartContinuationOfRunId === undefined) return run.userMessageId;
    return firstOfChain(yield* codiRunsOn(run.threadId), run).userMessageId;
  });
  const logged = (message: string) =>
    Effect.catchCause((cause) => Effect.logWarning(message, { cause }));
  // Settles once the chain's last Codi run has ended, or is gone, and no continuation of it is
  // pending; a declined one emits no event, so a pending one's outcome is awaited, then rechecked.
  const settleIfEnded = Effect.fn("AgentThreadRuns.settleIfEnded")(function* (
    threadId: ThreadId,
    codiMessageId: string,
  ) {
    const codiRuns = yield* codiRunsOn(threadId);
    const first = codiRuns.findLast((candidate) => candidate.userMessageId === codiMessageId);
    const run = first === undefined ? undefined : latestRestartContinuation(codiRuns, first);
    if (run !== undefined && !TERMINAL.has(run.status)) return;
    const retryOwed = run !== undefined && !failedBeforeStart.has(run.id);
    if (run === undefined || !(yield* engine.restartContinuationPending(run, { retryOwed })))
      return yield* settle(threadId, codiMessageId, run);
    const recheck = (): Effect.Effect<void> =>
      lock
        .withPermit(settleIfEnded(threadId, codiMessageId))
        .pipe(logged("settling a resumed Telescope run failed"));
    yield* FiberSet.run(
      rechecks,
      engine.awaitRestartContinuation(run, { retryOwed }).pipe(Effect.andThen(recheck)),
    );
  });

  // Untraced: runs for every orchestration event; only agent threads reach the traced services.
  const handle = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
    if (event.type !== "run.created" && event.type !== "run.updated") return;
    const run = event.payload;
    if (TERMINAL.has(run.status)) {
      const codiMessageId = yield* servedMessageId(run);
      if ((yield* db.openRunsOnThread(run.threadId, codiMessageId)).length === 0) return;
      return yield* settleIfEnded(run.threadId, codiMessageId);
    }
    if (!STARTED.has(run.status) || opened.has(run.id)) return;
    remember(opened, run.id);
    const owner = yield* db.agentThread(run.threadId);
    if (owner === undefined) return;
    const codiMessageId = yield* servedMessageId(run);
    serving.set(run.threadId, codiMessageId);
    if ((yield* db.openRunsOnThread(run.threadId, codiMessageId)).length > 0) return;
    yield* runs.startFor(owner.workspaceId, owner.ownerSubjectId, {
      agentId: owner.agentId,
      threadId: run.threadId,
      inputSnapshot: runSnapshot(run.modelSelection, { codiMessageId }),
    });
  });

  // A run left open by a restart settles at startup when its Codi run ended or is gone, unless
  // Codi resumes that run; a Codi run still live after recovery settles on its own end.
  const settleOrphan = Effect.fn("AgentThreadRuns.settleOrphan")(function* (row: unknown) {
    const [run] = yield* RunRecordService.decodeRuns([row]);
    const codiMessageId = run?.input_snapshot_json.codiMessageId;
    if (run?.thread_id == null || codiMessageId === undefined) return;
    yield* settleIfEnded(run.thread_id, codiMessageId);
  });

  return {
    servingOn: (threadId: ThreadId) => serving.get(threadId),
    handle: (event: OrchestrationV2DomainEvent) =>
      lock
        .withPermit(handle(event))
        .pipe(logged("updating Telescope runs on an agent thread failed")),
    /** Resolves once no Telescope run waits for the outcome of a Codi continuation. */
    awaitContinuations: FiberSet.awaitEmpty(rechecks),
    settleOrphans: Effect.forEach(
      leftOpen,
      (row) => settleOrphan(row).pipe(logged("settling a Telescope run left open failed")),
      { discard: true },
    ).pipe(lock.withPermit),
  };
});
