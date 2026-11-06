import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, Telescope } from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { cli } from "../binCli.ts";
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
  const join = (code: string, displayName: string) =>
    WorkspaceService.WorkspaceService.pipe(
      Effect.flatMap((service) =>
        service.accept(
          { sessionId: AuthSessionId.make(`device-${displayName}`), subject: "one-time-token" },
          { code, displayName },
        ),
      ),
      Effect.provide(
        WorkspaceService.layer.pipe(
          Layer.provide(
            SqlitePersistence.layerFromPath(path.join(baseDir, "userdata", "statev2.sqlite")),
          ),
        ),
      ),
    );
  return { t3, join, baseDir };
});

const failureOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => String(error instanceof Error ? error.message : error)),
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

  it.effect("member invite prints a code, member list and revoke manage members", () =>
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
      assert.strictEqual(invitation.role, "member");
      const code = yield* t3("member", "invite", "--org", org, "--role", "project_lead");
      assert.notStrictEqual(code, invitation.code);
      const bob = yield* join(code, "Bob");

      const listed = yield* t3("member", "list", "--org", org);
      assert.match(listed, /^ID\s+ROLE\s+JOINED\s+STATUS\s+NAME\n/);
      assert.include(listed, "project_lead");
      assert.strictEqual(
        yield* t3("member", "revoke", "--org", org, "--member", bob.subjectId),
        `Revoked Bob (${bob.subjectId}).`,
      );
      const { members } = yield* t3("member", "list", "--org", org, "--json").pipe(
        Effect.flatMap(decodeJson(Telescope.MemberListResult)),
      );
      assert.isDefined(members.find((member) => member.subjectId === bob.subjectId)?.revokedAt);

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
