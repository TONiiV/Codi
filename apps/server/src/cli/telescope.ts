import { AuthSessionId, ProjectId, Telescope } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";
import * as CliError from "effect/cli/CliError";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import type { PersistenceDecodeError, PersistenceSqlError } from "../persistence/Errors.ts";
import * as InviteLink from "../telescope/InviteLink.ts";
import * as WorkspaceDataService from "../telescope/WorkspaceDataService.ts";
import * as WorkspaceService from "../telescope/WorkspaceService.ts";
import {
  type CliAuthLocationFlags,
  DurationFromString,
  projectLocationFlags,
  resolveCliAuthConfig,
} from "./config.ts";

// Whoever can run the CLI owns this T3 home, so it acts as the environment owner.
const OWNER: WorkspaceService.SessionCaller = {
  sessionId: AuthSessionId.make("cli"),
  subject: EnvironmentAuth.INTERNAL_ADMINISTRATIVE_BOOTSTRAP_SUBJECT,
};

const common = {
  ...projectLocationFlags,
  json: Flag.Boolean("json").pipe(
    Flag.withDescription("Emit JSON instead of human-readable output."),
    Flag.withDefault(false),
  ),
};
const orgFlag = Flag.String("org").pipe(
  Flag.withSchema(Telescope.WorkspaceId),
  Flag.withDescription("Workspace id, from `t3 org list`."),
);
const memberFlag = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withSchema(Telescope.SubjectId), Flag.withDescription(description));
const roleFlag = Flag.Literals("role", Telescope.WorkspaceRole.literals).pipe(
  Flag.withDescription("Workspace role."),
);
const projectFlag = Flag.String("project").pipe(
  Flag.withSchema(ProjectId),
  Flag.withDescription("Project id on this environment."),
);

type Flags = { readonly baseDir: Option.Option<string>; readonly json: boolean };
type Services =
  | WorkspaceService.WorkspaceService
  | WorkspaceDataService.WorkspaceDataService
  | ServerEnvironment.ServerEnvironmentIdentity
  | FileSystem.FileSystem
  | Path.Path;
type Failure =
  | Telescope.WorkspaceError
  | Telescope.WorkspaceBusyError
  | PersistenceSqlError
  | PersistenceDecodeError
  | PlatformError
  | CliError.UserError;

const render = <A>(json: boolean, result: A, human: (result: A) => string) =>
  json ? JSON.stringify(result, null, 2) : human(result);
const userError = (error: Error) =>
  Effect.fail(new CliError.UserError({ cause: error, userMessage: error.message }));

/** Opens this T3 home's database, runs one service call as the owner, and prints its result. */
const runAsOwner = Effect.fn("cli.telescope.runAsOwner")(function* <A>(
  flags: Flags,
  run: (
    service: WorkspaceService.WorkspaceService["Service"],
    links: InviteLink.InviteServices,
  ) => Effect.Effect<A, Failure, Services>,
  human: (result: A) => string,
) {
  // Logs share stdout with the printed value, which scripts capture (`ORG=$(t3 org init ...)`).
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel, {
    quietLogs: true,
  });
  const result = yield* Effect.all([
    WorkspaceService.WorkspaceService,
    EnvironmentAuth.EnvironmentAuth,
  ]).pipe(
    Effect.flatMap(([workspaces, auth]) => run(workspaces, { workspaces, auth })),
    Effect.catchTags({
      TelescopeWorkspaceError: userError,
      TelescopeWorkspaceBusyError: userError,
      PlatformError: userError,
    }),
    Effect.provide(
      Layer.merge(WorkspaceService.layer, WorkspaceDataService.layer).pipe(
        Layer.provideMerge(EnvironmentAuth.layerRuntime),
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
      ),
    ),
  );
  yield* Console.log(render(flags.json, result, human));
});

