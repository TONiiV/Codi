import { CommandId, MessageId, Telescope, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as BoardChanges from "./BoardChanges.ts";
import * as DelegationService from "./DelegationService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";

type AnswerRef = Parameters<DelegationService.DelegationService["Service"]["answer"]>[0];
const NO_TOKENS = { input: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
const LATEST = { orderBy: ["started_at"], descending: true, limit: 1 } as const;

/**
 * Plan 2.5: a member's decision on a delegation's question goes back to the asking hop only, by
 * delegation id. Listens before it re-reads what waits, so no decision falls between the two.
 */
export const make = Effect.gen(function* () {
  const board = yield* BoardChanges.BoardChanges;
  const delegations = yield* DelegationService.DelegationService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const runs = yield* RunRecordService.RunRecordService;
  const db = yield* TelescopeDb.TelescopeDb;

  // The decision id names the command, so re-sending after a restart replays the same message.
  const sendTo = (decisionId: string) => (threadId: ThreadId, text: string) =>
    threads.getThreadShell(threadId).pipe(
      Effect.flatMap((thread) =>
        thread === null
          ? Effect.succeed(false)
          : threads
              .sendToThread({
                projectId: thread.projectId,
                commandId: CommandId.make(`telescope-answer:${decisionId}`),
                threadId,
                messageId: MessageId.make(`telescope-answer:${decisionId}`),
                text,
                attachments: [],
                mode: "queue",
                createdBy: "agent",
                creationSource: "server",
              })
              .pipe(
                Effect.as(true),
                Effect.catchTags({
                  ThreadManagementThreadArchivedError: () => Effect.succeed(false),
                  ThreadManagementThreadNotFoundError: () => Effect.succeed(false),
                }),
              ),
      ),
    );
  // The Worker's answered turn runs in a run like its first one, so its end wakes the Chief.
  const resume = Effect.fn("DelegationAnswers.resume")(function* (
    ref: AnswerRef,
    threadId: ThreadId,
    text: string,
  ) {
    const [last] = yield* db.select(
      ref.workspaceId,
      "runs",
      RunRecordService.decodeRuns,
      { thread_id: threadId },
      LATEST,
    );
    const [memberId, ...via] = last?.on_behalf_of_json ?? [];
    const codiMessageId = `telescope-answer:${ref.decisionId}`;
    const run =
      last === undefined || memberId === undefined
        ? undefined
        : yield* runs.startFor(ref.workspaceId, memberId, {
            agentId: last.agent_id,
            via,
            threadId,
            inputSnapshot: { ...last.input_snapshot_json, codiMessageId },
          });
    const sent = yield* sendTo(ref.decisionId)(threadId, text);
    if (!sent && run !== undefined)
      yield* runs.finish(
        { workspaceId: ref.workspaceId, runId: run.id },
        { outputSummary: "Not sent.", tokens: NO_TOKENS, resultLabels: [] },
      );
    return sent;
  });
  const deliver = (ref: {
    readonly workspaceId: Telescope.WorkspaceId;
    readonly decisionId: Telescope.DecisionId;
  }) =>
    delegations
      .answer(ref, (threadId, text) => resume(ref, threadId, text))
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("delivering a Telescope answer failed", { cause }),
        ),
      );

  const notices = yield* board.changes;
  return {
    /** Answers decided while no listener ran, such as before a restart. */
    catchUp: delegations.waiting.pipe(
      Effect.flatMap((refs) => Effect.forEach(refs, deliver, { discard: true })),
      Effect.catchCause((cause) =>
        Effect.logWarning("re-reading Telescope answers failed", { cause }),
      ),
    ),
    follow: Stream.runForEach(notices, (change) =>
      change.kind === "decision"
        ? deliver({
            workspaceId: change.workspaceId,
            decisionId: Telescope.DecisionId.make(change.id),
          })
        : Effect.void,
    ),
  };
});

export const layer = Layer.effectDiscard(
  Effect.flatMap(make, ({ catchUp, follow }) => Effect.forkScoped(Effect.andThen(catchUp, follow))),
);
