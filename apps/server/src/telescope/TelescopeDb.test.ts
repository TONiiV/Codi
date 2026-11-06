import { assert, it } from "@effect/vitest";
import { Telescope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

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
      // A row naming another workspace is still written into the caller's.
      yield* db.insert(wsA, "members", { ...member("cal"), workspace_id: wsB });

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

      yield* db.update(wsA, "members", { display_name: "renamed", workspace_id: wsB }, {});
      yield* db.remove(wsA, "members", { subject_id: "bea" });
      assert.deepStrictEqual(names(yield* db.select(wsB, "members", decodeNames)), ["ws-b/bea"]);
      assert.deepStrictEqual(names(yield* db.select(wsA, "members", decodeNames)), [
        "ws-a/renamed",
        "ws-a/renamed",
      ]);
    }),
  );
});
