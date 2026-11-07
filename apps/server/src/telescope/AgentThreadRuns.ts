import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2Run,
  Telescope,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { PROMPT_VERSION } from "./AgentInstructions.ts";
import * as DelegationService from "./DelegationService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";

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
 * finishes its own, and a task that run served still WORKING fails as unreported (D66).
 */
export const makeHandler = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const runs = yield* RunRecordService.RunRecordService;
  const delegations = yield* DelegationService.DelegationService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  // A Codi run is updated many times; open for it once. A repeated terminal event finds no open run.
  const opened = new Set<string>();
  // The Codi run each agent thread's provider turns belong to, for their tokens.
  const serving = new Map<ThreadId, string>();

  // A failed Codi run, such as a queued one Codi refused to start (D118), says why it failed.
  const failureOf = (run: OrchestrationV2Run) =>
    projections
      .getThreadRecords(run.threadId, ["turnItems"], {
        turnItemRunIds: [run.id],
        turnItemTypes: ["error"],
      })
      .pipe(
        Effect.map(({ turnItems }) =>
          turnItems.flatMap((item) => (item.type === "error" ? [item.failure.message] : [])).at(-1),
        ),
        Effect.orElseSucceed(() => undefined),
        Effect.map((message) => message ?? UNREPORTED),
      );

  // Untraced: runs for every orchestration event; only agent threads reach the traced services.
  const handle = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
    if (event.type !== "run.created" && event.type !== "run.updated") return;
    const run = event.payload;
    const ending = TERMINAL.has(run.status);
    if (!ending && (!STARTED.has(run.status) || opened.has(run.id))) return;
    if (!ending) remember(opened, run.id);
    const owner = yield* db.agentThread(run.threadId);
    if (owner === undefined) return;
    const linked = yield* db.openRunsOnThread(run.threadId, run.userMessageId);
    if (!ending) {
      serving.set(run.threadId, run.userMessageId);
      if (linked.length > 0) return;
      yield* runs.startFor(owner.workspaceId, owner.ownerSubjectId, {
        agentId: owner.agentId,
        threadId: run.threadId,
        inputSnapshot: runSnapshot(run.modelSelection, { codiMessageId: run.userMessageId }),
      });
      return;
    }
    const outputSummary = `Codi run ${run.status}.`;
    const ended = yield* Effect.forEach(linked, (ref) =>
      runs.finish(ref, { outputSummary, tokens: NO_TOKENS, resultLabels: [] }),
    );
    const served = new Set(ended.flatMap((done) => done.inputSnapshot.delegationIds ?? []));
    const working = (yield* delegations.byThread(owner.workspaceId, run.threadId)).filter(
      (delegation) =>
        served.has(delegation.id) &&
        delegation.state === "WORKING" &&
        delegation.hop === "agent" &&
        delegation.toAgentId === owner.agentId,
    );
    const memberId = owner.ownerSubjectId;
    const blockedOn = run.status === "failed" ? yield* failureOf(run) : UNREPORTED;
    yield* Effect.forEach(
      working,
      ({ id }) =>
        delegations.abandon(
          { workspaceId: owner.workspaceId, delegationId: id, memberId },
          blockedOn,
        ),
      { discard: true },
    );
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
