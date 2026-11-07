import { Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { forkParked } from "../serverActivation.ts";
import { servesRun } from "./AgentRuntime.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";

const RENEW_EVERY = "1 minute";
const decodeOpenRuns = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      agent_id: Telescope.AgentId,
      on_behalf_of_json: Schema.fromJsonString(Telescope.OnBehalfOf),
    }),
  ),
);

/** D59: an agent with an open run the gateway serves keeps its leases; otherwise they lapse. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* TelescopeDb.TelescopeDb;
    const board = yield* TaskBoardService.TaskBoardService;
    const renew = Effect.fn("AgentLeases.renew")(function* () {
      for (const workspaceId of yield* db.allWorkspaceIds) {
        const open = yield* db.select(workspaceId, "runs", decodeOpenRuns, { finished_at: null });
        if (open.length === 0) continue;
        const serves = yield* servesRun(db, workspaceId);
        const running = open.flatMap((run) =>
          serves({ agentId: run.agent_id, onBehalfOf: run.on_behalf_of_json })
            ? [run.agent_id]
            : [],
        );
        if (running.length > 0) yield* board.renewHeldBy(workspaceId, running);
      }
    });
    const pass = renew().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("renewing running agents' leases failed", { cause }),
      ),
    );
    yield* forkParked(Effect.sleep(RENEW_EVERY).pipe(Effect.andThen(pass), Effect.forever));
  }),
);
