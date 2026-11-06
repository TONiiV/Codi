import * as Schema from "effect/Schema";

import { EnvironmentId, PositiveInt, ProjectId } from "../baseSchemas.ts";
import { InvitationId, SubjectId, Text, Timestamp, WorkspaceId } from "./common.ts";

export const WorkspaceKind = Schema.Literals(["enterprise", "personal"]);
export const WorkspaceRole = Schema.Literals([
  "admin",
  "department_lead",
  "project_lead",
  "member",
]);
export type WorkspaceRole = typeof WorkspaceRole.Type;

export const Workspace = Schema.Struct({
  id: WorkspaceId,
  kind: WorkspaceKind,
  name: Text,
  createdAt: Timestamp,
  createdBy: SubjectId,
});
export type Workspace = typeof Workspace.Type;

export const Member = Schema.Struct({
  workspaceId: WorkspaceId,
  subjectId: SubjectId,
  displayName: Text,
  role: WorkspaceRole,
  joinedAt: Timestamp,
  revokedAt: Schema.optionalKey(Timestamp),
});
export type Member = typeof Member.Type;

export const Invitation = Schema.Struct({
  id: InvitationId,
  workspaceId: WorkspaceId,
  code: Text,
  role: WorkspaceRole,
  invitedBy: SubjectId,
  expiresAt: Timestamp,
  acceptedBy: Schema.optionalKey(SubjectId),
  acceptedAt: Schema.optionalKey(Timestamp),
});
export type Invitation = typeof Invitation.Type;

export const ProjectBinding = Schema.Struct({
  workspaceId: WorkspaceId,
  environmentId: EnvironmentId,
  projectId: ProjectId,
  leadSubjectId: Schema.optionalKey(SubjectId),
});
export type ProjectBinding = typeof ProjectBinding.Type;

const InWorkspace = { workspaceId: WorkspaceId };

export const WorkspaceCreateInput = Schema.Struct({
  kind: WorkspaceKind,
  name: Text,
  displayName: Text,
});
export const WorkspaceListResult = Schema.Struct({ workspaces: Schema.Array(Workspace) });
export const WorkspaceScopedInput = Schema.Struct(InWorkspace);
export const WorkspaceListInput = Schema.Struct({});
export const WorkspaceGetResult = Schema.Struct({ workspace: Workspace, self: Member });

export const MemberInviteInput = Schema.Struct({
  ...InWorkspace,
  role: WorkspaceRole,
  expiresInSeconds: Schema.optionalKey(PositiveInt),
});
export const MemberAcceptInput = Schema.Struct({ code: Text, displayName: Text });
export const MemberListResult = Schema.Struct({ members: Schema.Array(Member) });
export const MemberSetRoleInput = Schema.Struct({
  ...InWorkspace,
  subjectId: SubjectId,
  role: WorkspaceRole,
});
export const MemberRevokeInput = Schema.Struct({ ...InWorkspace, subjectId: SubjectId });

export const ProjectUnbindInput = Schema.Struct({
  ...InWorkspace,
  environmentId: EnvironmentId,
  projectId: ProjectId,
});
export const ProjectListBindingsResult = Schema.Struct({
  bindings: Schema.Array(ProjectBinding),
});

export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()(
  "TelescopeWorkspaceError",
  {
    reason: Schema.Literals(["not_found", "forbidden", "expired", "conflict", "storage"]),
    message: Schema.String,
  },
) {}
