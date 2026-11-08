import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, Telescope } from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";
import * as CliError from "effect/cli/CliError";

import { cli } from "../binCli.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as WorkspaceService from "../telescope/WorkspaceService.ts";

const decodeJson = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema));

/** A temp T3 home, and `t3 <args> --base-dir <home>` returning what the command printed. */
const makeHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-telescope-cli-" });
  const t3 = (...args: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const before = (yield* TestConsole.logLines).length;
      yield* Command.runWith(cli, { version: "0.0.0" })([
        ...args,
        "--base-dir",
        baseDir,
        "--log-level",
        "error",
      ]);
      return (yield* TestConsole.logLines).slice(before).join("\n");
    });
  // Joining needs a device session, which the CLI never is; the member accepts like the app does.
  const join = (
    code: string,
    displayName: string,
    sessionId = AuthSessionId.make(`device-${displayName}`),
  ) =>
    WorkspaceService.WorkspaceService.pipe(
      Effect.flatMap((service) =>
        service.accept({ sessionId, subject: "one-time-token" }, { code, displayName }),
      ),
      Effect.provide(
        WorkspaceService.layer.pipe(
          Layer.provide(
            SqlitePersistence.layerFromPath(path.join(baseDir, "userdata", "statev2.sqlite")),
          ),
          Layer.provide(
            Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(EnvironmentId.make("env-unused")),
            }),
          ),
        ),
      ),
    );
  return { t3, join, baseDir };
});

const failureOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) =>
      CliError.isCliError(error) && error._tag === "ShowHelp"
        ? error.errors.map((cause) => cause.message).join("\n")
        : String(error instanceof Error ? error.message : error),
    ),
  );

const layer = Layer.mergeAll(
  NodeServices.layer,
  NodeCrypto.layer,
  NetService.layer,
  TestConsole.layer,
);

