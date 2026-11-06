import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = WorkspaceService.layer.pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
);

const session = (name: string) => AuthSessionId.make(`session-${name}`);
const reasonOf = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => ("reason" in error ? error.reason : error._tag)),
  );

it.layer(layer)("WorkspaceService", (it) => {
  it.effect("members are auth sessions linked to member ids, with roles and revocation", () =>
    Effect.gen(function* () {
      const service = yield* WorkspaceService.WorkspaceService;
      const [a, b, c] = [session("a"), session("b"), session("c")];
      const company = yield* service.create(a, {
        kind: "enterprise",
        name: "Acme",
        displayName: "Alice",
      });
      const personal = yield* service.create(a, {
        kind: "personal",
        name: "Alice's desk",
        displayName: "Alice",
      });
      const workspaceId = company.id;
      const invitation = yield* service.invite(a, { workspaceId, role: "member" });
      const bob = yield* service.accept(b, { code: invitation.code, displayName: "Bob" });
      const { self: alice } = yield* service.get(a, { workspaceId });

      const { members } = yield* service.members(b, { workspaceId });
      assert.deepStrictEqual(members.map((m) => [m.displayName, m.role]).toSorted(), [
        ["Alice", "admin"],
        ["Bob", "member"],
      ]);
      assert.notStrictEqual(alice.subjectId, bob.subjectId);
      assert.strictEqual(company.createdBy, alice.subjectId);
      assert.strictEqual(invitation.invitedBy, alice.subjectId);
      assert.deepStrictEqual((yield* service.get(b, { workspaceId })).self, bob);
      assert.deepStrictEqual(
        (yield* service.list(a, {})).workspaces.map((w) => w.id).toSorted(),
        [company.id, personal.id].toSorted(),
      );
      assert.deepStrictEqual((yield* service.list(b, {})).workspaces, [company]);

      assert.deepStrictEqual((yield* service.list(c, {})).workspaces, []);
      assert.strictEqual(yield* reasonOf(service.get(c, { workspaceId })), "forbidden");
      assert.strictEqual(yield* reasonOf(service.members(c, { workspaceId })), "forbidden");
      assert.strictEqual(yield* reasonOf(service.bindings(c, { workspaceId })), "forbidden");

      const second = yield* service.invite(a, { workspaceId, role: "member" });
      assert.strictEqual(
        yield* reasonOf(service.accept(b, { code: second.code, displayName: "Bob again" })),
        "conflict",
      );
      assert.strictEqual(
        yield* reasonOf(service.accept(c, { code: invitation.code, displayName: "Carol" })),
        "conflict",
      );

      const binding = {
        workspaceId,
        environmentId: EnvironmentId.make("env-1"),
        projectId: ProjectId.make("project-1"),
      };
      const { environmentId, projectId } = binding;
      assert.strictEqual(
        yield* reasonOf(
          service.setRole(b, { workspaceId, subjectId: bob.subjectId, role: "admin" }),
        ),
        "forbidden",
      );
      assert.strictEqual(yield* reasonOf(service.bind(b, binding)), "forbidden");
      assert.strictEqual(
        yield* reasonOf(service.bind(a, { ...binding, leadSubjectId: "nobody" })),
        "not_found",
      );
      yield* service.bind(a, { ...binding, leadSubjectId: bob.subjectId });
      assert.deepStrictEqual((yield* service.bindings(b, { workspaceId })).bindings, [
        { ...binding, leadSubjectId: bob.subjectId },
      ]);
      assert.strictEqual(
        yield* reasonOf(service.unbind(b, { workspaceId, environmentId, projectId })),
        "forbidden",
      );
      yield* service.unbind(a, { workspaceId, environmentId, projectId });
      assert.deepStrictEqual((yield* service.bindings(a, { workspaceId })).bindings, []);

      assert.strictEqual(
        yield* reasonOf(
          service.setRole(a, { workspaceId, subjectId: alice.subjectId, role: "member" }),
        ),
        "conflict",
      );
      assert.strictEqual(
        yield* reasonOf(service.revoke(a, { workspaceId, subjectId: alice.subjectId })),
        "conflict",
      );

      const shortLived = yield* service.invite(a, {
        workspaceId,
        role: "member",
        expiresInSeconds: 60,
      });
      yield* TestClock.adjust("2 minutes");
      assert.strictEqual(
        yield* reasonOf(service.accept(c, { code: shortLived.code, displayName: "Carol" })),
        "expired",
      );

      yield* service.revoke(a, { workspaceId, subjectId: bob.subjectId });
      assert.strictEqual(yield* reasonOf(service.members(b, { workspaceId })), "forbidden");
      assert.deepStrictEqual((yield* service.list(b, {})).workspaces, []);
      const fresh = yield* service.invite(a, { workspaceId, role: "admin" });
      assert.strictEqual(
        yield* reasonOf(service.accept(b, { code: fresh.code, displayName: "Bob" })),
        "forbidden",
      );
    }),
  );

  it.effect("codes die with their issuer's admin role, and link codes add a device", () =>
    Effect.gen(function* () {
      const service = yield* WorkspaceService.WorkspaceService;
      const [a, m, n, n2, x] = [
        session("admin"),
        session("mallory"),
        session("nina"),
        session("nina-phone"),
        session("xavier"),
      ];
      const { id: workspaceId } = yield* service.create(a, {
        kind: "enterprise",
        name: "Acme",
        displayName: "Alice",
      });
      const join = (who: AuthSessionId, role: "admin" | "member", displayName: string) =>
        service
          .invite(a, { workspaceId, role })
          .pipe(Effect.flatMap(({ code }) => service.accept(who, { code, displayName })));

      const mallory = yield* join(m, "admin", "Mallory");
      const stashed = yield* service.invite(m, { workspaceId, role: "admin" });
      yield* service.revoke(a, { workspaceId, subjectId: mallory.subjectId });
      for (const who of [m, x])
        assert.strictEqual(
          yield* reasonOf(service.accept(who, { code: stashed.code, displayName: "Mallory" })),
          "expired",
        );

      const nina = yield* join(n, "admin", "Nina");
      const leftover = yield* service.invite(n, { workspaceId, role: "member" });
      yield* service.setRole(a, { workspaceId, subjectId: nina.subjectId, role: "member" });
      assert.strictEqual(
        yield* reasonOf(service.accept(x, { code: leftover.code, displayName: "Xavier" })),
        "expired",
      );

      assert.strictEqual(
        yield* reasonOf(service.linkCode(n, { workspaceId, subjectId: nina.subjectId })),
        "forbidden",
      );
      const link = yield* service.linkCode(a, { workspaceId, subjectId: nina.subjectId });
      assert.strictEqual(link.forSubjectId, nina.subjectId);
      const linked = yield* service.accept(n2, { code: link.code, displayName: "ignored" });
      assert.strictEqual(linked.subjectId, nina.subjectId);
      assert.deepStrictEqual((yield* service.get(n2, { workspaceId })).self.displayName, "Nina");
      const { members } = yield* service.members(n2, { workspaceId });
      assert.deepStrictEqual(members.map((member) => member.displayName).toSorted(), [
        "Alice",
        "Mallory",
        "Nina",
      ]);
    }),
  );
});