const table = (header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>) => {
  if (rows.length === 0) return "Nothing here yet.";
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]!.length)),
  );
  return [header, ...rows]
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
};
const describe = (member: Telescope.Member) => `${member.displayName} (${member.subjectId})`;
const localEnvironmentId = ServerEnvironment.ServerEnvironmentIdentity.pipe(
  Effect.flatMap((identity) => identity.getEnvironmentId),
);

const orgInitCommand = Command.make("init", {
  ...common,
  name: Flag.String("name").pipe(
    Flag.withSchema(Telescope.Text),
    Flag.withDescription("Workspace name."),
  ),
  kind: Flag.Literals("kind", Telescope.WorkspaceKind.literals).pipe(
    Flag.withDescription("An enterprise workspace or a personal one."),
  ),
  displayName: Flag.String("display-name").pipe(
    Flag.withSchema(Telescope.Text),
    Flag.withDescription("Your name as the workspace's owner."),
    Flag.withDefault("所有者"),
  ),
}).pipe(
  Command.withDescription("Create a workspace owned by this environment and print its id."),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      (service) =>
        service.create(OWNER, {
          kind: flags.kind,
          name: flags.name,
          displayName: flags.displayName,
        }),
      (workspace) => workspace.id,
    ),
  ),
);

const orgListCommand = Command.make("list", common).pipe(
  Command.withDescription("List the workspaces on this environment."),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      (service) => service.list(OWNER, {}),
      ({ workspaces }) =>
        table(
          ["ID", "KIND", "CREATED", "NAME"],
          workspaces.map((workspace) => [
            workspace.id,
            workspace.kind,
            workspace.createdAt,
            workspace.name,
          ]),
        ),
    ),
  ),
);

const workspaceArgument = Argument.String("workspace").pipe(
  Argument.withSchema(Telescope.WorkspaceId),
  Argument.withDescription("Workspace id, from `t3 org list`."),
);

const orgExportCommand = Command.make("export", {
  ...common,
  workspace: workspaceArgument,
  out: Flag.String("out").pipe(
    Flag.withDescription("A new or empty directory to write the export into."),
  ),
}).pipe(
  Command.withDescription("Export a workspace's data as JSON and Markdown files."),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          if ((yield* fs.exists(flags.out)) && (yield* fs.readDirectory(flags.out)).length > 0)
            return yield* new CliError.UserError({
              cause: flags.out,
              userMessage: `${flags.out} is not empty. Export into a new or empty directory.`,
            });
          const data = yield* WorkspaceDataService.WorkspaceDataService;
          const { files } = yield* data.export(
            OWNER,
            { workspaceId: flags.workspace },
            { maxBytes: Number.POSITIVE_INFINITY },
          );
          yield* fs.makeDirectory(flags.out, { recursive: true });
          for (const file of files)
            yield* fs.writeFileString(path.join(flags.out, file.path), file.text);
          return { directory: flags.out, files: files.map((file) => file.path) };
        }),
      ({ directory, files }) => `Exported ${files.join(", ")} to ${directory}.`,
    ),
  ),
);

const encodeManifest = Schema.encodeSync(
  Schema.fromJsonString(Telescope.WorkspaceDeleteManifest, { space: 2 }),
);