it.layer(layer)("telescope CLI", (it) => {
  it.effect("org init creates an owned workspace and org list shows it", () =>
    Effect.gen(function* () {
      const { t3 } = yield* makeHome;
      const id = yield* t3("org", "init", "--name", "Acme", "--kind", "enterprise");
      assert.match(id, /^[0-9a-f-]{36}$/);
      const { workspaces } = yield* t3("org", "list", "--json").pipe(
        Effect.flatMap(decodeJson(Telescope.WorkspaceListResult)),
      );
      assert.deepEqual(
        workspaces.map((workspace) => [workspace.id, workspace.name, workspace.createdBy]),
        [[Telescope.WorkspaceId.make(id), "Acme", WorkspaceService.OWNER_MEMBER_ID]],
      );
      assert.match(yield* t3("org", "list"), /^ID\s+KIND\s+CREATED\s+NAME\n.+enterprise.+Acme$/);
    }),
  );

  it.effect("org export and org delete write their files and never overwrite a user's", () =>
    Effect.gen(function* () {
      const { t3, baseDir } = yield* makeHome;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const org = yield* t3("org", "init", "--name", "Acme", "--kind", "enterprise");
      const out = path.join(baseDir, "export", "acme");
      yield* t3("org", "export", org, "--out", out);
      assert.deepEqual((yield* fs.readDirectory(out)).toSorted(), [
        "README.md",
        "decisions.md",
        "memory.md",
        "runs.md",
        "tasks.md",
        "workspace.json",
      ]);
      assert.match(yield* fs.readFileString(path.join(out, "README.md")), /^# Acme\n/);
      const project = path.join(baseDir, "project");
      yield* fs.makeDirectory(project);
      yield* fs.writeFileString(path.join(project, "README.md"), "# Project\n");
      assert.include(
        yield* failureOf(t3("org", "export", org, "--out", project)),
        `${project} is not empty.`,
      );
      assert.strictEqual(yield* fs.readFileString(path.join(project, "README.md")), "# Project\n");

      const file = path.join(baseDir, "manifest.json");
      yield* fs.writeFileString(file, "an earlier manifest\n");
      assert.include(
        yield* failureOf(t3("org", "delete", org, "--confirm", "acme", "--manifest", file)),
        "does not match",
      );
      assert.strictEqual(yield* fs.readFileString(file), "an earlier manifest\n");
      const fresh = path.join(baseDir, "fresh-manifest.json");
      assert.include(
        yield* failureOf(t3("org", "delete", org, "--confirm", "acme", "--manifest", fresh)),
        "does not match",
      );
      assert.isFalse(yield* fs.exists(fresh));
      const unwritable = path.join(baseDir, "missing", "manifest.json");
      const fileError = yield* Effect.flip(
        t3("org", "delete", org, "--confirm", "Acme", "--manifest", unwritable),
      );
      assert.instanceOf(fileError, CliError.UserError);
      assert.include(fileError.message, unwritable);
      assert.match(
        yield* t3("org", "delete", org, "--confirm", "Acme", "--manifest", file),
        /^Deleted Acme \(.+\)\.\nTABLE\s+ROWS\n/,
      );
      const manifest = yield* fs
        .readFileString(file)
        .pipe(Effect.flatMap(decodeJson(Telescope.WorkspaceDeleteManifest)));
      assert.deepEqual(manifest.tables.find(({ table }) => table === "telescope_workspaces")?.ids, [
        org,
      ]);
      const { workspaces } = yield* t3("org", "list", "--json").pipe(
        Effect.flatMap(decodeJson(Telescope.WorkspaceListResult)),
      );
      assert.deepEqual(workspaces, []);
    }),
  );

  it.effect("member invite prints a code, member list, revoke and restore manage members", () =>
    Effect.gen(function* () {
      const { t3, join } = yield* makeHome;
      const org = yield* t3("org", "init", "--name", "Acme", "--kind", "personal");
      const invitation = yield* t3(
        "member",
        "invite",
        "--org",
        org,
        "--role",
        "member",
        "--expires",
        "1h",
        "--json",
      ).pipe(Effect.flatMap(decodeJson(Telescope.Invitation)));
      assert.deepEqual(
        [invitation.role, invitation.expiresAt],
        ["member", DateTime.formatIso(DateTime.add(yield* DateTime.now, { hours: 1 }))],
      );
      const code = yield* t3("member", "invite", "--org", org, "--role", "project_lead");
      assert.notStrictEqual(code, invitation.code);
      const bob = yield* join(code, "Bob");

      const listed = yield* t3("member", "list", "--org", org);
      assert.match(listed, /^ID\s+ROLE\s+JOINED\s+STATUS\s+NAME\n/);
      assert.match(
        listed,
        new RegExp(`${bob.subjectId}\\s+project_lead\\s+\\S+\\s+active\\s+Bob$`, "m"),
      );
      assert.strictEqual(
        yield* t3("member", "revoke", "--org", org, "--member", bob.subjectId),
        `Revoked Bob (${bob.subjectId}).`,
      );
      assert.match(
        yield* t3("member", "list", "--org", org),
        new RegExp(`${bob.subjectId}\\s+project_lead\\s+\\S+\\s+revoked \\S+\\s+Bob$`, "m"),
      );
      const { members } = yield* t3("member", "list", "--org", org, "--json").pipe(
        Effect.flatMap(decodeJson(Telescope.MemberListResult)),
      );
      assert.isDefined(members.find((member) => member.subjectId === bob.subjectId)?.revokedAt);
      assert.strictEqual(
        yield* t3("member", "restore", "--org", org, "--member", bob.subjectId),
        `Restored Bob (${bob.subjectId}) as project_lead.`,
      );
      assert.match(
        yield* t3("member", "list", "--org", org),
        new RegExp(`${bob.subjectId}\\s+project_lead\\s+\\S+\\s+active\\s+Bob$`, "m"),
      );
      assert.include(
        yield* failureOf(t3("member", "restore", "--org", org, "--member", bob.subjectId)),
        "That person is already an active member.",
      );
      assert.include(
        yield* failureOf(t3("member", "restore", "--org", org, "--member", "nobody")),
        "That person was never a member of this workspace.",
      );
      for (const [expires, message] of [
        ["0s", "Invitation codes always expire."],
        ["0ms", "Invitation codes always expire."],
        ["Infinity", "Invitation codes always expire."],
        ["366d", "Invitation codes last at most 365 days."],
        ["99999999999d", "Invitation codes last at most 365 days."],
      ] as const)
        assert.include(
          yield* failureOf(
            t3("member", "invite", "--org", org, "--role", "member", "--expires", expires),
          ),
          message,
        );
      const longest = yield* t3(
        "member",
        "invite",
        "--org",
        org,
        "--role",
        "member",
        "--expires",
        "365d",
        "--json",
      ).pipe(Effect.flatMap(decodeJson(Telescope.Invitation)));
      assert.strictEqual(
        longest.expiresAt,
        DateTime.formatIso(DateTime.add(yield* DateTime.now, { days: 365 })),
      );

      assert.include(
        yield* failureOf(t3("member", "revoke", "--org", org, "--member", "owner")),
        "The environment owner is always an admin.",
      );
      assert.include(
        yield* failureOf(t3("member", "list", "--org", "no-such-workspace")),
        "You are not a member of this workspace.",
      );
    }),
  );

  it.effect("member revoke ends the member's link sessions and the links of dead codes", () =>
    Effect.gen(function* () {
      const { t3, join } = yield* makeHome;
      const listed = <S extends Schema.Top>(schema: S, ...args: ReadonlyArray<string>) =>
        t3(...args, "--json").pipe(Effect.flatMap(decodeJson(schema)));
      const org = yield* t3("org", "init", "--name", "Acme", "--kind", "enterprise");
      const invite = ["member", "invite", "--org", org, "--role", "member"];
      const invitation = yield* listed(Telescope.Invitation, ...invite);
      const label = `Telescope invite ${invitation.id}`;
      const scope = ["--scope", "telescope:member"];
      const Link = Schema.Struct({ id: Schema.String });
      const link = yield* listed(Link, "auth", "pairing", "create", ...scope, "--label", label);
      const Session = Schema.Struct({ sessionId: AuthSessionId });
      const session = yield* listed(Session, "auth", "session", "issue", ...scope);
      const bob = yield* join(invitation.code, "Bob", session.sessionId);

      yield* t3("member", "revoke", "--org", org, "--member", bob.subjectId);
      const links = yield* listed(Schema.Array(Link), "auth", "pairing", "list");
      assert.notInclude(
        links.map(({ id }) => id),
        link.id,
      );
      const sessions = yield* listed(Schema.Array(Session), "auth", "session", "list");
      assert.notInclude(
        sessions.map(({ sessionId }) => sessionId),
        session.sessionId,
      );
    }),
  );

  it.effect("role set changes a member's role and refuses the owner", () =>
    Effect.gen(function* () {
      const { t3, join } = yield* makeHome;
      const org = yield* t3("org", "init", "--name", "Acme", "--kind", "enterprise");
      const bob = yield* join(
        yield* t3("member", "invite", "--org", org, "--role", "member"),
        "Bob",
      );
      assert.strictEqual(
        yield* t3("role", "set", "--org", org, "--member", bob.subjectId, "--role", "admin"),
        `Bob (${bob.subjectId}) is now admin.`,
      );
      assert.include(
        yield* failureOf(t3("role", "set", "--org", org, "--member", "owner", "--role", "member")),
        "The environment owner is always an admin.",
      );
    }),
  );

  it.effect("project bind and unbind tie a local project to a workspace", () =>
    Effect.gen(function* () {
      const { t3, join, baseDir } = yield* makeHome;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.join(baseDir, "alpha");
      yield* fs.makeDirectory(root);
      const projectId = /^Added project (\S+) /.exec(yield* t3("project", "add", root))![1]!;
      const org = yield* t3("org", "init", "--name", "Acme", "--kind", "enterprise");
      const lead = yield* join(
        yield* t3("member", "invite", "--org", org, "--role", "project_lead"),
        "Lena",
      );
      const binding = yield* t3(
        "project",
        "bind",
        root,
        "--org",
        org,
        "--lead",
        lead.subjectId,
        "--json",
      ).pipe(Effect.flatMap(decodeJson(Telescope.ProjectBinding)));
      assert.deepEqual(
        [binding.environmentId, binding.projectId, binding.leadSubjectId],
        [
          (yield* fs.readFileString(path.join(baseDir, "userdata", "environment-id"))).trim(),
          projectId,
          lead.subjectId,
        ],
      );
      assert.include(
        yield* failureOf(t3("project", "bind", path.join(baseDir, "missing"), "--org", org)),
        "No active project found for",
      );
      assert.include(
        yield* failureOf(t3("project", "bind", projectId, "--org", org, "--lead", "nobody")),
        "That person is not an active member.",
      );
      assert.match(
        yield* t3("project", "bindings", "--org", org),
        new RegExp(`^ENVIRONMENT\\s+PROJECT\\s+LEAD\\n\\S+\\s+${projectId}\\s+${lead.subjectId}$`),
      );
      assert.strictEqual(
        yield* t3("project", "unbind", "--org", org, "--project", projectId),
        `Unbound ${projectId} from ${org}.`,
      );
      const { bindings } = yield* t3("project", "bindings", "--org", org, "--json").pipe(
        Effect.flatMap(decodeJson(Telescope.ProjectListBindingsResult)),
      );
      assert.deepEqual(bindings, []);
    }),
  );
});
