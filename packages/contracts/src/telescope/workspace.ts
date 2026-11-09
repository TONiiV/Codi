import * as Schema from "effect/Schema";

import { EnvironmentId, ProjectId } from "../baseSchemas.ts";
import {
  InvitationId,
  SubjectId,
  TelescopeProjectId,
  Text,
  Timestamp,
  WorkspaceId,
} from "./common.ts";

export const WorkspaceKind = Schema.Literals(["enterprise", "personal"]);
/** `viewer` (只读) reads what a member reads and writes nothing. */
export const WorkspaceRole = Schema.Literals([
  "admin",
  "department_lead",
  "project_lead",
  "member",
  "viewer",
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

/**
 * `subjectId` is the Telescope member id; paired auth sessions all share one auth subject.
 * `owner` is this environment's owner, an admin of every workspace on it.
 */
export const Member = Schema.Struct({
  workspaceId: WorkspaceId,
  subjectId: SubjectId,
  displayName: Text,
  role: WorkspaceRole,
  joinedAt: Timestamp,
  revokedAt: Schema.optionalKey(Timestamp),
});
export type Member = typeof Member.Type;
/** The environment owner's member id: an admin of every workspace, never removable. */
export const OWNER_MEMBER_ID = "owner";

export const Invitation = Schema.Struct({
  id: InvitationId,
  workspaceId: WorkspaceId,
  code: Text,
  role: WorkspaceRole,
  invitedBy: SubjectId,
  /** Set on a device-link code: accepting it links the session to this existing member. */
  forSubjectId: Schema.optionalKey(SubjectId),
  expiresAt: Timestamp,
  acceptedBy: Schema.optionalKey(SubjectId),
  acceptedAt: Schema.optionalKey(Timestamp),
});
export type Invitation = typeof Invitation.Type;

/** A Codi project directory on some environment; a workspace mounts each one at most once. */
export const ProjectMount = Schema.Struct({ environmentId: EnvironmentId, projectId: ProjectId });
export type ProjectMount = typeof ProjectMount.Type;

/** A workspace's unit of planning: tasks belong to it, and its lead leads every mount. */
export const Project = Schema.Struct({
  id: TelescopeProjectId,
  workspaceId: WorkspaceId,
  name: Text,
  leadSubjectId: Schema.optionalKey(SubjectId),
  mounts: Schema.Array(ProjectMount),
  createdAt: Timestamp,
});
export type Project = typeof Project.Type;

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

export const MEMBER_CODE_MAX_TTL_SECONDS = 365 * 24 * 60 * 60;
const CodeTtlSeconds = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MEMBER_CODE_MAX_TTL_SECONDS }),
);

export const MemberInviteInput = Schema.Struct({
  ...InWorkspace,
  role: WorkspaceRole,
  expiresInSeconds: Schema.optionalKey(CodeTtlSeconds),
});
/**
 * A one-time pairing credential with Telescope scopes only (`telescope:member`, plus
 * `telescope:admin` for an admin invite): an invite never gives machine access. Only a session
 * that may create pairing links gets one (`owner_only` otherwise).
 */
export const InvitePairingLink = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("issued"),
    id: Text,
    credential: Text,
    expiresAt: Timestamp,
  }),
  Schema.Struct({ status: Schema.Literals(["owner_only", "policy_refused"]) }),
]);
export type InvitePairingLink = typeof InvitePairingLink.Type;
export const MemberInviteResult = Schema.Struct({
  ...Invitation.fields,
  pairingLink: InvitePairingLink,
});
export const MemberLinkCodeInput = Schema.Struct({
  ...InWorkspace,
  subjectId: SubjectId,
  expiresInSeconds: Schema.optionalKey(CodeTtlSeconds),
});
export const MemberAcceptInput = Schema.Struct({ code: Text, displayName: Text });
export const MemberListResult = Schema.Struct({ members: Schema.Array(Member) });
export const MemberSetRoleInput = Schema.Struct({
  ...InWorkspace,
  subjectId: SubjectId,
  role: WorkspaceRole,
});
export const MemberRevokeInput = Schema.Struct({ ...InWorkspace, subjectId: SubjectId });

export const ProjectListResult = Schema.Struct({ projects: Schema.Array(Project) });
export const ProjectCreateInput = Schema.Struct({
  ...InWorkspace,
  name: Text,
  leadSubjectId: Schema.optionalKey(SubjectId),
  mounts: Schema.optionalKey(Schema.Array(ProjectMount)),
});
const InProject = { ...InWorkspace, projectId: TelescopeProjectId };
/** `leadSubjectId: null` clears the lead. */
export const ProjectUpdateInput = Schema.Struct({
  ...InProject,
  name: Schema.optionalKey(Text),
  leadSubjectId: Schema.optionalKey(Schema.NullOr(SubjectId)),
});
export const ProjectScopedInput = Schema.Struct(InProject);
export const ProjectMountInput = Schema.Struct({ ...InProject, mount: ProjectMount });
/** A workspace mounts a directory at most once, so the mount alone names the project it leaves. */
export const ProjectUnmountInput = Schema.Struct({ ...InWorkspace, mount: ProjectMount });
/**
 * Where each mounted Codi project on this environment is mounted, with no names, members or
 * leads. The name predates mounts; older clients read it to hide projects in their sidebar.
 */
export const ProjectBindingSummaryResult = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({
      environmentId: EnvironmentId,
      projectId: ProjectId,
      workspaceIds: Schema.Array(WorkspaceId),
    }),
  ),
});
export type ProjectBindingSummary = (typeof ProjectBindingSummaryResult.Type)["projects"][number];

export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()(
  "TelescopeWorkspaceError",
  {
    reason: Schema.Literals([
      "not_found",
      "forbidden",
      "expired",
      "conflict",
      "invalid",
      "storage",
    ]),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