const orgDeleteCommand = Command.make("delete", {
  ...common,
  workspace: workspaceArgument,
  confirm: Flag.String("confirm").pipe(
    Flag.withSchema(Telescope.Text),
    Flag.withDescription("The workspace's name, typed out to confirm the deletion."),
  ),
  manifest: Flag.String("manifest").pipe(
    Flag.withDescription("Write the deletion manifest, with every deleted row's id, to this file."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Delete a workspace and all its data, and print what was deleted."),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      (_, links) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const file = Option.getOrUndefined(flags.manifest);
          // The manifest is the only record of the deletion, so its path is proven writable first,
          // by appending nothing. A refused deletion leaves an earlier manifest there intact, and
          // removes the empty file it created.
          const created = file !== undefined && !(yield* fs.exists(file));
          if (file !== undefined) yield* fs.writeFileString(file, "", { flag: "a" });
          const data = yield* WorkspaceDataService.WorkspaceDataService;
          const manifest = yield* InviteLink.deleteWorkspace({ ...links, data }, OWNER, {
            workspaceId: flags.workspace,
            confirmName: flags.confirm,
          }).pipe(
            Effect.onError(() => (created ? fs.remove(file).pipe(Effect.ignore) : Effect.void)),
          );
          if (file !== undefined) yield* fs.writeFileString(file, `${encodeManifest(manifest)}\n`);
          return manifest;
        }),
      (manifest) =>
        [
          `Deleted ${manifest.workspace.name} (${manifest.workspace.id}).`,
          table(
            ["TABLE", "ROWS"],
            manifest.tables.map((row) => [row.table, String(row.count)]),
          ),
          `Removed ${manifest.contextFiles.length} run context files.`,
          ...(manifest.contextFilesLeft.length === 0
            ? []
            : [
                "Left behind under the server's state directory; remove them by hand:",
                ...manifest.contextFilesLeft.map((file) => `- [ ] ${file.path} (${file.reason})`),
              ]),
        ].join("\n"),
    ),
  ),
);

export const orgCommand = Command.make("org").pipe(
  Command.withDescription("Manage Telescope workspaces."),
  Command.withSubcommands([orgInitCommand, orgListCommand, orgExportCommand, orgDeleteCommand]),
);

const MAX_INVITATION_TTL = Duration.seconds(Telescope.MEMBER_CODE_MAX_TTL_SECONDS);

const memberInviteCommand = Command.make("invite", {
  ...common,
  org: orgFlag,
  role: roleFlag,
  expires: Flag.String("expires").pipe(
    Flag.withSchema(DurationFromString),
    Flag.filter(
      (expires) => Duration.isPositive(expires) && Duration.isFinite(expires),
      () => "Invitation codes always expire. Use a duration longer than 0s, for example `1h`.",
    ),
    Flag.filter(
      (expires) => Duration.isLessThanOrEqualTo(expires, MAX_INVITATION_TTL),
      () => "Invitation codes last at most 365 days.",
    ),
    Flag.withDescription(
      "How long the code stays valid, for example `1h` or `3d`, at most 365d. Default: 7d.",
    ),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Create an invitation code for a new member and print it."),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      (service) =>
        service.invite(OWNER, {
          workspaceId: flags.org,
          role: flags.role,
          ...Option.match(flags.expires, {
            onNone: () => ({}),
            onSome: (expires) => ({
              expiresInSeconds: Math.ceil(Duration.toSeconds(expires)),
            }),
          }),
        }),
      (invitation) => invitation.code,
    ),
  ),
);

const memberListCommand = Command.make("list", { ...common, org: orgFlag }).pipe(
  Command.withDescription("List a workspace's members, including revoked ones."),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      (service) => service.members(OWNER, { workspaceId: flags.org }),
      ({ members }) =>
        table(
          ["ID", "ROLE", "JOINED", "STATUS", "NAME"],
          members.map((member) => [
            member.subjectId,
            member.role,
            member.joinedAt,
            member.revokedAt === undefined ? "active" : `revoked ${member.revokedAt}`,
            member.displayName,
          ]),
        ),
    ),
  ),
);

const memberRevokeCommand = Command.make("revoke", {
  ...common,
  org: orgFlag,
  member: memberFlag("member", "Member id, from `t3 member list`."),
}).pipe(
  Command.withDescription(
    "Remove a member, void the codes they issued, and sign out their Telescope-only devices that are in no other workspace.",
  ),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      (_, links) =>
        InviteLink.revoke(links, OWNER, { workspaceId: flags.org, subjectId: flags.member }),
      (member) => `Revoked ${describe(member)}.`,
    ),
  ),
);

