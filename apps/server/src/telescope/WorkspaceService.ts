import { type AuthSessionId, EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as TelescopeDb from "./TelescopeDb.ts";

const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

const WorkspaceRow = Schema.Struct({
  workspace_id: Telescope.WorkspaceId,
  kind: Telescope.WorkspaceKind,
  name: Schema.String,
  created_at: Schema.String,
  created_by: Schema.String,
});
const MemberRow = Schema.Struct({
  workspace_id: Telescope.WorkspaceId,
  subject_id: Schema.String,
  display_name: Schema.String,
  role: Telescope.WorkspaceRole,
  joined_at: Schema.String,
  revoked_at: Schema.NullOr(Schema.String),
});
const SessionLinkRow = Schema.Struct({ member_id: Schema.String });
const InvitationRow = Schema.Struct({
  invitation_id: Telescope.InvitationId,
  workspace_id: Telescope.WorkspaceId,
  role: Telescope.WorkspaceRole,
  invited_by: Schema.String,
  for_member_id: Schema.NullOr(Schema.String),
  expires_at: Schema.String,
  accepted_at: Schema.NullOr(Schema.String),
});
const BindingRow = Schema.Struct({
  workspace_id: Telescope.WorkspaceId,
  environment_id: EnvironmentId,
  project_id: ProjectId,
  lead_subject_id: Schema.NullOr(Schema.String),
});

const decodeWorkspaces = Schema.decodeUnknownEffect(Schema.Array(WorkspaceRow));
const decodeMembers = Schema.decodeUnknownEffect(Schema.Array(MemberRow));
const decodeSessionLinks = Schema.decodeUnknownEffect(Schema.Array(SessionLinkRow));
const decodeInvitations = Schema.decodeUnknownEffect(Schema.Array(InvitationRow));
const decodeBindings = Schema.decodeUnknownEffect(Schema.Array(BindingRow));

const toWorkspace = (row: typeof WorkspaceRow.Type): Telescope.Workspace => ({
  id: row.workspace_id,
  kind: row.kind,
  name: row.name,
  createdAt: row.created_at,
  createdBy: row.created_by,
});
const toMember = (row: typeof MemberRow.Type): Telescope.Member => ({
  workspaceId: row.workspace_id,
  subjectId: row.subject_id,
  displayName: row.display_name,
  role: row.role,
  joinedAt: row.joined_at,
  ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
});
const toBinding = (row: typeof BindingRow.Type): Telescope.ProjectBinding => ({
  workspaceId: row.workspace_id,
  environmentId: row.environment_id,
  projectId: row.project_id,
  ...(row.lead_subject_id === null ? {} : { leadSubjectId: row.lead_subject_id }),
});

const fail = (reason: Telescope.WorkspaceError["reason"], message: string) =>
  Effect.fail(new Telescope.WorkspaceError({ reason, message }));

type Caller = AuthSessionId;
type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;
type Rpcs = (typeof Telescope.WorkspaceRpcs)[number];
type In<Tag extends Rpcs["_tag"]> = Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>;
type Method<Tag extends Rpcs["_tag"]> = (
  caller: Caller,
  input: In<Tag>,
) => Effect.Effect<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>, Failure>;

/**
 * Workspaces, members, invitations and project bindings. `caller` is the auth session id; it acts
 * as the member it is linked to in `telescope_member_sessions`. Member ids fill `subjectId`.
 */
export class WorkspaceService extends Context.Service<
  WorkspaceService,
  {
    readonly create: Method<"telescope.workspace.create">;
    readonly list: Method<"telescope.workspace.list">;
    readonly get: Method<"telescope.workspace.get">;
    readonly invite: Method<"telescope.member.invite">;
    readonly linkCode: Method<"telescope.member.linkCode">;
    readonly accept: Method<"telescope.member.accept">;
    readonly members: Method<"telescope.member.list">;
    readonly setRole: Method<"telescope.member.setRole">;
    readonly revoke: Method<"telescope.member.revoke">;
    readonly bind: Method<"telescope.project.bind">;
    readonly unbind: Method<"telescope.project.unbind">;
    readonly bindings: Method<"telescope.project.listBindings">;
  }
>()("t3/telescope/WorkspaceService") {}

const make = Effect.gen(function* () {
  const db = yield* TelescopeDb.TelescopeDb;
  const random = yield* SecureRandom.SecureRandom;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const memberById = (workspaceId: Telescope.WorkspaceId, memberId: string) =>
    db
      .select(workspaceId, "members", decodeMembers, { subject_id: memberId })
      .pipe(Effect.map((rows) => rows[0]));

  const sessionMember = Effect.fn("WorkspaceService.sessionMember")(function* (
    workspaceId: Telescope.WorkspaceId,
    caller: Caller,
  ) {
    const [link] = yield* db.select(workspaceId, "member_sessions", decodeSessionLinks, {
      auth_session_id: caller,
    });
    return link === undefined ? undefined : yield* memberById(workspaceId, link.member_id);
  });

  const linkSession = (workspaceId: Telescope.WorkspaceId, memberId: string, caller: Caller) =>
    now.pipe(
      Effect.flatMap((at) =>
        db.insert(workspaceId, "member_sessions", {
          member_id: memberId,
          auth_session_id: caller,
          linked_at: at,
        }),
      ),
    );

  // Missing workspaces and foreign ones answer alike, so ids cannot be probed.
  const requireMember = Effect.fn("WorkspaceService.requireMember")(function* (
    workspaceId: Telescope.WorkspaceId,
    caller: Caller,
    role?: "admin",
  ) {
    const member = yield* sessionMember(workspaceId, caller);
    if (member === undefined || member.revoked_at !== null)
      return yield* fail("forbidden", "You are not a member of this workspace.");
    if (role !== undefined && member.role !== role)
      return yield* fail("forbidden", "Only workspace admins can do this.");
    return member;
  });

  const requireActiveTarget = Effect.fn("WorkspaceService.requireActiveTarget")(function* (
    workspaceId: Telescope.WorkspaceId,
    subjectId: string,
  ) {
    const target = yield* memberById(workspaceId, subjectId);
    if (target === undefined || target.revoked_at !== null)
      return yield* fail("not_found", "That person is not an active member.");
    return target;
  });

  /** `nextRole` undefined means the target is being revoked. */
  const keepAnAdmin = Effect.fn("WorkspaceService.keepAnAdmin")(function* (
    target: typeof MemberRow.Type,
    nextRole?: Telescope.WorkspaceRole,
  ) {
    if (target.role !== "admin" || nextRole === "admin") return;
    const admins = yield* db.select(target.workspace_id, "members", decodeMembers, {
      role: "admin",
      revoked_at: null,
    });
    if (admins.length <= 1) return yield* fail("conflict", "A workspace needs at least one admin.");
  });

  const issueCode = Effect.fn("WorkspaceService.issueCode")(function* (
    admin: typeof MemberRow.Type,
    role: Telescope.WorkspaceRole,
    expiresInSeconds: number | undefined,
    forMemberId?: string,
  ) {
    const invitation: Telescope.Invitation = {
      id: Telescope.InvitationId.make(yield* random.uuidV4()),
      workspaceId: admin.workspace_id,
      code: Base64Url.encode(yield* random.randomBytes(18)),
      role,
      invitedBy: admin.subject_id,
      ...(forMemberId === undefined ? {} : { forSubjectId: forMemberId }),
      expiresAt: DateTime.formatIso(
        DateTime.add(yield* DateTime.now, { seconds: expiresInSeconds ?? INVITATION_TTL_SECONDS }),
      ),
    };
    yield* db.insert(admin.workspace_id, "invitations", {
      invitation_id: invitation.id,
      code: invitation.code,
      role,
      invited_by: admin.subject_id,
      for_member_id: forMemberId ?? null,
      expires_at: invitation.expiresAt,
    });
    return invitation;
  });

  const create = Effect.fn("WorkspaceService.create")(function* (
    caller: Caller,
    input: In<"telescope.workspace.create">,
  ) {
    const workspaceId = Telescope.WorkspaceId.make(yield* random.uuidV4());
    const memberId = yield* random.uuidV4();
    const createdAt = yield* now;
    const row = { kind: input.kind, name: input.name, created_at: createdAt, created_by: memberId };
    yield* db.transaction(
      Effect.all([
        db.insert(workspaceId, "workspaces", row),
        db.insert(workspaceId, "members", {
          subject_id: memberId,
          display_name: input.displayName,
          role: "admin",
          joined_at: createdAt,
        }),
        linkSession(workspaceId, memberId, caller),
      ]),
    );
    return toWorkspace({ ...row, workspace_id: workspaceId });
  });

  const list = Effect.fn("WorkspaceService.list")(function* (caller: Caller) {
    const ids = yield* db.workspaceIdsOf(caller);
    const rows = yield* Effect.forEach(ids, (id) => db.select(id, "workspaces", decodeWorkspaces));
    return { workspaces: rows.flat().map(toWorkspace) };
  });

  const get = Effect.fn("WorkspaceService.get")(function* (
    caller: Caller,
    { workspaceId }: In<"telescope.workspace.get">,
  ) {
    const self = yield* requireMember(workspaceId, caller);
    const [workspace] = yield* db.select(workspaceId, "workspaces", decodeWorkspaces);
    if (workspace === undefined) return yield* fail("not_found", "Workspace not found.");
    return { workspace: toWorkspace(workspace), self: toMember(self) };
  });

  const invite = Effect.fn("WorkspaceService.invite")(function* (
    caller: Caller,
    input: In<"telescope.member.invite">,
  ) {
    const admin = yield* requireMember(input.workspaceId, caller, "admin");
    return yield* issueCode(admin, input.role, input.expiresInSeconds);
  });

  const linkCode = Effect.fn("WorkspaceService.linkCode")(function* (
    caller: Caller,
    input: In<"telescope.member.linkCode">,
  ) {
    const admin = yield* requireMember(input.workspaceId, caller, "admin");
    const target = yield* requireActiveTarget(input.workspaceId, input.subjectId);
    return yield* issueCode(admin, target.role, input.expiresInSeconds, target.subject_id);
  });

  const addMember = Effect.fn("WorkspaceService.addMember")(function* (
    workspaceId: Telescope.WorkspaceId,
    displayName: string,
    role: Telescope.WorkspaceRole,
    at: string,
  ) {
    const row = {
      subject_id: yield* random.uuidV4(),
      display_name: displayName,
      role,
      joined_at: at,
      revoked_at: null,
    };
    yield* db.insert(workspaceId, "members", row);
    return { ...row, workspace_id: workspaceId };
  });

  const accept = Effect.fn("WorkspaceService.accept")(function* (
    caller: Caller,
    input: In<"telescope.member.accept">,
  ) {
    const workspaceId = yield* db.workspaceIdForInvitation(input.code);
    if (workspaceId === undefined) return yield* fail("not_found", "This invitation is not valid.");
    return yield* db.transaction(
      Effect.gen(function* () {
        const at = yield* now;
        const [invitation] = yield* db.select(workspaceId, "invitations", decodeInvitations, {
          code: input.code,
        });
        if (invitation === undefined || invitation.accepted_at !== null)
          return yield* fail("conflict", "This invitation has already been used.");
        if (invitation.expires_at <= at)
          return yield* fail("expired", "This invitation has expired.");
        // A code dies with its issuer's admin role, so revoking or demoting them voids it.
        const issuer = yield* memberById(workspaceId, invitation.invited_by);
        if (issuer === undefined || issuer.revoked_at !== null || issuer.role !== "admin")
          return yield* fail("expired", "This invitation is no longer valid.");
        const existing = yield* sessionMember(workspaceId, caller);
        if (existing !== undefined)
          return yield* existing.revoked_at === null
            ? fail("conflict", "You are already a member of this workspace.")
            : fail("forbidden", "You were removed from this workspace.");
        const member =
          invitation.for_member_id === null
            ? yield* addMember(workspaceId, input.displayName, invitation.role, at)
            : yield* requireActiveTarget(workspaceId, invitation.for_member_id);
        yield* linkSession(workspaceId, member.subject_id, caller);
        yield* db.update(
          workspaceId,
          "invitations",
          { accepted_by: member.subject_id, accepted_at: at },
          { invitation_id: invitation.invitation_id },
        );
        return toMember(member);
      }),
    );
  });

  const members = Effect.fn("WorkspaceService.members")(function* (
    caller: Caller,
    { workspaceId }: In<"telescope.member.list">,
  ) {
    yield* requireMember(workspaceId, caller);
    const rows = yield* db.select(workspaceId, "members", decodeMembers);
    return { members: rows.map(toMember) };
  });

  const setRole = Effect.fn("WorkspaceService.setRole")(function* (
    caller: Caller,
    input: In<"telescope.member.setRole">,
  ) {
    return yield* db.transaction(
      Effect.gen(function* () {
        yield* requireMember(input.workspaceId, caller, "admin");
        const target = yield* requireActiveTarget(input.workspaceId, input.subjectId);
        yield* keepAnAdmin(target, input.role);
        const key = { subject_id: input.subjectId };
        yield* db.update(input.workspaceId, "members", { role: input.role }, key);
        return toMember({ ...target, role: input.role });
      }),
    );
  });

  const revoke = Effect.fn("WorkspaceService.revoke")(function* (
    caller: Caller,
    input: In<"telescope.member.revoke">,
  ) {
    return yield* db.transaction(
      Effect.gen(function* () {
        yield* requireMember(input.workspaceId, caller, "admin");
        const target = yield* requireActiveTarget(input.workspaceId, input.subjectId);
        yield* keepAnAdmin(target);
        const revokedAt = yield* now;
        const key = { subject_id: input.subjectId };
        yield* db.update(input.workspaceId, "members", { revoked_at: revokedAt }, key);
        return toMember({ ...target, revoked_at: revokedAt });
      }),
    );
  });

  const bindingKey = (input: In<"telescope.project.unbind">) => ({
    environment_id: input.environmentId,
    project_id: input.projectId,
  });

  const bind = Effect.fn("WorkspaceService.bind")(function* (
    caller: Caller,
    input: In<"telescope.project.bind">,
  ) {
    return yield* db.transaction(
      Effect.gen(function* () {
        yield* requireMember(input.workspaceId, caller, "admin");
        if (input.leadSubjectId !== undefined)
          yield* requireActiveTarget(input.workspaceId, input.leadSubjectId);
        yield* db.remove(input.workspaceId, "project_bindings", bindingKey(input));
        yield* db.insert(input.workspaceId, "project_bindings", {
          ...bindingKey(input),
          lead_subject_id: input.leadSubjectId ?? null,
        });
        return input;
      }),
    );
  });

  const unbind = Effect.fn("WorkspaceService.unbind")(function* (
    caller: Caller,
    input: In<"telescope.project.unbind">,
  ) {
    yield* requireMember(input.workspaceId, caller, "admin");
    yield* db.remove(input.workspaceId, "project_bindings", bindingKey(input));
    return {};
  });

  const bindings = Effect.fn("WorkspaceService.bindings")(function* (
    caller: Caller,
    { workspaceId }: In<"telescope.project.listBindings">,
  ) {
    yield* requireMember(workspaceId, caller);
    const rows = yield* db.select(workspaceId, "project_bindings", decodeBindings);
    return { bindings: rows.map(toBinding) };
  });

  return WorkspaceService.of({
    create,
    list,
    get,
    invite,
    linkCode,
    accept,
    members,
    setRole,
    revoke,
    bind,
    unbind,
    bindings,
  });
});

export const layer = Layer.effect(WorkspaceService, make).pipe(Layer.provide(TelescopeDb.layer));
