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
    const live = yield* workspaces.liveInvitationIds();
    const dead = (yield* auth.listPairingLinks()).filter(
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
