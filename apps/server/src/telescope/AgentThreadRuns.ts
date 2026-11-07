import type { OrchestrationV2DomainEvent, OrchestrationV2Run } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

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

export const runSnapshot = (modelSelection: OrchestrationV2Run["modelSelection"]) => ({
  promptVersion: PROMPT_VERSION,
  skillsVersions: {},
  powersVersion: "standing",
  model: modelSelection.model,
  provider: modelSelection.instanceId,
  contextManifest: [],
});

/**
 * Telescope runs on agent threads follow their Codi runs: a run the runtime did not start (the
 * member typing into a resident thread) opens one, and a terminal Codi run finishes every open
 * one. A delegated task still WORKING when its turn ends fails as unreported (D66).
 */
export const makeHandler = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const runs = yield* RunRecordService.RunRecordService;
  const delegations = yield* DelegationService.DelegationService;
  // A finished run can be updated again; finish its thread's runs once.
  const finished = new Set<string>();

  // Untraced: runs for every orchestration event; only agent threads reach the traced services.
  const handle = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
    if (event.type !== "run.created" && event.type !== "run.updated") return;
    const run = event.payload;
    const ending = event.type === "run.updated" && TERMINAL.has(run.status);
    if ((event.type === "run.updated" && !ending) || finished.has(run.id)) return;
    const owner = yield* db.agentThread(run.threadId);
    if (owner === undefined) return;
    const open = yield* db.openRunsOnThread(run.threadId);
    if (!ending) {
      if (open.length > 0) return;
      yield* runs.startFor(owner.workspaceId, owner.ownerSubjectId, {
        agentId: owner.agentId,
        threadId: run.threadId,
        inputSnapshot: runSnapshot(run.modelSelection),
      });
      return;
    }
    finished.add(run.id);
    const oldest = finished.values().next();
    if (finished.size > REMEMBERED_RUNS && !oldest.done) finished.delete(oldest.value);
    const outputSummary = `Codi run ${run.status}.`;
    yield* Effect.forEach(
      open,
      (ref) => runs.finish(ref, { outputSummary, tokens: NO_TOKENS, resultLabels: [] }),
      { discard: true },
    );
    const working = (yield* delegations.byThread(owner.workspaceId, run.threadId)).filter(
      (delegation) =>
        delegation.state === "WORKING" &&
        delegation.hop === "agent" &&
        delegation.toAgentId === owner.agentId,
    );
    const memberId = owner.ownerSubjectId;
    yield* Effect.forEach(
      working,
      ({ id }) =>
        delegations.abandon(
          { workspaceId: owner.workspaceId, delegationId: id, memberId },
          UNREPORTED,
        ),
      { discard: true },
    );
  });
  return (event: OrchestrationV2DomainEvent) =>
    handle(event).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("updating Telescope runs on an agent thread failed", { cause }),
      ),
    );
});
