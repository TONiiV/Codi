import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type AuthEnvironmentScope,
  AuthEnvironmentScopes,
  AuthSessionId,
  AuthStandardClientScopes,
  AuthTelescopeAdminScope,
  AuthTelescopeMemberScope,
  Telescope,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
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
import * as WorkspaceDataService from "./WorkspaceDataService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = Layer.mergeAll(
  WorkspaceService.layer,
  WorkspaceDataService.layer,
  EnvironmentAuth.layer,
).pipe(
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
      yield* InviteLink.setRole({ workspaces, auth }, owner, demote);
      const refused = yield* auth
        .exchangeBootstrapCredentialForAccessToken(voided.credential, undefined, {
          deviceType: "desktop",
        })
        .pipe(Effect.flip);
      assert.strictEqual(refused._tag, "ServerAuthInvalidCredentialError");

      // An invite issued between the sweep's two reads keeps its link.
      const raced = yield* Ref.make<ReadonlyArray<Telescope.InvitePairingLink>>([]);
      const racing = {
        ...workspaces,
        liveInvitationIds: () =>
          workspaces
            .liveInvitationIds()
            .pipe(
              Effect.tap(() =>
                invite(owner).pipe(
                  Effect.flatMap(({ pairingLink }) =>
                    Ref.update(raced, (all) => [...all, pairingLink]),
                  ),
                ),
              ),
            ),
      };
      yield* InviteLink.followCodes({ workspaces: racing, auth })(Effect.void);
      const kept = yield* Effect.forEach(yield* Ref.get(raced), grantOf);
      assert.strictEqual(kept.length, 1);
      assert.isDefined(kept[0]);
    }).pipe(Effect.scoped),
  );

  it.effect("end the Telescope-only sessions of devices a change leaves in no workspace", () =>
    Effect.gen(function* () {
      const workspaces = yield* WorkspaceService.WorkspaceService;
      const data = yield* WorkspaceDataService.WorkspaceDataService;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const services = { workspaces, auth };
      const owner = {
        sessionId: AuthSessionId.make("session-owner"),
        subject: "desktop-bootstrap",
        scopes: AuthStandardClientScopes,
      };
      const create = (name: string) =>
        workspaces
          .create(owner, { kind: "enterprise", name, displayName: "Olive" })
          .pipe(Effect.map(({ id }) => id));
      const acme = yield* create("Acme");
      const beta = yield* create("Beta");
      const gamma = yield* create("Gamma");
      const inviteTo = (workspaceId: Telescope.WorkspaceId) =>
        InviteLink.invite(services, owner, { workspaceId, role: "member" });
      const linkOf = ({ pairingLink }: { readonly pairingLink: Telescope.InvitePairingLink }) =>
        pairingLink.status === "issued" ? pairingLink.credential : assert.fail(pairingLink.status);
      const bearer = (token: string) =>
        ({ cookies: {}, headers: { authorization: `Bearer ${token}` } }) as unknown as Parameters<
          typeof auth.authenticateHttpRequest
        >[0];
      // Pairs a device with `credential`, then joins a workspace with each code.
      const device = Effect.fn(function* (credential: string, codes: ReadonlyArray<string>) {
        const { access_token: token } = yield* auth.exchangeBootstrapCredentialForAccessToken(
          credential,
          undefined,
          { deviceType: "desktop" },
        );
        const session = yield* auth.authenticateHttpRequest(bearer(token));
        const members = yield* Effect.forEach(codes, (code) =>
          workspaces.accept(session, { code, displayName: "Device" }),
        );
        return { token, members };
      });
      const sessionsOf = (devices: ReadonlyArray<{ readonly token: string }>) =>
        Effect.forEach(devices, ({ token }) =>
          auth
            .authenticateHttpRequest(bearer(token))
            .pipe(Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "live" })),
        );

      const ada = yield* inviteTo(acme);
      const adaDevice = yield* device(linkOf(ada), [ada.code]);
      const bo = yield* inviteTo(acme);
      const boDevice = yield* device(linkOf(bo), [bo.code, (yield* inviteTo(beta)).code]);
      // The owner paired this one for the whole machine; Telescope never takes that away.
      const full = yield* auth.createPairingLink({ scopes: AuthStandardClientScopes });
      const cyDevice = yield* device(full.credential, [(yield* inviteTo(acme)).code]);
      const dee = yield* inviteTo(gamma);
      const deeDevice = yield* device(linkOf(dee), [dee.code]);
      // A proof-key device is linked by its key, which no revoke reaches: Telescope-only is refused.
      const withKey = (credential: string, scopes?: ReadonlyArray<AuthEnvironmentScope>) =>
        auth
          .exchangeBootstrapCredentialForAccessToken(
            credential,
            scopes,
            { deviceType: "desktop" },
            { proofKeyThumbprint: "eve-proof-key" },
          )
          .pipe(Effect.match({ onFailure: (error) => error._tag, onSuccess: (t) => t.token_type }));
      const eve = yield* inviteTo(acme);
      const machine = yield* auth.createPairingLink({ scopes: AuthStandardClientScopes });
      assert.deepStrictEqual(
        [
          yield* withKey(linkOf(eve)),
          yield* withKey(machine.credential, [AuthTelescopeMemberScope]),
          yield* withKey(machine.credential),
        ],
        ["ServerAuthScopeNotGrantedError", "ServerAuthScopeNotGrantedError", "DPoP"],
      );
      // The refusal left the invite link unspent.
      const eveDevice = yield* device(linkOf(eve), [eve.code]);

      for (const { members } of [adaDevice, boDevice, cyDevice, eveDevice])
        yield* InviteLink.revoke(services, owner, {
          workspaceId: acme,
          subjectId: members[0]!.subjectId,
        });
      assert.deepStrictEqual(
        yield* sessionsOf([adaDevice, boDevice, cyDevice, deeDevice, eveDevice]),
        [
          "ServerAuthInvalidCredentialError",
          "live",
          "live",
          "live",
          "ServerAuthInvalidCredentialError",
        ],
      );

      yield* InviteLink.revoke(services, owner, {
        workspaceId: beta,
        subjectId: boDevice.members[1]!.subjectId,
      });
      yield* InviteLink.deleteWorkspace({ ...services, data }, owner, {
        workspaceId: gamma,
        confirmName: "Gamma",
      });
      assert.deepStrictEqual(yield* sessionsOf([boDevice, cyDevice, deeDevice]), [
        "ServerAuthInvalidCredentialError",
        "live",
        "ServerAuthInvalidCredentialError",
      ]);

      // A client that disconnects once the revoke has committed still ends the session.
      const fay = yield* inviteTo(acme);
      const fayDevice = yield* device(linkOf(fay), [fay.code]);
      const entered = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const gated = {
        ...workspaces,
        devicesWithoutWorkspace: (keys: ReadonlyArray<string>) =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.andThen(workspaces.devicesWithoutWorkspace(keys)),
          ),
      };
      const revoking = yield* InviteLink.revoke({ workspaces: gated, auth }, owner, {
        workspaceId: acme,
        subjectId: fayDevice.members[0]!.subjectId,
      }).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      revoking.interruptUnsafe();
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.await(revoking);
      assert.deepStrictEqual(yield* sessionsOf([fayDevice]), ["ServerAuthInvalidCredentialError"]);
    }),
  );
});
