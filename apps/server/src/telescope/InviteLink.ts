import {
  AuthAccessWriteScope,
  type AuthEnvironmentScope,
  AuthTelescopeAdminScope,
  AuthTelescopeMemberScope,
  Telescope,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import type * as WorkspaceService from "./WorkspaceService.ts";

/** An invite never gives machine access (D147): its link pairs a device for Telescope only. */
const linkScopes = (role: Telescope.WorkspaceRole): ReadonlyArray<AuthEnvironmentScope> =>
  role === "admin"
    ? [AuthTelescopeMemberScope, AuthTelescopeAdminScope]
    : [AuthTelescopeMemberScope];
// The label names the invitation, so the link can be revoked when its code stops working.
const LINK_LABEL = "Telescope invite ";

export interface InviteServices {
  readonly workspaces: WorkspaceService.WorkspaceService["Service"];
  readonly auth: EnvironmentAuth.EnvironmentAuth["Service"];
}

/** The invitation code, plus a pairing link when this session may create pairing links. */
export const invite = Effect.fn("Telescope.InviteLink.invite")(function* (
  { workspaces, auth }: InviteServices,
  caller: WorkspaceService.SessionCaller & { readonly scopes: ReadonlyArray<AuthEnvironmentScope> },
  input: typeof Telescope.MemberInviteInput.Type,
) {
  const invitation = yield* workspaces.invite(caller, input);
  if (!caller.scopes.includes(AuthAccessWriteScope))
    return { ...invitation, pairingLink: { status: "owner_only" as const } };
  const expiresAt = DateTime.makeUnsafe(invitation.expiresAt);
  const pairingLink = yield* auth
    .createPairingLink({
      scopes: linkScopes(invitation.role),
      ttl: DateTime.distance(yield* DateTime.now, expiresAt),
      label: `${LINK_LABEL}${invitation.id}`,
    })
    .pipe(
      Effect.map((link): Telescope.InvitePairingLink => ({
        status: "issued",
        id: link.id,
        credential: link.credential,
        expiresAt: DateTime.formatIso(link.expiresAt),
      })),
      Effect.catchTags({
        ManagedPolicyRefusedError: () =>
          Effect.succeed<Telescope.InvitePairingLink>({ status: "policy_refused" }),
      }),
      Effect.mapError(
        (cause) =>
          new Telescope.WorkspaceError({
            reason: "storage",
            message: "The pairing link could not be created.",
            cause,
          }),
      ),
    );
  return { ...invitation, pairingLink };
});

/** Revokes every unused invite link whose code no longer works: voided, used or deleted. */
const revokeDeadLinks = Effect.fn("Telescope.InviteLink.revokeDeadLinks")(
  function* ({ workspaces, auth }: InviteServices) {
    // Links first: an invite landing between the reads then has a live code and no listed link.
    const links = yield* auth.listPairingLinks();
    const live = yield* workspaces.liveInvitationIds();
    const dead = links.filter(
      ({ label }) => label?.startsWith(LINK_LABEL) && !live.has(label.slice(LINK_LABEL.length)),
    );
    yield* Effect.forEach(dead, (link) => auth.revokePairingLink(link.id), { discard: true });
  },
  Effect.catchCause((cause) => Effect.logWarning("Telescope invite links were not revoked", cause)),
);

/** Runs a change that can void or use invitation codes, then revokes the links they carried. */
export const followCodes =
  (services: InviteServices) =>
  <A, E, R>(change: Effect.Effect<A, E, R>) =>
    Effect.tap(change, () => revokeDeadLinks(services));

const TELESCOPE_SCOPES: ReadonlySet<AuthEnvironmentScope> = new Set([
  AuthTelescopeMemberScope,
  AuthTelescopeAdminScope,
]);

/**
 * Ends the sessions of these devices that are now in no workspace, when they pair for Telescope
 * only: machine access the owner gave stays. Proof-key devices pair through T3 Connect with full
 * scopes, so a key that is not a session id has nothing to end.
 */
const endSessions = Effect.fn("Telescope.InviteLink.endSessions")(
  function* ({ workspaces, auth }: InviteServices, deviceKeys: ReadonlyArray<string>) {
    const gone = new Set(yield* workspaces.devicesWithoutWorkspace(deviceKeys));
    const ended = (yield* auth.listSessions()).filter(
      ({ sessionId, scopes }) =>
        gone.has(sessionId) && scopes.every((scope) => TELESCOPE_SCOPES.has(scope)),
    );
    yield* Effect.forEach(ended, ({ sessionId }) => auth.revokeSession(sessionId), {
      discard: true,
    });
  },
  Effect.catchCause((cause) => Effect.logWarning("Telescope sessions were not ended", cause)),
);

/** Revokes a member, the links of the codes that died with them, and their devices' sessions. */
export const revoke = Effect.fn("Telescope.InviteLink.revoke")(function* (
  services: InviteServices,
  caller: WorkspaceService.Caller,
  input: typeof Telescope.MemberRevokeInput.Type,
) {
  const { member, deviceKeys } = yield* followCodes(services)(
    services.workspaces.revoke(caller, input),
  );
  yield* endSessions(services, deviceKeys);
  return member;
});

/** Follows a workspace deletion as `revoke` follows a member's, for every device it linked. */
export const followDelete =
  (services: InviteServices) =>
  <E, R>(deletion: Effect.Effect<Telescope.WorkspaceDeleteManifest, E, R>) =>
    Effect.tap(followCodes(services)(deletion), ({ tables }) => {
      const links = tables.find(({ table }) => table === "telescope_member_sessions")?.ids ?? [];
      // Manifest ids are `member_id/device_key`; member ids hold no slash.
      return endSessions(
        services,
        links.map((id) => id.slice(id.indexOf("/") + 1)),
      );
    });
