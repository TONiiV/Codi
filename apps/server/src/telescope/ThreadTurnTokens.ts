import type { OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import * as RunRecordService from "./RunRecordService.ts";

const REMEMBERED_TURNS = 4096;
const TERMINAL = new Set(["completed", "failed", "interrupted", "cancelled"]);

/** Adds each finished provider turn's tokens to the Telescope runs attached to its thread. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const runs = yield* RunRecordService.RunRecordService;
    // A finished turn can be updated again; count each one once.
    const counted = new Set<string>();

    // Untraced: runs for every orchestration event; only finished turns reach the traced service.
    const handle = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
      if (event.type !== "provider-turn.updated") return;
      const turn = event.payload;
      const usage = turn.turnTokenUsage;
      if (!TERMINAL.has(turn.status) || usage === undefined || usage.localCommand === true) return;
      const tokens = {
        input: usage.inputTokens ?? 0,
        cachedInput: usage.cachedInputTokens ?? 0,
        cacheCreation: usage.cacheCreationTokens ?? 0,
        output: usage.outputTokens ?? 0,
      };
      if (tokens.input + tokens.cachedInput + tokens.cacheCreation + tokens.output === 0) return;
      if (counted.has(turn.id)) return;
      counted.add(turn.id);
      const oldest = counted.values().next();
      if (counted.size > REMEMBERED_TURNS && !oldest.done) counted.delete(oldest.value);
      yield* runs.recordThreadTurn(event.threadId, tokens);
    });

    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        handle(event).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("recording turn tokens on a Telescope run failed", { cause }),
          ),
        ),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Telescope turn token stream failed", { cause }),
        ),
      ),
    );
  }),
);
