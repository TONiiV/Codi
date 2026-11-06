import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = WorkspaceService.layer.pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
);

it.layer(layer)("WorkspaceService", (it) => {
  it.effect("invites a member who accepts, and enforces admin role and revocation", () =>
    Effect.gen(function* () {
      const service = yield* WorkspaceService.WorkspaceService;
      const company = yield* service.create("alice", {
        kind: "enterprise",
        name: "Acme",
        displayName: "Alice",
      });
      const personal = yield* service.create("alice", {
        kind: "personal",
        name: "Alice's desk",
        displayName: "Alice",
      });
      const invitation = yield* service.invite("alice", {
        workspaceId: company.id,
        role: "member",
      });
      yield* service.accept("bob", { code: invitation.code, displayName: "Bob" });

      const { members } = yield* service.members("alice", { workspaceId: company.id });
      assert.deepStrictEqual(members.map((m) => [m.subjectId, m.role]).toSorted(), [
        ["alice", "admin"],
        ["bob", "member"],
      ]);
      const listed = yield* service.list("alice", {});
      assert.deepStrictEqual(
        listed.workspaces.map((w) => w.id).toSorted(),
        [company.id, personal.id].toSorted(),
      );
      assert.deepStrictEqual((yield* service.list("bob", {})).workspaces, [company]);

      const reused = yield* service
        .accept("carol", { code: invitation.code, displayName: "Carol" })
        .pipe(Effect.flip);
      assert.strictEqual(reused._tag === "TelescopeWorkspaceError" && reused.reason, "conflict");

      const promote = yield* service
        .setRole("bob", { workspaceId: company.id, subjectId: "bob", role: "admin" })
        .pipe(Effect.flip);
      assert.strictEqual(promote._tag === "TelescopeWorkspaceError" && promote.reason, "forbidden");

      yield* service.revoke("alice", { workspaceId: company.id, subjectId: "bob" });
      const revoked = yield* service.members("bob", { workspaceId: company.id }).pipe(Effect.flip);
      assert.strictEqual(revoked._tag === "TelescopeWorkspaceError" && revoked.reason, "forbidden");
      assert.deepStrictEqual((yield* service.list("bob", {})).workspaces, []);
    }),
  );
});
