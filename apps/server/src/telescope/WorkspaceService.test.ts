import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  AuthStandardClientScopes,
  EnvironmentId,
  EventId,
  ProjectId,
  Telescope,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AgentRuntime from "./AgentRuntime.ts";
import * as AgentService from "./AgentService.ts";
import * as DelegationService from "./DelegationService.ts";
import * as GrantService from "./GrantService.ts";
import * as MemoryService from "./MemoryService.ts";
import * as RoutingService from "./RoutingService.ts";
import * as RunRecordService from "./RunRecordService.ts";
import * as TaskBoardService from "./TaskBoardService.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkerDispatch from "./WorkerDispatch.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const LOCAL_ENVIRONMENT = EnvironmentId.make("env-local");
const services = Layer.mergeAll(
  WorkspaceService.layer,
  TelescopeDb.layer,
  AuthSessions.layer,
  ProjectStore.layer,
  TaskBoardService.layer,
  AgentService.layer,
  MemoryService.layer,
  RunRecordService.layer,
  DelegationService.layer,
  GrantService.layer,
).pipe(
  Layer.provideMerge(Layer.merge(database, NodeCrypto.layer)),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(LOCAL_ENVIRONMENT),
    }),
  ),
);
const layer = Layer.merge(WorkerDispatch.layer, AgentRuntime.layer).pipe(
  Layer.provideMerge(services),
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(RoutingService.RoutingService)({}),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({ namedProjectsRoot: "/unused" }),
      Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
      ServerSettings.layerTest(),
    ),
  ),
);

