import { EnvironmentId, ProjectId, Telescope } from "@t3tools/contracts";
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
const InvitationRow = Schema.Struct({
  invitation_id: Telescope.InvitationId,
  workspace_id: Telescope.WorkspaceId,
  role: Telescope.WorkspaceRole,
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

type Caller = Telescope.SubjectId;
type Failure = Telescope.WorkspaceError | PersistenceSqlError | PersistenceDecodeError;
type Rpcs = (typeof Telescope.WorkspaceRpcs)[number];
type In<Tag extends Rpcs["_tag"]> = Rpc.Payload<Rpc.ExtractTag<Rpcs, Tag>>;
type Method<Tag extends Rpcs["_tag"]> = (
  caller: Caller,
  input: In<Tag>,
) => Effect.Effect<Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>, Failure>;

/** Workspaces, members, invitations and project bindings. `caller` is the session subject. */
export class WorkspaceService extends Context.Service<
  WorkspaceService,
  {
    readonly create: Method<"telescope.workspace.create">;
    readonly list: Method<"telescope.workspace.list">;
    readonly get: Method<"telescope.workspace.get">;
    readonly invite: Method<"telescope.member.invite">;
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

  const memberRow = (workspaceId: Telescope.WorkspaceId, subjectId: string) =>
    db
      .select(workspaceId, "members", decodeMembers, { subject_id: subjectId })
      .pipe(Effect.map((rows) => rows[0]));

  // Missing workspaces and foreign ones answer alike, so ids cannot be probed.
  const requireMember = Effect.fn("WorkspaceService.requireMember")(function* (
    workspaceId: Telescope.WorkspaceId,
    caller: Caller,
    role?: "admin",
  ) {
    const member = yield* memberRow(workspaceId, caller);
    if (member === undefined || member.revoked_at !== null)
      return yield* fail("forbidden", "You are not a member of this workspace.");
    if (role !== undefined && member.role !== role)
      return yield* fail("forbidden", "Only workspace admins can do this.");
    return member;
  });

  const requireActiveTarget = Effect.fn("WorkspaceService.requireActiveTarget")(function* (
    workspaceId: Telescope.WorkspaceId,
    subjectId: string,
    nextRole?: Telescope.WorkspaceRole,
  ) {
    const target = yield* memberRow(workspaceId, subjectId);
    if (target === undefined || target.revoked_at !== null)
      return yield* fail("not_found", "That person is not an active member.");
    if (target.role === "admin" && nextRole !== "admin") {
      const admins = yield* db.select(workspaceId, "members", decodeMembers, {
        role: "admin",
        revoked_at: null,
      });
      if (admins.length <= 1)
        return yield* fail("conflict", "A workspace needs at least one admin.");
    }
    return target;
  });

  const create = Effect.fn("WorkspaceService.create")(function* (
    caller: Caller,
    input: In<"telescope.workspace.create">,
  ) {
    const workspaceId = Telescope.WorkspaceId.make(yield* random.uuidV4());
    const createdAt = yield* now;
    const row = { kind: input.kind, name: input.name, created_at: createdAt, created_by: caller };
    yield* db.transaction(
      Effect.all([
        db.insert(workspaceId, "workspaces", row),
        db.insert(workspaceId, "members", {
          subject_id: caller,
          display_name: input.displayName,
          role: "admin",
          joined_at: createdAt,
        }),
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
    yield* requireMember(input.workspaceId, caller, "admin");
    const invitation: Telescope.Invitation = {
      id: Telescope.InvitationId.make(yield* random.uuidV4()),
      workspaceId: input.workspaceId,
      code: Base64Url.encode(yield* random.randomBytes(18)),
      role: input.role,
      invitedBy: caller,
      expiresAt: DateTime.formatIso(
        DateTime.add(yield* DateTime.now, {
          seconds: input.expiresInSeconds ?? INVITATION_TTL_SECONDS,
        }),
      ),
    };
    yield* db.insert(input.workspaceId, "invitations", {
      invitation_id: invitation.id,
      code: invitation.code,
      role: invitation.role,
      invited_by: caller,
      expires_at: invitation.expiresAt,
    });
    return invitation;
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
        const existing = yield* memberRow(workspaceId, caller);
        if (existing !== undefined && existing.revoked_at === null)
          return yield* fail("conflict", "You are already a member of this workspace.");
        const member = {
          display_name: input.displayName,
          role: invitation.role,
          joined_at: at,
          revoked_at: null,
        };
        yield* existing === undefined
          ? db.insert(workspaceId, "members", { ...member, subject_id: caller })
          : db.update(workspaceId, "members", member, { subject_id: caller });
        yield* db.update(
          workspaceId,
          "invitations",
          { accepted_by: caller, accepted_at: at },
          { invitation_id: invitation.invitation_id },
        );
        return toMember({ ...member, workspace_id: workspaceId, subject_id: caller });
      }),
    );
  });

  const members = Effect.fn("WorkspaceService.members")(function* (
    caller: Caller,
    { workspaceId }: In<"telescope.workspace.get">,
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
        const target = yield* requireActiveTarget(input.workspaceId, input.subjectId, input.role);
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
    input: Telescope.ProjectBinding,
  ) {
    return yield* db.transaction(
      Effect.gen(function* () {
        yield* requireMember(input.workspaceId, caller, "admin");
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
    { workspaceId }: In<"telescope.workspace.get">,
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
