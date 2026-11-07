import { Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { forkParked } from "../serverActivation.ts";
import { stoppedAgents } from "./AgentRuntime.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";

const RENEW_EVERY = "1 minute";
const decodeOpenRuns = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ agent_id: Telescope.AgentId })),
);

/** D59: a running agent with an open run keeps its leases; otherwise they lapse on their own. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* TelescopeDb.TelescopeDb;
    const board = yield* TaskBoardService.TaskBoardService;
    const renew = Effect.fn("AgentLeases.renew")(function* () {
      for (const workspaceId of yield* db.allWorkspaceIds) {
        const open = yield* db.select(workspaceId, "runs", decodeOpenRuns, { finished_at: null });
        if (open.length === 0) continue;
        const stopped = yield* stoppedAgents(db, workspaceId);
        const running = open.map((run) => run.agent_id).filter((id) => !stopped.has(id));
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