const session = (name: string, proofKeyThumbprint?: string): WorkspaceService.SessionCaller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
  ...(proofKeyThumbprint === undefined ? {} : { proofKeyThumbprint }),
});
const desktop = (name: string, subject = "desktop-bootstrap"): WorkspaceService.SessionCaller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject,
});
const OWNER = WorkspaceService.OWNER_MEMBER_ID;
const runOf = (workspaceId: Telescope.WorkspaceId, memberId: string): WorkspaceService.Caller => ({
  runId: Telescope.AgentRunId.make(`run-${memberId}`),
  workspaceId,
  memberId,
});
const seedProject = (projectId: ProjectId) =>
  ProjectStore.ProjectStoreV2.pipe(
    Effect.flatMap((projects) =>
      projects.apply({
        sequence: 1,
        eventId: EventId.make(`event:${projectId}`),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: "2026-01-01T00:00:00.000Z",
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "project.created",
        payload: {
          projectId,
          title: "Local",
          workspaceRoot: "/local",
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ),
  );
const reasonOf = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => ("reason" in error ? error.reason : error._tag)),
  );

it.layer(layer)("WorkspaceService", (it) => {
  it.effect("members are devices linked to member ids, with roles and revocation", () =>
    Effect.gen(function* () {
      const service = yield* WorkspaceService.WorkspaceService;
      const [a, b, c] = [session("a"), session("b"), session("c")];
      const company = yield* service.create(a, {
        kind: "enterprise",
        name: "Acme",
        displayName: "Alice",
      });
      const personal = yield* service.create(a, {
        kind: "personal",
        name: "Alice's desk",
        displayName: "Alice",
      });
      const workspaceId = company.id;
      const invitation = yield* service.invite(a, { workspaceId, role: "member" });
      const bob = yield* service.accept(b, { code: invitation.code, displayName: "Bob" });
      const { self: alice } = yield* service.get(a, { workspaceId });

      const { members } = yield* service.members(b, { workspaceId });
      assert.deepStrictEqual(
        members.map((m) => [m.subjectId, m.displayName, m.role]).toSorted(),
        [
          [OWNER, "所有者", "admin"],
          [alice.subjectId, "Alice", "admin"],
          [bob.subjectId, "Bob", "member"],
        ].toSorted(),
      );
      assert.notStrictEqual(alice.subjectId, bob.subjectId);
      assert.strictEqual(company.createdBy, alice.subjectId);
      assert.strictEqual(invitation.invitedBy, alice.subjectId);
      assert.deepStrictEqual((yield* service.get(b, { workspaceId })).self, bob);
      assert.deepStrictEqual(
        (yield* service.list(a, {})).workspaces.map((w) => w.id).toSorted(),
        [company.id, personal.id].toSorted(),
      );
      assert.deepStrictEqual((yield* service.list(b, {})).workspaces, [company]);

      assert.deepStrictEqual((yield* service.list(c, {})).workspaces, []);
      assert.strictEqual(yield* reasonOf(service.get(c, { workspaceId })), "forbidden");
      assert.strictEqual(yield* reasonOf(service.members(c, { workspaceId })), "forbidden");
      assert.strictEqual(yield* reasonOf(service.projects(c, { workspaceId })), "forbidden");

      const second = yield* service.invite(a, { workspaceId, role: "member" });
      assert.strictEqual(
        yield* reasonOf(service.accept(b, { code: second.code, displayName: "Bob again" })),
        "conflict",
      );
      assert.strictEqual(
        yield* reasonOf(service.accept(c, { code: invitation.code, displayName: "Carol" })),
        "conflict",
      );

      const mount = {
        environmentId: EnvironmentId.make("env-1"),
        projectId: ProjectId.make("project-1"),
      };
      const { environmentId, projectId } = mount;
      assert.strictEqual(
        yield* reasonOf(
          service.setRole(b, { workspaceId, subjectId: bob.subjectId, role: "admin" }),
        ),
        "forbidden",
      );
      assert.strictEqual(
        yield* reasonOf(service.createProject(b, { workspaceId, name: "App" })),
        "forbidden",
      );
      const localMount = { environmentId: LOCAL_ENVIRONMENT, projectId: ProjectId.make("local") };
      const localProject = { workspaceId, name: "Local", mounts: [localMount] };
      assert.strictEqual(yield* reasonOf(service.createProject(a, localProject)), "not_found");
      assert.deepStrictEqual((yield* service.projects(a, { workspaceId })).projects, []);
      yield* seedProject(localMount.projectId);
      const local = yield* service.createProject(a, localProject);
      assert.deepStrictEqual([local.name, local.mounts], ["Local", [localMount]]);
      const dropLocal = { workspaceId, projectId: local.id };
      assert.strictEqual(yield* reasonOf(service.deleteProject(b, dropLocal)), "forbidden");
      yield* service.deleteProject(a, dropLocal);
      assert.strictEqual(yield* reasonOf(service.deleteProject(a, dropLocal)), "not_found");

      assert.strictEqual(
        yield* reasonOf(service.createProject(a, { workspaceId, name: "App", leadSubjectId: "x" })),
        "not_found",
      );
      const app = yield* service.createProject(a, {
        workspaceId,
        name: "App",
        leadSubjectId: bob.subjectId,
      });
      const inApp = { workspaceId, projectId: app.id, mount };
      assert.strictEqual(yield* reasonOf(service.addMount(b, inApp)), "forbidden");
      assert.deepStrictEqual(yield* service.addMount(a, inApp), { ...app, mounts: [mount] });
      const twin = yield* service.createProject(a, { workspaceId, name: "Twin", mounts: [mount] });
      assert.deepStrictEqual(
        (yield* service.projects(a, { workspaceId })).projects.map((p) => [p.name, p.mounts]),
        [
          ["App", []],
          ["Twin", [mount]],
        ],
        "a workspace mounts a directory once, so mounting it again moves it",
      );
      yield* service.addMount(a, inApp);
      yield* service.deleteProject(a, { workspaceId, projectId: twin.id });
      const renamed = yield* service.updateProject(a, {
        workspaceId,
        projectId: app.id,
        name: "App v2",
      });
      assert.deepStrictEqual(
        [renamed.name, renamed.leadSubjectId, renamed.mounts],
        ["App v2", bob.subjectId, [mount]],
      );
      assert.strictEqual(
        yield* reasonOf(service.updateProject(b, { workspaceId, projectId: app.id, name: "B" })),
        "forbidden",
      );
      assert.deepStrictEqual((yield* service.projects(b, { workspaceId })).projects, [renamed]);

      const elsewhere = yield* service.createProject(a, {
        workspaceId: personal.id,
        name: "Elsewhere",
        mounts: [mount, { environmentId, projectId: ProjectId.make("project-2") }],
      });
      assert.strictEqual(
        yield* reasonOf(service.projects(b, { workspaceId: personal.id })),
        "forbidden",
      );
      assert.deepStrictEqual(
        (yield* service.bindingSummary(b, {})).projects
          .map((p) => ({ ...p, workspaceIds: p.workspaceIds.toSorted() }))
          .toSorted((x, y) => x.projectId.localeCompare(y.projectId)),
        [
          { environmentId, projectId, workspaceIds: [company.id, personal.id].toSorted() },
          { environmentId, projectId: ProjectId.make("project-2"), workspaceIds: [personal.id] },
        ],
      );
      assert.strictEqual(yield* reasonOf(service.bindingSummary(c, {})), "forbidden");

      const board = yield* TaskBoardService.TaskBoardService;
      const ship = { workspaceId, title: "Ship", projectId: app.id };
      const task = yield* board.createTask({ caller: b }, ship);
      assert.strictEqual(
        yield* reasonOf(board.createTask({ caller: b }, { ...ship, projectId: elsewhere.id })),
        "not_found",
        "a task belongs to a project of its own workspace",
      );
      const unknown = Telescope.TelescopeProjectId.make("codi-project");
      const reassign = { workspaceId, taskId: task.id, baseVersion: task.version };
      assert.strictEqual(
        yield* reasonOf(
          board.updateTask({ caller: b }, { ...reassign, set: { projectId: unknown } }),
        ),
        "not_found",
      );
      yield* service.deleteProject(a, { workspaceId: personal.id, projectId: elsewhere.id });

      const unmount = { workspaceId, mount };
      assert.strictEqual(yield* reasonOf(service.removeMount(b, unmount)), "forbidden");
      assert.deepStrictEqual(yield* service.removeMount(a, unmount), { ...renamed, mounts: [] });
      assert.strictEqual(yield* reasonOf(service.removeMount(a, unmount)), "not_found");
      assert.deepStrictEqual((yield* service.bindingSummary(a, {})).projects, []);

      const doomed = yield* service.createProject(a, { workspaceId, name: "Doomed" });
      const filed = yield* board.createTask({ caller: b }, { ...ship, projectId: doomed.id });
      const drop = { workspaceId, projectId: doomed.id };
      assert.strictEqual(yield* reasonOf(board.deleteProject({ caller: b }, drop)), "forbidden");
      yield* board.deleteProject({ caller: a }, drop);
      const unassigned = yield* board.getTask({ caller: b }, { workspaceId, taskId: filed.id });
      assert.deepStrictEqual(
        [unassigned.projectId, unassigned.version],
        [undefined, filed.version + 1],
        "deleting a project unassigns its tasks",
      );
      assert.deepStrictEqual((yield* service.projects(a, { workspaceId })).projects, [
        { ...renamed, mounts: [] },
      ]);

      const owner = { workspaceId, subjectId: OWNER };
      assert.deepStrictEqual(
        [
          yield* reasonOf(service.setRole(a, { ...owner, role: "member" })),
          yield* reasonOf(service.revoke(a, owner)),
          yield* reasonOf(service.linkCode(a, owner)),
        ],
        ["conflict", "conflict", "conflict"],
      );

      const shortLived = yield* service.invite(a, {
        workspaceId,
        role: "member",
        expiresInSeconds: 60,
      });
      yield* TestClock.adjust("2 minutes");
      assert.strictEqual(
        yield* reasonOf(service.accept(c, { code: shortLived.code, displayName: "Carol" })),
        "expired",
      );

      const bobRun = runOf(workspaceId, bob.subjectId);
      assert.deepStrictEqual((yield* service.get(bobRun, { workspaceId })).self, bob);
      yield* service.revoke(a, { workspaceId, subjectId: bob.subjectId });
      assert.strictEqual(yield* reasonOf(service.get(bobRun, { workspaceId })), "forbidden");
      assert.deepStrictEqual(
        (yield* service.projects(a, { workspaceId })).projects.map((p) => p.leadSubjectId),
        [undefined],
        "a revoked lead leaves the project leaderless",
      );
      assert.strictEqual(yield* reasonOf(service.members(b, { workspaceId })), "forbidden");
      assert.deepStrictEqual((yield* service.list(b, {})).workspaces, []);
      const fresh = yield* service.invite(a, { workspaceId, role: "admin" });
      assert.strictEqual(
        yield* reasonOf(service.accept(b, { code: fresh.code, displayName: "Bob" })),
        "forbidden",
      );

      const bobKey = { workspaceId, subjectId: bob.subjectId };
      assert.strictEqual(yield* reasonOf(service.restore(b, bobKey)), "forbidden");
      assert.deepStrictEqual(yield* service.restore(a, bobKey), bob);
      assert.deepStrictEqual((yield* service.get(b, { workspaceId })).self, bob);
      assert.deepStrictEqual(
        [
          yield* reasonOf(service.restore(a, bobKey)),
          yield* reasonOf(service.restore(a, owner)),
          yield* reasonOf(service.restore(a, { workspaceId, subjectId: "nobody" })),
        ],
        ["conflict", "conflict", "not_found"],
      );
      const carol = yield* service
        .invite(a, { workspaceId, role: "member" })
        .pipe(Effect.flatMap(({ code }) => service.accept(c, { code, displayName: "Carol" })));
      const carolKey = { workspaceId, subjectId: carol.subjectId };
      yield* service.revoke(a, carolKey);
      assert.strictEqual(yield* reasonOf(service.restore(b, carolKey)), "forbidden");
    }),
  );

  it.effect("codes die with their issuer's admin role, and link codes add a device", () =>
    Effect.gen(function* () {
      const service = yield* WorkspaceService.WorkspaceService;
      const [a, m, n, n2, x] = [
        session("admin"),
        session("mallory"),
        session("nina"),
        session("nina-phone"),
        session("xavier"),
      ];
      const { id: workspaceId } = yield* service.create(a, {
        kind: "enterprise",
        name: "Acme",
        displayName: "Alice",
      });
      const join = (who: WorkspaceService.Caller, role: "admin" | "member", displayName: string) =>
        service
          .invite(a, { workspaceId, role })
          .pipe(Effect.flatMap(({ code }) => service.accept(who, { code, displayName })));

      const mallory = yield* join(m, "admin", "Mallory");
      const stashed = yield* service.invite(m, { workspaceId, role: "admin" });
      yield* service.revoke(a, { workspaceId, subjectId: mallory.subjectId });
      for (const who of [m, x])
        assert.strictEqual(
          yield* reasonOf(service.accept(who, { code: stashed.code, displayName: "Mallory" })),
          "expired",
        );

      const nina = yield* join(n, "admin", "Nina");
      const leftover = yield* service.invite(n, { workspaceId, role: "member" });
      yield* service.setRole(a, { workspaceId, subjectId: nina.subjectId, role: "member" });
      yield* service.setRole(a, { workspaceId, subjectId: nina.subjectId, role: "admin" });
      assert.strictEqual(
        yield* reasonOf(service.accept(x, { code: leftover.code, displayName: "Xavier" })),
        "expired",
      );
      yield* service.setRole(a, { workspaceId, subjectId: nina.subjectId, role: "member" });

      assert.strictEqual(
        yield* reasonOf(service.linkCode(n, { workspaceId, subjectId: nina.subjectId })),
        "forbidden",
      );
      const link = yield* service.linkCode(a, { workspaceId, subjectId: nina.subjectId });
      assert.strictEqual(link.forSubjectId, nina.subjectId);
      const linked = yield* service.accept(n2, { code: link.code, displayName: "ignored" });
      assert.strictEqual(linked.subjectId, nina.subjectId);
      assert.deepStrictEqual((yield* service.get(n2, { workspaceId })).self.displayName, "Nina");
      const { members } = yield* service.members(n2, { workspaceId });
      assert.deepStrictEqual(members.map((member) => member.displayName).toSorted(), [
        "Alice",
        "Mallory",
        "Nina",
        "所有者",
      ]);
    }),
  );

  it.effect("the owner administers every workspace across session rotation", () =>
    Effect.gen(function* () {
      const service = yield* WorkspaceService.WorkspaceService;
      const [launch1, launch2, paired] = [desktop("launch-1"), desktop("launch-2"), session("p")];
      const desk = yield* service.create(launch1, {
        kind: "personal",
        name: "Dev desk",
        displayName: "Dev",
      });
      const company = yield* service.create(paired, {
        kind: "enterprise",
        name: "Paired Co",
        displayName: "Pat",
      });
      assert.strictEqual(desk.createdBy, OWNER);
      for (const subject of [
        "desktop-bootstrap",
        "administrative-bootstrap",
        "reusable-dev-token",
        "reusable-dev-token-child",
      ]) {
        const { self } = yield* service.get(desktop(subject, subject), { workspaceId: desk.id });
        assert.deepStrictEqual([subject, self.subjectId], [subject, OWNER]);
      }
      assert.deepStrictEqual((yield* service.list(paired, {})).workspaces, [company]);

      const listed = (yield* service.list(launch2, {})).workspaces.map((w) => w.id);
      assert.includeMembers(listed, [desk.id, company.id]);
      for (const { id: workspaceId } of [desk, company]) {
        const { self } = yield* service.get(launch2, { workspaceId });
        assert.deepStrictEqual([self.subjectId, self.role], [OWNER, "admin"]);
        yield* service.invite(launch2, { workspaceId, role: "member" });
        yield* service.createProject(launch2, {
          workspaceId,
          name: "App",
          mounts: [{ environmentId: EnvironmentId.make("env-1"), projectId: ProjectId.make("p") }],
        });
      }
      assert.strictEqual(
        (yield* service.get(launch2, { workspaceId: desk.id })).self.displayName,
        "Dev",
      );
      const code = yield* service.invite(paired, { workspaceId: company.id, role: "member" });
      assert.strictEqual(
        yield* reasonOf(service.accept(launch2, { code: code.code, displayName: "Dev" })),
        "conflict",
      );

      const run = runOf(desk.id, OWNER);
      assert.strictEqual((yield* service.get(run, { workspaceId: desk.id })).self.subjectId, OWNER);
      const before = yield* service.list(launch2, {});
      const companyMembers = yield* service.members(paired, { workspaceId: company.id });
      assert.deepStrictEqual(
        [
          yield* reasonOf(service.get(run, { workspaceId: company.id })),
          yield* reasonOf(service.invite(run, { workspaceId: desk.id, role: "member" })),
          yield* reasonOf(service.create(run, { kind: "personal", name: "Run", displayName: "R" })),
          yield* reasonOf(service.accept(run, { code: code.code, displayName: "Run" })),
        ],
        ["forbidden", "forbidden", "forbidden", "forbidden"],
      );
      assert.deepStrictEqual(yield* service.list(launch2, {}), before);
      assert.deepStrictEqual(
        yield* service.members(paired, { workspaceId: company.id }),
        companyMembers,
      );
      yield* service.accept(session("later"), { code: code.code, displayName: "Later" });
    }),
  );

  it.effect("a device keeps its member when its proof key or cookie session is replaced", () =>
    Effect.gen(function* () {
      const service = yield* WorkspaceService.WorkspaceService;
      const sessions = yield* AuthSessions.AuthSessionRepository;
      const owner = desktop("owner");
      const { id: workspaceId } = yield* service.create(owner, {
        kind: "enterprise",
        name: "Acme",
        displayName: "Dev",
      });
      const join = (who: WorkspaceService.Caller, displayName: string) =>
        service
          .invite(owner, { workspaceId, role: "member" })
          .pipe(Effect.flatMap(({ code }) => service.accept(who, { code, displayName })));

      const phone = yield* join(session("phone-1", "jkt-phone"), "Pam");
      const repaired = session("phone-2", "jkt-phone");
      assert.deepStrictEqual((yield* service.get(repaired, { workspaceId })).self, phone);
      assert.strictEqual(yield* reasonOf(join(repaired, "Pam again")), "conflict");

      const issuedAt = yield* DateTime.now;
      const record = (sessionId: AuthSessionId) => ({
        sessionId,
        subject: "one-time-token",
        scopes: AuthStandardClientScopes,
        method: "browser-session-cookie" as const,
        client: {
          label: null,
          ipAddress: null,
          userAgent: null,
          deviceType: "desktop" as const,
          os: null,
          browser: null,
        },
        issuedAt,
        expiresAt: DateTime.add(issuedAt, { days: 30 }),
      });
      const [first, second] = [session("browser-1"), session("browser-2")];
      yield* sessions.create(record(first.sessionId));
      const browser = yield* join(first, "Bea");
      const { id: sideId } = yield* service.create(owner, {
        kind: "personal",
        name: "Side",
        displayName: "Dev",
      });
      const sideCode = yield* service.invite(owner, { workspaceId: sideId, role: "member" });
      const side = yield* service.accept(first, { code: sideCode.code, displayName: "Bea" });
      const replaced = yield* sessions.createReplacingActive({
        session: record(second.sessionId),
        revokedAt: issuedAt,
        replaceSessionId: first.sessionId,
      });
      assert.deepStrictEqual(replaced, [first.sessionId]);
      assert.deepStrictEqual(
        (yield* service.list(second, {})).workspaces.map((w) => w.id).toSorted(),
        [workspaceId, sideId].toSorted(),
      );
      assert.deepStrictEqual((yield* service.get(second, { workspaceId })).self, browser);
      assert.deepStrictEqual((yield* service.get(second, { workspaceId: sideId })).self, side);
      assert.strictEqual(yield* reasonOf(service.get(first, { workspaceId })), "forbidden");

      const db = yield* TelescopeDb.TelescopeDb;
      const link = { member_id: browser.subjectId, device_key: second.sessionId, linked_at: "x" };
      assert.strictEqual(
        yield* reasonOf(db.insert(workspaceId, "member_sessions", link)),
        "PersistenceSqlError",
      );

      // Replacing by subject can fold several linked sessions into one; none is left dangling.
      const [third, fourth, fifth] = [
        session("browser-3"),
        session("browser-4"),
        session("browser-5"),
      ];
      for (const who of [third, fourth]) yield* sessions.create(record(who.sessionId));
      const others = [yield* join(third, "Xia"), yield* join(fourth, "Yan")];
      const kept = session("browser-kept");
      yield* sessions.create({ ...record(kept.sessionId), subject: "other-subject" });
      const keptMember = yield* join(kept, "Zoe");
      const folded = yield* sessions.createReplacingActive({
        session: record(fifth.sessionId),
        revokedAt: issuedAt,
      });
      assert.sameMembers(
        [...folded],
        [second, third, fourth].map((who) => who.sessionId),
      );
      const self = (yield* service.get(fifth, { workspaceId })).self.subjectId;
      assert.include(
        [browser, ...others].map((member) => member.subjectId),
        self,
      );
      assert.deepStrictEqual((yield* service.get(fifth, { workspaceId: sideId })).self, side);
      assert.deepStrictEqual((yield* service.get(kept, { workspaceId })).self, keptMember);
      assert.deepStrictEqual((yield* service.get(repaired, { workspaceId })).self, phone);
      const decodeKeys = Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ device_key: Schema.String })),
      );
      for (const id of [workspaceId, sideId]) {
        const keys = yield* db.select(id, "member_sessions", decodeKeys);
        for (const { device_key } of keys) assert.notInclude(folded, device_key);
      }
    }),
  );

  it.effect(
    "a viewer reads the board and is refused every write; admins switch member and viewer",
    () =>
      Effect.gen(function* () {
        const service = yield* WorkspaceService.WorkspaceService;
        const board = yield* TaskBoardService.TaskBoardService;
        const agents = yield* AgentService.AgentService;
        const memory = yield* MemoryService.MemoryService;
        const runs = yield* RunRecordService.RunRecordService;
        const workers = yield* WorkerDispatch.WorkerDispatch;
        const runtime = yield* AgentRuntime.AgentRuntime;
        const grants = yield* GrantService.GrantService;
        const db = yield* TelescopeDb.TelescopeDb;
        const [owner, v] = [desktop("owner"), session("viewer")];
        const { id: workspaceId } = yield* service.create(owner, {
          kind: "enterprise",
          name: "Acme",
          displayName: "Olive",
        });
        const { code } = yield* service.invite(owner, { workspaceId, role: "viewer" });
        const viewer = yield* service.accept(v, { code, displayName: "Vic" });
        assert.strictEqual(viewer.role, "viewer");
        const as = { caller: v };
        const target = { workspaceId, subjectId: viewer.subjectId };
        yield* service.setRole(owner, { ...target, role: "member" });
        const task = yield* board.createTask(as, { workspaceId, title: "夹爪" });
        const lease = yield* board.acquireLease(as, { workspaceId, taskId: task.id });
        const free = yield* board.createTask({ caller: owner }, { workspaceId, title: "螺丝" });
        yield* service.setRole(owner, { ...target, role: "viewer" });
        const { version } = yield* board.getTask(as, { workspaceId, taskId: task.id });
        // An agent made for this member before invites stopped creating them.
        const agentId = Telescope.AgentId.make("vic-pa");
        yield* db.insert(workspaceId, "agents", {
          agent_id: agentId,
          owner_subject_id: viewer.subjectId,
          kind: "chief_of_staff",
          name: "Vic PA",
          standing_powers_json: JSON.stringify({
            openTickets: true,
            dispatchWorkers: true,
            answerMembers: true,
            mergePRs: false,
          }),
          exposure: "hidden",
          sync_with_board: 0,
          dispatch_mode: "inbox",
          channels_json: "[]",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        });
        const leaseRef = { workspaceId, leaseId: lease.id };
        const writes = [
          ["task.create", board.createTask(as, { workspaceId, title: "新任务" })],
          [
            "task.update",
            board.updateTask(as, { workspaceId, taskId: task.id, baseVersion: version }),
          ],
          ["decision.create", board.createDecision(as, { workspaceId, title: "定", text: "是" })],
          ["lease.acquire", board.acquireLease(as, { workspaceId, taskId: free.id })],
          ["lease.heartbeat", board.heartbeatLease(as, leaseRef)],
          ["lease.release", board.releaseLease(as, leaseRef)],
          ["agent.createCustom", agents.createCustom(v, { workspaceId, name: "Helper" })],
          ["agent.update", agents.update(v, { workspaceId, agentId, name: "Renamed" })],
          ["agent.openThread", runtime.openThread(v, { workspaceId, agentId })],
          [
            "memory.write",
            memory.write({ session: v }, { workspaceId, agentId, op: "add", text: "记住" }),
          ],
          [
            "run.start",
            runs.start(v, workspaceId, {
              agentId,
              inputSnapshot: {
                promptVersion: "p1",
                skillsVersions: {},
                powersVersion: "w1",
                model: "replay",
                contextManifest: [],
              },
            }),
          ],
          [
            "delegation.cancel",
            workers.cancelForMember(v, {
              workspaceId,
              delegationId: Telescope.DelegationId.make("d-1"),
            }),
          ],
          [
            "agent run task.update",
            board.updateTask(
              { caller: runOf(workspaceId, viewer.subjectId) },
              { workspaceId, taskId: task.id, baseVersion: version, note: "进展" },
            ),
          ],
        ] as const;
        const refusals: Array<readonly [string, unknown]> = [];
        for (const [write, effect] of writes)
          refusals.push([write, yield* reasonOf(effect).pipe(Effect.orElseSucceed(() => "ok"))]);
        assert.deepStrictEqual(
          refusals,
          writes.map(([write]) => [write, "forbidden"] as const),
        );
        const grant = yield* grants.effectiveGrant(workspaceId, {
          agentId,
          onBehalfOf: [viewer.subjectId],
        });
        assert.deepStrictEqual(Object.values(grant.powers), [false, false, false, false]);

        const { tasks } = yield* board.listTasks(as, { workspaceId });
        assert.deepStrictEqual(tasks.map((t) => t.title).toSorted(), ["夹爪", "螺丝"].toSorted());
        assert.strictEqual(
          yield* reasonOf(
            service.setRole(owner, { workspaceId, subjectId: OWNER, role: "viewer" }),
          ),
          "conflict",
        );
      }),
  );
});
