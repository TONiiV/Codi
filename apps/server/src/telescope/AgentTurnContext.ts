import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as TurnPreamble from "../orchestration-v2/TurnPreamble.ts";
import * as AgentInstructions from "./AgentInstructions.ts";
import { servesRun } from "./AgentRuntime.ts";
import { runSnapshot } from "./AgentThreadRuns.ts";
import * as AgentService from "./AgentService.ts";
import * as ContextAssembler from "./ContextAssembler.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";

// No per-model window reaches the server here; the blocks stay within their token ceilings.
const WINDOW_TOKENS = 200_000;

/**
 * Every turn on an agent's resident thread, from a wake or typed by its member, runs with the
 * agent's role and the context assembled for the run serving it.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* TelescopeDb.TelescopeDb;
    const agents = yield* AgentService.AgentService;
    const runs = yield* RunRecordService.RunRecordService;
    const assembler = yield* ContextAssembler.ContextAssembler;
    const preamble = yield* TurnPreamble.TurnPreamble;

    const forTurn = Effect.fn("AgentTurnContext.forTurn")(function* (
      turn: TurnPreamble.TurnPreambleInput,
    ) {
      const owner = yield* db.agentThread(turn.threadId);
      if (owner === undefined) return "";
      const { workspaceId } = owner;
      const { agent } = yield* agents.powersOf(workspaceId, owner.agentId);
      const run = yield* runs.startFor(workspaceId, owner.ownerSubjectId, {
        agentId: agent.id,
        threadId: turn.threadId,
        inputSnapshot: runSnapshot(turn.modelSelection, { codiMessageId: turn.messageId }),
      });
      if (!(yield* servesRun(db, workspaceId))(run)) return "";
      const [memberId = owner.ownerSubjectId] = run.onBehalfOf;
      const context = yield* assembler.assemble({
        caller: { runId: run.id, workspaceId, memberId },
        run: { workspaceId, runId: run.id },
        windowTokens: WINDOW_TOKENS,
        usedTokens: 0,
        thread: [],
      });
      return AgentInstructions.renderPreamble(agent, {
        role: turn.freshConversation,
        contextFile: context.path,
      });
    });

    yield* preamble.contribute((turn) =>
      forTurn(turn).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("assembling a Telescope agent's turn context failed", { cause }).pipe(
            Effect.as(""),
          ),
        ),
      ),
    );
  }),
);
