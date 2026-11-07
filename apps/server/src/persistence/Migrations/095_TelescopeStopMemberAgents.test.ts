import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
const at = "2026-01-01T00:00:00.000Z";

layer("095_TelescopeStopMemberAgents", (it) => {
  it.effect("stops other members' personal agents and leaves the owner's and company ones", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 94 });
      const agents = [
        ["owner-assistant", "owner"],
        ["company-main", null],
        ["bea-assistant", "member-bea"],
        ["bea-chief", "member-bea"],
      ] as const;
      for (const [agentId, owner] of agents)
        yield* sql`INSERT INTO telescope_agents ${sql.insert({
          agent_id: agentId,
          workspace_id: "ws-1",
          owner_subject_id: owner,
          kind: owner === null ? "company_main" : "chief_of_staff",
          name: agentId,
          standing_powers_json: "{}",
          exposure: "hidden",
          sync_with_board: 0,
          dispatch_mode: "inbox",
          channels_json: "[]",
          created_at: at,
          updated_at: at,
        })}`;
      yield* sql`INSERT INTO telescope_kill_switches ${sql.insert({
        workspace_id: "ws-1",
        agent_id: "bea-chief",
        state: "running",
        by_subject_id: "owner",
        at,
      })}`;

      yield* runMigrations({ toMigrationInclusive: 95 });
      const stops = yield* sql<{ readonly agent_id: string; readonly state: string }>`
        SELECT agent_id, state FROM telescope_kill_switches ORDER BY agent_id
      `;
      assert.deepStrictEqual(
        stops.map((row) => [row.agent_id, row.state]),
        [
          ["bea-assistant", "terminated"],
          ["bea-chief", "terminated"],
        ],
      );
      assert.strictEqual(
        (yield* sql<{ readonly n: number }>`SELECT count(*) AS n FROM telescope_agents`)[0]?.n,
        4,
        "nothing is deleted",
      );
    }),
  );
});