const memberRestoreCommand = Command.make("restore", {
  ...common,
  org: orgFlag,
  member: memberFlag("member", "Member id of a revoked member, from `t3 member list`."),
}).pipe(
  Command.withDescription(
    "Re-admit a revoked member with their previous role; devices the revoke signed out need a new invite link. Project leads are not restored: rebind with `t3 project bind --lead`.",
  ),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      (service) => service.restore(OWNER, { workspaceId: flags.org, subjectId: flags.member }),
      (member) => `Restored ${describe(member)} as ${member.role}.`,
    ),
  ),
);

export const memberCommand = Command.make("member").pipe(
  Command.withDescription("Manage the members of a Telescope workspace."),
  Command.withSubcommands([
    memberInviteCommand,
    memberListCommand,
    memberRevokeCommand,
    memberRestoreCommand,
  ]),
);

const roleSetCommand = Command.make("set", {
  ...common,
  org: orgFlag,
  member: memberFlag("member", "Member id, from `t3 member list`."),
  role: roleFlag,
}).pipe(
  Command.withDescription("Change a member's workspace role."),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      (_, links) =>
        InviteLink.setRole(links, OWNER, {
          workspaceId: flags.org,
          subjectId: flags.member,
          role: flags.role,
        }),
      (member) => `${describe(member)} is now ${member.role}.`,
    ),
  ),
);

export const roleCommand = Command.make("role").pipe(
  Command.withDescription("Manage workspace roles."),
  Command.withSubcommands([roleSetCommand]),
);

/** `resolveProjectId` is `t3 project`'s own resolver, injected to keep the modules acyclic. */
export const makeProjectBindCommand = <E, R>(
  resolveProjectId: (
    flags: CliAuthLocationFlags,
    identifier: string,
  ) => Effect.Effect<ProjectId, E, R>,
) =>
  Command.make("bind", {
    ...common,
    org: orgFlag,
    project: Argument.String("project").pipe(
      Argument.withDescription("Project id or workspace root to bind."),
    ),
    lead: memberFlag("lead", "Member id of the project's lead.").pipe(Flag.optional),
  }).pipe(
    Command.withDescription("Bind a project on this environment to a Telescope workspace."),
    Command.withHandler((flags) =>
      resolveProjectId(flags, flags.project).pipe(
        Effect.flatMap((projectId) =>
          runAsOwner(
            flags,
            (service) =>
              localEnvironmentId.pipe(
                Effect.flatMap((environmentId) =>
                  service.bind(OWNER, {
                    workspaceId: flags.org,
                    environmentId,
                    projectId,
                    ...Option.match(flags.lead, {
                      onNone: () => ({}),
                      onSome: (leadSubjectId) => ({ leadSubjectId }),
                    }),
                  }),
                ),
              ),
            (binding) =>
              `Bound ${binding.projectId} to ${binding.workspaceId}${binding.leadSubjectId === undefined ? "" : `, led by ${binding.leadSubjectId}`}.`,
          ),
        ),
      ),
    ),
  );

export const projectUnbindCommand = Command.make("unbind", {
  ...common,
  org: orgFlag,
  project: projectFlag,
}).pipe(
  Command.withDescription("Remove a project's binding to a Telescope workspace."),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      (service) =>
        localEnvironmentId.pipe(
          Effect.flatMap((environmentId) =>
            service.unbind(OWNER, {
              workspaceId: flags.org,
              environmentId,
              projectId: flags.project,
            }),
          ),
        ),
      () => `Unbound ${flags.project} from ${flags.org}.`,
    ),
  ),
);

export const projectBindingsCommand = Command.make("bindings", { ...common, org: orgFlag }).pipe(
  Command.withDescription("List the projects bound to a Telescope workspace."),
  Command.withHandler((flags) =>
    runAsOwner(
      flags,
      (service) => service.bindings(OWNER, { workspaceId: flags.org }),
      ({ bindings }) =>
        table(
          ["ENVIRONMENT", "PROJECT", "LEAD"],
          bindings.map((binding) => [
            binding.environmentId,
            binding.projectId,
            binding.leadSubjectId ?? "",
          ]),
        ),
    ),
  ),
);
