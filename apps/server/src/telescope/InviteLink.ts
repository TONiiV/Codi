import {
  AuthAccessWriteScope,
  type AuthEnvironmentScope,
  AuthTelescopeMemberScope,
  Telescope,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import type * as WorkspaceService from "./WorkspaceService.ts";

/** An invite never gives machine access (D147): its link pairs a device for Telescope only. */
const INVITE_LINK_SCOPES: ReadonlyArray<AuthEnvironmentScope> = [AuthTelescopeMemberScope];

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
      scopes: INVITE_LINK_SCOPES,
      ttl: DateTime.distance(yield* DateTime.now, expiresAt),
      label: "Telescope invite",
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
