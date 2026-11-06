import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  Invitation,
  Member,
  MemberAcceptInput,
  MemberInviteInput,
  MemberListResult,
  MemberRevokeInput,
  MemberSetRoleInput,
  ProjectBinding,
  ProjectListBindingsResult,
  ProjectUnbindInput,
  Workspace,
  WorkspaceCreateInput,
  WorkspaceError,
  WorkspaceGetResult,
  WorkspaceListInput,
  WorkspaceListResult,
  WorkspaceScopedInput,
} from "./workspace.ts";

export const WS_METHODS = {
  workspaceCreate: "telescope.workspace.create",
  workspaceList: "telescope.workspace.list",
  workspaceGet: "telescope.workspace.get",
  memberInvite: "telescope.member.invite",
  memberAccept: "telescope.member.accept",
  memberList: "telescope.member.list",
  memberSetRole: "telescope.member.setRole",
  memberRevoke: "telescope.member.revoke",
  projectBind: "telescope.project.bind",
  projectUnbind: "telescope.project.unbind",
  projectListBindings: "telescope.project.listBindings",
} as const;

const error = Schema.Union([WorkspaceError, EnvironmentAuthorizationError]);
const make = <const Tag extends string, P extends Schema.Top, S extends Schema.Top>(
  tag: Tag,
  payload: P,
  success: S,
) => Rpc.make(tag, { payload, success, error });

export const WorkspaceRpcs = [
  make(WS_METHODS.workspaceCreate, WorkspaceCreateInput, Workspace),
  make(WS_METHODS.workspaceList, WorkspaceListInput, WorkspaceListResult),
  make(WS_METHODS.workspaceGet, WorkspaceScopedInput, WorkspaceGetResult),
  make(WS_METHODS.memberInvite, MemberInviteInput, Invitation),
  make(WS_METHODS.memberAccept, MemberAcceptInput, Member),
  make(WS_METHODS.memberList, WorkspaceScopedInput, MemberListResult),
  make(WS_METHODS.memberSetRole, MemberSetRoleInput, Member),
  make(WS_METHODS.memberRevoke, MemberRevokeInput, Member),
  make(WS_METHODS.projectBind, ProjectBinding, ProjectBinding),
  make(WS_METHODS.projectUnbind, ProjectUnbindInput, Schema.Struct({})),
  make(WS_METHODS.projectListBindings, WorkspaceScopedInput, ProjectListBindingsResult),
] as const;
