import { type AuthSessionId, EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import type * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { INTERNAL_ADMINISTRATIVE_BOOTSTRAP_SUBJECT } from "../auth/EnvironmentAuth.ts";
import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as TelescopeDb from "./TelescopeDb.ts";

const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const OWNER_MEMBER_ID = Telescope.OWNER_MEMBER_ID;
// Only the owner holds these: the desktop app's bootstrap and the startup (or dev) admin link.
const OWNER_SUBJECTS: ReadonlySet<string> = new Set([
  "desktop-bootstrap",
  INTERNAL_ADMINISTRATIVE_BOOTSTRAP_SUBJECT,
  "reusable-dev-token",
]);

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

export interface Caller {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly proofKeyThumbprint?: string;
}
const isOwner = (caller: Caller) => OWNER_SUBJECTS.has(caller.subject);
// A proof key outlives its hourly sessions and re-pairing; a cookie session moves on replacement.
const deviceKey = (caller: Caller) => caller.proofKeyThumbprint ?? caller.sessionId;
type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;
type Rpcs = (typeof Telescope.WorkspaceRpcs)[number];
type In<Tag extends Rpcs["_tag"]> = Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>;
type Method<Tag extends Rpcs["_tag"]> = (
  caller: Caller,
  input: In<Tag>,
) => Effect.Effect<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>, Failure>;

/**
 * Workspaces, members, invitations and project bindings. The owner acts as `OWNER_MEMBER_ID`; any
 * other caller acts as the member its device key is linked to. Member ids fill `subjectId`.
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
    readonly bindingSummary: Method<"telescope.project.bindingSummary">;
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

  const callerMember = Effect.fn("WorkspaceService.callerMember")(function* (
    workspaceId: Telescope.WorkspaceId,
    caller: Caller,
  ) {
    if (isOwner(caller)) return yield* memberById(workspaceId, OWNER_MEMBER_ID);
    const [link] = yield* db.select(workspaceId, "member_sessions", decodeSessionLinks, {
      device_key: deviceKey(caller),
    });
    return link === undefined ? undefined : yield* memberById(workspaceId, link.member_id);
  });

  const linkDevice = (workspaceId: Telescope.WorkspaceId, memberId: string, caller: Caller) =>
    now.pipe(
      Effect.flatMap((at) =>
        db.insert(workspaceId, "member_sessions", {
          member_id: memberId,
          device_key: deviceKey(caller),
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
    const member = yield* callerMember(workspaceId, caller);
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
  // Role changes, revocation and device links never apply to the owner.
  const requireManagedTarget = (workspaceId: Telescope.WorkspaceId, subjectId: string) =>
    subjectId === OWNER_MEMBER_ID
      ? fail("conflict", "The environment owner is always an admin.")
      : requireActiveTarget(workspaceId, subjectId);

  // A code dies with its issuer's admin role; promoting them again does not revive it.
  const voidCodesOf = (issuer: typeof MemberRow.Type) =>
    now.pipe(
      Effect.flatMap((at) =>
        db.update(
          issuer.workspace_id,
          "invitations",
          { expires_at: at },
          { invited_by: issuer.subject_id, accepted_at: null },
        ),
      ),
    );

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
    const owner = isOwner(caller);
    const memberId = owner ? OWNER_MEMBER_ID : yield* random.uuidV4();
    const createdAt = yield* now;
    const row = { kind: input.kind, name: input.name, created_at: createdAt, created_by: memberId };
    const admin = (subjectId: string, displayName: string) =>
      db.insert(workspaceId, "members", {
        subject_id: subjectId,
        display_name: displayName,
        role: "admin",
        joined_at: createdAt,
      });
    yield* db.transaction(
      Effect.all([
        db.insert(workspaceId, "workspaces", row),
        admin(OWNER_MEMBER_ID, owner ? input.displayName : "所有者"),
        ...(owner
          ? []
          : [admin(memberId, input.displayName), linkDevice(workspaceId, memberId, caller)]),
      ]),
    );
    return toWorkspace({ ...row, workspace_id: workspaceId });
  });

  const list = Effect.fn("WorkspaceService.list")(function* (caller: Caller) {
    const ids = yield* isOwner(caller) ? db.allWorkspaceIds : db.workspaceIdsOf(deviceKey(caller));
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
    const target = yield* requireManagedTarget(input.workspaceId, input.subjectId);
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
        const existing = yield* callerMember(workspaceId, caller);
        if (existing !== undefined)
          return yield* existing.revoked_at === null
            ? fail("conflict", "You are already a member of this workspace.")
            : fail("forbidden", "You were removed from this workspace.");
        const member =
          invitation.for_member_id === null
            ? yield* addMember(workspaceId, input.displayName, invitation.role, at)
            : yield* requireActiveTarget(workspaceId, invitation.for_member_id);
        yield* linkDevice(workspaceId, member.subject_id, caller);
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
        const target = yield* requireManagedTarget(input.workspaceId, input.subjectId);
        const key = { subject_id: input.subjectId };
        yield* db.update(input.workspaceId, "members", { role: input.role }, key);
        if (input.role !== "admin") yield* voidCodesOf(target);
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
        const target = yield* requireManagedTarget(input.workspaceId, input.subjectId);
        const revokedAt = yield* now;
        const key = { subject_id: input.subjectId };
        yield* db.update(input.workspaceId, "members", { revoked_at: revokedAt }, key);
        yield* voidCodesOf(target);
        const lead = { lead_subject_id: input.subjectId };
        yield* db.update(input.workspaceId, "project_bindings", { lead_subject_id: null }, lead);
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

  // Any member may see where projects are bound, so every sidebar can hide them (D16).
  const bindingSummary = Effect.fn("WorkspaceService.bindingSummary")(function* (caller: Caller) {
    if (!isOwner(caller) && (yield* db.workspaceIdsOf(deviceKey(caller))).length === 0)
      return yield* fail("forbidden", "You are not a member of any workspace.");
    const ids = yield* db.allWorkspaceIds;
    const rows = yield* Effect.forEach(ids, (id) =>
      db.select(id, "project_bindings", decodeBindings),
    );
    const projects = new Map<string, Telescope.ProjectBindingSummary>();
    for (const row of rows.flat()) {
      const key = `${row.environment_id}:${row.project_id}`;
      const project = projects.get(key);
      projects.set(key, {
        environmentId: row.environment_id,
        projectId: row.project_id,
        workspaceIds: [...(project?.workspaceIds ?? []), row.workspace_id],
      });
    }
    return { projects: [...projects.values()] };
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
    bindingSummary,
  });
});

export const layer = Layer.effect(WorkspaceService, make).pipe(Layer.provide(TelescopeDb.layer));
