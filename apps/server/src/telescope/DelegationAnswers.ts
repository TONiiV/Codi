import { CommandId, MessageId, Telescope, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as BoardChanges from "./BoardChanges.ts";
import * as DelegationService from "./DelegationService.ts";

/**
 * Plan 2.5: a member's decision on a delegation's question goes back to the asking hop only, by
 * delegation id. Listens before it re-reads what waits, so no decision falls between the two.
 */
export const make = Effect.gen(function* () {
  const board = yield* BoardChanges.BoardChanges;
  const delegations = yield* DelegationService.DelegationService;
  const threads = yield* ThreadManagementService.ThreadManagementService;

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
  const deliver = (ref: {
    readonly workspaceId: Telescope.WorkspaceId;
    readonly decisionId: Telescope.DecisionId;
  }) =>
    delegations
      .answer(ref, sendTo(ref.decisionId))
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
