import { assert, it } from "@effect/vitest";
import { Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TelescopeDb from "./TelescopeDb.ts";

const layer = TelescopeDb.layer.pipe(
  Layer.provideMerge(
    Layer.effectDiscard(runMigrations()).pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
  ),
);

const MemberName = Schema.Struct({ workspace_id: Schema.String, display_name: Schema.String });
const decodeNames = Schema.decodeUnknownEffect(Schema.Array(MemberName));
const wsA = Telescope.WorkspaceId.make("ws-a");
const wsB = Telescope.WorkspaceId.make("ws-b");
const wsC = Telescope.WorkspaceId.make("ws-c");
const member = (name: string) => ({
  subject_id: name,
  display_name: name,
  role: "member",
  joined_at: "2026-11-06T00:00:00.000Z",
});

it.layer(layer)("TelescopeDb", (it) => {
  it.effect("binds every repository statement to one workspace", () =>
    Effect.gen(function* () {
      const db = yield* TelescopeDb.TelescopeDb;
      yield* db.insert(wsA, "members", member("ann"));
      yield* db.insert(wsB, "members", member("bea"));
      yield* db.insert(wsA, "members", member("cal"));

      const names = (rows: ReadonlyArray<typeof MemberName.Type>) =>
        rows.map((row) => `${row.workspace_id}/${row.display_name}`).toSorted();
      assert.deepStrictEqual(names(yield* db.select(wsA, "members", decodeNames)), [
        "ws-a/ann",
        "ws-a/cal",
      ]);
      assert.deepStrictEqual(
        yield* db.select(wsA, "members", decodeNames, { workspace_id: wsB }),
        [],
      );

      yield* db.update(wsA, "members", { display_name: "renamed" }, {});
      yield* db.remove(wsA, "members", { subject_id: "bea" });
      assert.deepStrictEqual(names(yield* db.select(wsB, "members", decodeNames)), ["ws-b/bea"]);
      assert.deepStrictEqual(names(yield* db.select(wsA, "members", decodeNames)), [
        "ws-a/renamed",
        "ws-a/renamed",
      ]);
    }),
  );

  it.effect("refuses writes that name workspace_id in any case, and non-canonical columns", () =>
    Effect.gen(function* () {
      const db = yield* TelescopeDb.TelescopeDb;
      yield* db.insert(wsC, "members", member("dan"));
      const refused = [
        db.insert(wsC, "members", { ...member("eve"), WORKSPACE_ID: wsB }),
        db.insert(wsC, "members", { ...member("eve"), workspace_id: wsB }),
        db.update(wsC, "members", { WORKSPACE_ID: wsB }, { subject_id: "dan" }),
        db.update(wsC, "members", { Workspace_Id: wsB }, { subject_id: "dan" }),
        db.update(wsC, "members", { display_name: "x" }, { "subject_id = subject_id OR 1": 1 }),
        db.select(wsC, "members", decodeNames, { Subject_Id: "dan" }),
        db.remove(wsC, "members", { "subject id": "dan" }),
      ];
      for (const attempt of refused) {
        const error = yield* Effect.flip(attempt);
        assert.strictEqual(error._tag, "PersistenceSqlError");
      }
      const where = { subject_id: "dan" };
      assert.deepStrictEqual(yield* db.select(wsB, "members", decodeNames, where), []);
      assert.deepStrictEqual(yield* db.select(wsC, "members", decodeNames, where), [
        { workspace_id: "ws-c", display_name: "dan" },
      ]);
      assert.deepStrictEqual(
        yield* db.select(wsC, "members", decodeNames, { subject_id: "eve" }),
        [],
      );
    }),
  );

  it.effect("keeps the memory search index in step with memory text", () =>
    Effect.gen(function* () {
      const db = yield* TelescopeDb.TelescopeDb;
      const sql = yield* SqlClient.SqlClient;
      const indexed = (needle: string) =>
        sql<{ readonly memory_id: string; readonly workspace_id: string }>`
          SELECT memory_id, workspace_id FROM telescope_memories_fts
          WHERE telescope_memories_fts MATCH ${needle}
        `;
      yield* db.insert(wsA, "memories", {
        memory_id: "m1",
        agent_id: "agent",
        scope: "agent",
        layer: "semantic",
        level: "fact",
        kind: "fact",
        text: "prefers tabs",
        source_json: "{}",
        valid_from: "2026-11-06T00:00:00.000Z",
      });
      assert.deepStrictEqual(yield* indexed("tabs"), [{ memory_id: "m1", workspace_id: "ws-a" }]);

      yield* db.update(wsA, "memories", { text: "prefers spaces" }, { memory_id: "m1" });
      assert.deepStrictEqual(yield* indexed("tabs"), []);
      assert.strictEqual((yield* indexed("spaces")).length, 1);

      yield* db.remove(wsA, "memories", { memory_id: "m1" });
      assert.deepStrictEqual(yield* indexed("spaces"), []);
    }),
  );
});
