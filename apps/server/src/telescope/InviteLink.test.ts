import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthEnvironmentScopes,
  AuthSessionId,
  AuthStandardClientScopes,
  AuthTelescopeAdminScope,
  AuthTelescopeMemberScope,
  Telescope,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as RpcTest from "effect/rpc/RpcTest";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as InviteLink from "./InviteLink.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(WorkspaceService.layer, EnvironmentAuth.layer).pipe(
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provide(Layer.merge(ProjectStore.layer, ServerSecretStore.layer)),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-invite-link-test-" })),
  Layer.provideMerge(Layer.mergeAll(database, NodeCrypto.layer, NodeServices.layer)),
);

const probeOnly = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (tag): tag is Exclude<keyof typeof RpcAuthorization.RPC_REQUIRED_SCOPES, "server.probe"> =>
      tag !== WS_METHODS.serverProbe,
  ),
);
const decodeScopes = Schema.decodeUnknownSync(AuthEnvironmentScopes);

it.layer(layer)("Telescope invite links", (it) => {
  it.effect("pair a device for Telescope only, and only from a session that may pair", () =>
    Effect.gen(function* () {
      const workspaces = yield* WorkspaceService.WorkspaceService;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const owner: Parameters<typeof InviteLink.invite>[1] = {
        sessionId: AuthSessionId.make("session-owner"),
        subject: "desktop-bootstrap",
        scopes: AuthStandardClientScopes,
      };
      const { id: workspaceId } = yield* workspaces.create(owner, {
        kind: "enterprise",
        name: "Acme",
        displayName: "Olive",
      });
      const invite = (caller: typeof owner, role: Telescope.WorkspaceRole = "viewer") =>
        InviteLink.invite({ workspaces, auth }, caller, { workspaceId, role });
      const grantOf = (link: Telescope.InvitePairingLink) =>
        auth
          .listPairingLinks()
          .pipe(
            Effect.map((links) =>
              links.find((grant) => link.status === "issued" && grant.id === link.id),
            ),
          );

      for (const [role, scopes] of [
        ["member", [AuthTelescopeMemberScope]],
        ["project_lead", [AuthTelescopeMemberScope]],
        ["admin", [AuthTelescopeMemberScope, AuthTelescopeAdminScope]],
      ] as const) {
        const issued = yield* invite(owner, role);
        assert.deepStrictEqual((yield* grantOf(issued.pairingLink))?.permissions, scopes, role);
      }

      const { pairingLink, role } = yield* invite(owner);
      assert.strictEqual(role, "viewer");
      assert.strictEqual(pairingLink.status, "issued");
      if (pairingLink.status !== "issued") return;
      assert.deepStrictEqual((yield* grantOf(pairingLink))?.permissions, [
        AuthTelescopeMemberScope,
      ]);

      const exchanged = yield* auth.exchangeBootstrapCredentialForAccessToken(
        pairingLink.credential,
        undefined,
        { deviceType: "desktop" },
      );
      const scopes = decodeScopes(exchanged.scope.split(" "));
      assert.deepStrictEqual(scopes, [AuthTelescopeMemberScope]);
      const client = yield* RpcTest.makeClient(probeOnly).pipe(
        Effect.provide(
          Layer.merge(
            probeOnly.toLayerHandler(WS_METHODS.serverProbe, () => Effect.succeed({})),
            RpcAuthorization.layer(scopes),
          ),
        ),
      );
      assert.include(yield* client[WS_METHODS.serverProbe]({}).pipe(Effect.flip), {
        _tag: "EnvironmentAuthorizationError",
        requiredPermission: "orchestration:read",
      });

      // A session without access:write cannot pair devices; the owner creates the link.
      const before = (yield* auth.listPairingLinks()).length;
      const admin = { ...owner, scopes: [AuthTelescopeMemberScope, AuthTelescopeAdminScope] };
      assert.deepStrictEqual((yield* invite(admin)).pairingLink, { status: "owner_only" });
      assert.strictEqual((yield* auth.listPairingLinks()).length, before);

      // The link stops working with its code: here its issuer stops being an admin.
      const follow = InviteLink.followCodes({ workspaces, auth });
      const device = { ...owner, sessionId: AuthSessionId.make("session-ada"), subject: "ada" };
      const { code } = yield* invite(owner, "admin");
      const ada = yield* follow(workspaces.accept(device, { code, displayName: "Ada" }));
      const voided = (yield* invite(device)).pairingLink;
      assert.strictEqual(voided.status, "issued");
      if (voided.status !== "issued") return;
      const demote = { workspaceId, subjectId: ada.subjectId, role: "member" } as const;
      yield* follow(workspaces.setRole(owner, demote));
      const refused = yield* auth
        .exchangeBootstrapCredentialForAccessToken(voided.credential, undefined, {
          deviceType: "desktop",
        })
        .pipe(Effect.flip);
      assert.strictEqual(refused._tag, "ServerAuthInvalidCredentialError");
    }).pipe(Effect.scoped),
  );
});
