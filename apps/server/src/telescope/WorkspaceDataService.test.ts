import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, Telescope } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ContextAssembler from "./ContextAssembler.ts";
import * as TelescopeDb from "./TelescopeDb.ts";
import * as WorkspaceDataService from "./WorkspaceDataService.ts";
import * as WorkspaceService from "./WorkspaceService.ts";

const database = Layer.effectDiscard(runMigrations()).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const services = (random: Layer.Layer<SecureRandom.SecureRandom>) =>
  Layer.mergeAll(WorkspaceDataService.layer, WorkspaceService.layer, TelescopeDb.layer).pipe(
    Layer.provideMerge(Layer.merge(database, random)),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "telescope-data-test-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Layer.provide(
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("env-local")),
      }),
    ),
  );
const layer = services(NodeCrypto.layer);

const session = (name: string): WorkspaceService.SessionCaller => ({
  sessionId: AuthSessionId.make(`session-${name}`),
  subject: "one-time-token",
});
const reasonOf = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => ("reason" in error ? error.reason : error._tag)),
  );
const decodeBundle = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      withheld: Schema.Record(Schema.String, Schema.Number),
      tables: Schema.Record(
        Schema.String,
        Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
      ),
    }),
  ),
);
const decodeMemoryIds = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ memory_id: Schema.String })),
);
const bundleOf = (files: ReadonlyArray<{ readonly path: string; readonly text: string }>) =>
  decodeBundle(files.find((file) => file.path === "workspace.json")?.text);

/** `telescope_` tables of the given `pragma_table_list` types, by name. */
const telescopeTables = (...types: ReadonlyArray<string>) =>
  SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) => sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_list
        WHERE name LIKE 'telescope\\_%' ESCAPE '\\' AND ${sql.in("type", types)} ORDER BY name`,
    ),
    Effect.map((rows) => rows.map((row) => row.name)),
  );
/** Fills every column, text ones with their name and `tag`, then applies `row`. */
const seed = (
  workspaceId: string,
  table: string,
  tag: string,
  row: Readonly<Record<string, string | number | null>> = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{ readonly name: string; readonly type: string }>`
      SELECT name, type FROM pragma_table_info(${table})`;
    const filled = Object.fromEntries(
      columns.map(({ name, type }) => [name, type === "TEXT" ? `${name} ${tag}` : 0] as const),
    );
    yield* sql`INSERT INTO ${sql(table)} ${sql.insert({ ...filled, ...row, workspace_id: workspaceId })}`;
  });
/** A workspace `caller` created, with one more row in every other Telescope table. */
const seededWorkspace = (caller: WorkspaceService.Caller, name: string, tag: string) =>
  Effect.gen(function* () {
    const service = yield* WorkspaceService.WorkspaceService;
    const workspace = yield* service.create(caller, {
      kind: "enterprise",
      name,
      displayName: name,
    });
    for (const table of yield* telescopeTables("table")) {
      // A company agent, which every admin sees, so no row of its own is withheld.
      const row = table === "telescope_agents" ? { owner_subject_id: null } : {};
      if (table !== "telescope_workspaces") yield* seed(workspace.id, table, tag, row);
    }
    return workspace;
  });
const rowCounts = (workspaceId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const counts: Array<readonly [string, number]> = [];
    for (const table of yield* telescopeTables("table")) {
      const [row] = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM ${sql(table)} WHERE workspace_id = ${workspaceId}`;
      counts.push([table, row?.count ?? 0]);
    }
    return counts;
  });

/** A run acting for an admin passes the admin check, so only sessions reach export and delete. */
export const runsRefusedAtCompileTime = (
  data: WorkspaceDataService.WorkspaceDataService["Service"],
  run: Exclude<WorkspaceService.Caller, WorkspaceService.SessionCaller>,
) => [
  // @ts-expect-error a run exports its workspace
  data.export(run, { workspaceId: run.workspaceId }),
  // @ts-expect-error a run deletes its workspace
  data.delete(run, { workspaceId: run.workspaceId, confirmName: "Acme" }),
];

it.layer(layer)("WorkspaceDataService", (it) => {
  it.effect("exports one workspace's rows by table and as Markdown, and none of another's", () =>
    Effect.gen(function* () {
      const data = yield* WorkspaceDataService.WorkspaceDataService;
      const alice = session("export-alice");
      const alpha = yield* seededWorkspace(alice, "Alpha", "export-alpha");
      const bravo = yield* seededWorkspace(session("export-bob"), "Bravo", "export-bravo");
      yield* seed(alpha.id, "telescope_tasks", "export-task", {
        item_id: "export-task",
        kind: "task",
        title: "Ship the export",
        status: "doing",
      });
      yield* seed(alpha.id, "telescope_task_commits", "export-task", {
        task_id: "export-task",
        changed_fields_json: '{"status":"doing"}',
      });
      yield* seed(alpha.id, "telescope_tasks", "export-decision", {
        kind: "decision",
        title: "Keep SQLite",
        options_json: '[{"label":"SQLite"},{"label":"Postgres"}]',
      });

      const { files } = yield* data.export(alice, { workspaceId: alpha.id });
      const text = new Map(files.map((file) => [file.path, file.text]));
      assert.deepStrictEqual(
        [...text.keys()],
        ["README.md", "workspace.json", "tasks.md", "decisions.md", "memory.md", "runs.md"],
      );
      for (const file of files) {
        assert.notInclude(file.text, "export-bravo");
        assert.notInclude(file.text, bravo.id);
      }
      const counts = new Map(yield* rowCounts(alpha.id));
      for (const [table, rows] of Object.entries((yield* bundleOf(files)).tables)) {
        assert.strictEqual(rows.length, counts.get(table), table);
        for (const row of rows) assert.strictEqual(row.workspace_id, alpha.id, table);
      }
      assert.include(text.get("tasks.md"), "## Ship the export\n- Status: doing");
      assert.include(text.get("tasks.md"), "author_id export-task: status doing");
      assert.include(text.get("decisions.md"), "- Options: SQLite, Postgres");
      assert.include(text.get("memory.md"), "text export-alpha");
      assert.include(text.get("runs.md"), "## Run run_id export-alpha");
      assert.include(text.get("runs.md"), "tool export-alpha");
    }),
  );

  it.effect("exports every Telescope table or names the reason it leaves one out", () =>
    Effect.gen(function* () {
      const data = yield* WorkspaceDataService.WorkspaceDataService;
      const alice = session("coverage-alice");
      const workspace = yield* seededWorkspace(alice, "Coverage", "coverage");
      const { tables } = yield* bundleOf(
        (yield* data.export(alice, { workspaceId: workspace.id })).files,
      );
      const missing = (yield* telescopeTables("table", "virtual")).filter(
        (table) => !(table in tables) && !(table in WorkspaceDataService.NOT_EXPORTED),
      );
      assert.deepStrictEqual(missing, []);
    }),
  );

  it.effect(
    "leaves out invitation codes, memories and agents the app hides, and only their unread rows",
    () =>
      Effect.gen(function* () {
        const service = yield* WorkspaceService.WorkspaceService;
        const data = yield* WorkspaceDataService.WorkspaceDataService;
        const [alice, bob, carol] = [
          session("private-alice"),
          session("private-bob"),
          session("private-carol"),
        ];
        const { id: workspaceId } = yield* service.create(alice, {
          kind: "enterprise",
          name: "Private",
          displayName: "Alice",
        });
        const used = yield* service.invite(alice, { workspaceId, role: "admin" });
        const { subjectId: bobId } = yield* service.accept(bob, {
          code: used.code,
          displayName: "Bob",
        });
        const carolCode = yield* service.invite(alice, { workspaceId, role: "member" });
        const { subjectId: carolId } = yield* service.accept(carol, {
          code: carolCode.code,
          displayName: "Carol",
        });
        yield* service.revoke(alice, { workspaceId, subjectId: carolId });
        const unused = yield* service.invite(alice, { workspaceId, role: "member" });
        const aliceId = (yield* service.get(alice, { workspaceId })).self.subjectId;
        yield* seed(workspaceId, "telescope_project_bindings", "bound", { project_id: "bound" });
        for (const [agent, owner, exposure, project] of [
          ["agent-alice", aliceId, "hidden", null],
          ["agent-bob", bobId, "hidden", null],
          ["agent-shared", bobId, "visible", null],
          ["agent-company", null, "hidden", null],
          ["agent-carol", carolId, "visible", null],
          ["agent-chief", bobId, "visible", "unbound"],
          ["agent-chief-bound", bobId, "visible", "bound"],
        ] as const) {
          yield* seed(workspaceId, "telescope_agents", agent, {
            agent_id: agent,
            owner_subject_id: owner,
            exposure,
            ...(project === null ? {} : { kind: "chief_agent", project_id: project }),
          });
        }
        for (const [id, agent, level, about] of [
          ["own-private", "agent-alice", "private", null],
          ["bob-private", "agent-bob", "private", null],
          ["about-alice", "agent-bob", "internal", aliceId],
          ["about-bob", "agent-alice", "internal", bobId],
        ] as const) {
          yield* seed(workspaceId, "telescope_memories", id, {
            memory_id: id,
            agent_id: agent,
            level,
            scope: about === null ? "personal" : "person",
            about_subject_id: about,
          });
        }
        const via = (agent: string) => JSON.stringify([aliceId, agent]);
        for (const [table, id, row] of [
          ["delegations", "to-bob", { from_agent_id: "agent-alice", to_agent_id: "agent-bob" }],
          [
            "delegations",
            "to-shared",
            { from_agent_id: "agent-alice", to_agent_id: "agent-shared" },
          ],
          ["runs", "run-bob", { run_id: "run-bob", agent_id: "agent-bob" }],
          ["runs", "run-via", { agent_id: "agent-shared", on_behalf_of_json: via("agent-bob") }],
          ["runs", "run-shared", { run_id: "run-shared", agent_id: "agent-shared" }],
          ["run_calls", "call-bob", { run_id: "run-bob" }],
          ["run_calls", "call-shared", { run_id: "run-shared" }],
          ["audit", "audit-carol", { agent_id: "agent-carol" }],
          ["grants", "grant-bob", { on_behalf_of_json: via("agent-bob") }],
          ["wakes", "wake-bob", { agent_id: "agent-bob" }],
          ["leases", "lease-bob", { holder_agent_id: "agent-bob" }],
          ["kill_switches", "kill-chief", { agent_id: "agent-chief" }],
          ["channel_bindings", "binding-carol", { agent_id: "agent-carol" }],
          ["budgets", "budget-bob", { scope: "agent", scope_id: "agent-bob" }],
          ["budgets", "budget-shared", { scope: "agent", scope_id: "agent-shared" }],
        ] as const) {
          yield* seed(workspaceId, `telescope_${table}`, id, row);
        }

        const { files } = yield* data.export(alice, { workspaceId });
        const bundle = yield* bundleOf(files);
        assert.deepStrictEqual(
          bundle.tables.telescope_memories?.map((row) => row.memory_id),
          ["own-private", "about-alice"],
        );
        const agentIds = (tables: typeof bundle.tables) =>
          tables.telescope_agents?.map((row) => row.agent_id);
        assert.deepStrictEqual(agentIds(bundle.tables), [
          "agent-alice",
          "agent-shared",
          "agent-company",
          "agent-chief-bound",
        ]);
        assert.deepStrictEqual(
          bundle.tables.telescope_delegations?.map((row) => row.to_agent_id),
          ["agent-shared"],
        );
        // The app's run, audit, governance, wake and lease reads show these rows to an admin.
        assert.deepStrictEqual(
          bundle.tables.telescope_runs?.map((row) => row.run_id),
          ["run-bob", "run_id run-via", "run-shared"],
        );
        assert.deepStrictEqual(
          bundle.tables.telescope_run_calls?.map((row) => row.run_id),
          ["run-bob", "run-shared"],
        );
        assert.deepStrictEqual(
          bundle.tables.telescope_budgets?.map((row) => row.scope_id),
          ["agent-bob", "agent-shared"],
        );
        assert.deepStrictEqual(bundle.withheld, {
          telescope_agents: 3,
          telescope_grants: 1,
          telescope_memories: 2,
          telescope_channel_bindings: 1,
          telescope_delegations: 1,
        });
        const readme = files.find((file) => file.path === "README.md")?.text;
        assert.include(readme, "\n- 2 memories the exporting member cannot read");
        assert.include(readme, "\n- 3 agents the app hides from the exporting member");
        assert.include(
          readme,
          "\n- Rows of those agents: telescope_grants 1, telescope_channel_bindings 1, telescope_delegations 1.",
        );
        assert.deepStrictEqual(
          bundle.tables.telescope_invitations?.map((row) => "code" in row),
          [false, false, false],
        );
        for (const file of files) {
          assert.notInclude(file.text, used.code);
          assert.notInclude(file.text, unused.code);
          assert.notInclude(file.text, "bob-private");
          assert.notInclude(file.text, "name agent-bob");
          assert.notInclude(file.text, "name agent-carol");
        }
        const bobs = yield* bundleOf((yield* data.export(bob, { workspaceId })).files);
        assert.deepStrictEqual(agentIds(bobs.tables), [
          "agent-bob",
          "agent-shared",
          "agent-company",
          "agent-chief",
          "agent-chief-bound",
        ]);
        assert.deepStrictEqual(
          bobs.tables.telescope_runs?.map((row) => row.run_id),
          ["run-bob", "run_id run-via", "run-shared"],
        );
      }),
  );

  it.effect("refuses an export over the size cap and points to the CLI", () =>
    Effect.gen(function* () {
      const service = yield* WorkspaceService.WorkspaceService;
      const data = yield* WorkspaceDataService.WorkspaceDataService;
      const alice = session("large-alice");
      const { id: workspaceId } = yield* service.create(alice, {
        kind: "enterprise",
        name: "Large",
        displayName: "Alice",
      });
      yield* seed(workspaceId, "telescope_tasks", "large", {
        kind: "task",
        title: "x".repeat(Telescope.WORKSPACE_EXPORT_MAX_BYTES),
      });
      const refusal = yield* Effect.flip(data.export(alice, { workspaceId }));
      assert.strictEqual(refusal._tag, "TelescopeWorkspaceError");
      assert.include(refusal.message, "over the 10.0 MiB the app downloads");
      assert.include(refusal.message, `t3 org export ${workspaceId} --out <directory>`);
      const { files } = yield* data.export(
        alice,
        { workspaceId },
        { maxBytes: Number.POSITIVE_INFINITY },
      );
      assert.include(files.find((file) => file.path === "tasks.md")?.text, "x".repeat(1000));
    }),
  );

  it.effect("deletes every row of one workspace, then its context files, and lists them", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const db = yield* TelescopeDb.TelescopeDb;
      const service = yield* WorkspaceService.WorkspaceService;
      const data = yield* WorkspaceDataService.WorkspaceDataService;
      const alice = session("delete-alice");
      const alpha = yield* seededWorkspace(alice, "Alpha", "delete-alpha");
      const bravo = yield* seededWorkspace(alice, "Bravo", "delete-bravo");
      yield* seed(alpha.id, "telescope_runs", "open", { run_id: "open-run", finished_at: null });
      yield* seed(alpha.id, "telescope_wakes", "queued", { wake_id: "queued", status: "queued" });
      yield* seed(alpha.id, "telescope_wakes", "running", {
        wake_id: "running",
        status: "running",
      });
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir } = yield* ServerConfig;
      yield* seed(alpha.id, "telescope_runs", "stuck", { run_id: "stuck-run" });
      const [alphaContext, bravoContext, stuckContext] = [
        "run_id delete-alpha",
        "run_id delete-bravo",
        "stuck-run",
      ].map((runId) => ContextAssembler.contextFile(path, stateDir, runId)) as [
        string,
        string,
        string,
      ];
      yield* fs.makeDirectory(path.dirname(alphaContext), { recursive: true });
      for (const file of [alphaContext, bravoContext]) yield* fs.writeFileString(file, "context");
      // A non-empty directory where a context file should be cannot be removed as a file.
      yield* fs.makeDirectory(stuckContext);
      yield* fs.writeFileString(path.join(stuckContext, "inside"), "context");
      const alphaBefore = yield* rowCounts(alpha.id);
      const bravoBefore = yield* rowCounts(bravo.id);
      const confirm = { workspaceId: alpha.id, confirmName: "Alpha" };

      assert.strictEqual(
        yield* reasonOf(data.delete(alice, { ...confirm, confirmName: "alpha" })),
        "invalid",
      );
      const busy = yield* data.delete(alice, confirm).pipe(
        Effect.map(() => ["deleted"]),
        Effect.catchTags({
          TelescopeWorkspaceBusyError: (error) =>
            Effect.succeed([...error.runIds, ...error.wakeIds].map(String)),
        }),
      );
      assert.deepStrictEqual(busy.toSorted(), ["open-run", "queued", "running"]);
      assert.deepStrictEqual(yield* rowCounts(alpha.id), alphaBefore);
      assert.isTrue(yield* fs.exists(alphaContext));

      yield* sql`UPDATE telescope_runs SET finished_at = 'later' WHERE run_id = 'open-run'`;
      yield* sql`UPDATE telescope_wakes SET status = 'done' WHERE wake_id IN ('queued', 'running')`;
      const manifest = yield* data.delete(alice, confirm);
      assert.strictEqual(manifest.workspace.id, alpha.id);
      assert.deepStrictEqual(manifest.contextFiles, [path.relative(stateDir, alphaContext)]);
      assert.deepStrictEqual(
        manifest.contextFilesLeft.map((file) => file.path),
        [path.relative(stateDir, stuckContext)],
      );
      assert.isNotEmpty(manifest.contextFilesLeft[0]?.reason);
      assert.isTrue(yield* fs.exists(stuckContext));
      assert.isFalse(yield* fs.exists(alphaContext));
      assert.isTrue(yield* fs.exists(bravoContext));
      assert.deepStrictEqual(
        manifest.tables.map(({ table, count }) => [table, count] as const).toSorted(),
        alphaBefore.toSorted(),
      );
      for (const { table, count, ids } of manifest.tables) {
        assert.strictEqual(new Set(ids).size, count, table);
      }
      const idsOf = (name: string) =>
        manifest.tables.find(({ table }) => table === name)?.ids ?? [];
      assert.include(idsOf("telescope_memories"), "memory_id delete-alpha");
      assert.include(idsOf("telescope_budgets"), "scope delete-alpha/scope_id delete-alpha");
      assert.isTrue((yield* rowCounts(alpha.id)).every(([, count]) => count === 0));
      assert.deepStrictEqual(yield* rowCounts(bravo.id), bravoBefore);
      const search = (workspaceId: typeof alpha.id, query: string) =>
        db.searchMemories(workspaceId, query, decodeMemoryIds, { where: {}, validAt: undefined });
      assert.deepStrictEqual(yield* search(alpha.id, "delete-alpha"), []);
      assert.deepStrictEqual(yield* search(bravo.id, "delete-bravo"), [
        { memory_id: "memory_id delete-bravo" },
      ]);
      assert.deepStrictEqual(
        (yield* service.list(alice, {})).workspaces.map((workspace) => workspace.id),
        [bravo.id],
      );

      const again = yield* service.create(alice, {
        kind: "enterprise",
        name: "Alpha",
        displayName: "Alice",
      });
      const { tables } = yield* bundleOf(
        (yield* data.export(alice, { workspaceId: again.id })).files,
      );
      for (const table of ["telescope_tasks", "telescope_memories", "telescope_runs"]) {
        assert.deepStrictEqual(tables[table], [], table);
      }
    }),
  );

  it.effect("lets only workspace admins export or delete", () =>
    Effect.gen(function* () {
      const service = yield* WorkspaceService.WorkspaceService;
      const data = yield* WorkspaceDataService.WorkspaceDataService;
      const [alice, bob] = [session("admin-alice"), session("admin-bob")];
      const { id: workspaceId } = yield* service.create(alice, {
        kind: "enterprise",
        name: "Acme",
        displayName: "Alice",
      });
      const { code } = yield* service.invite(alice, { workspaceId, role: "member" });
      yield* service.accept(bob, { code, displayName: "Bob" });
      for (const caller of [bob, session("admin-stranger")]) {
        assert.strictEqual(yield* reasonOf(data.export(caller, { workspaceId })), "forbidden");
        assert.strictEqual(
          yield* reasonOf(data.delete(caller, { workspaceId, confirmName: "Acme" })),
          "forbidden",
        );
      }
    }),
  );
});

it.effect("adds no rows to a workspace deleted between a write's member check and its insert", () =>
  Effect.gen(function* () {
    const paused = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    // Only invitation codes draw random bytes, after invite's member check and before its insert.
    const gated = Layer.effect(
      SecureRandom.SecureRandom,
      SecureRandom.SecureRandom.use((random) =>
        Effect.succeed({
          ...random,
          randomBytes: (size: number) =>
            Deferred.succeed(paused, undefined).pipe(
              Effect.andThen(Deferred.await(resume)),
              Effect.andThen(random.randomBytes(size)),
            ),
        }),
      ),
    ).pipe(Layer.provide(NodeCrypto.layer));
    yield* Effect.gen(function* () {
      const db = yield* TelescopeDb.TelescopeDb;
      const service = yield* WorkspaceService.WorkspaceService;
      const data = yield* WorkspaceDataService.WorkspaceDataService;
      const alice = session("late-alice");
      const { id: workspaceId } = yield* service.create(alice, {
        kind: "enterprise",
        name: "Late",
        displayName: "Alice",
      });
      const invite = yield* Effect.forkChild(
        service.invite(alice, { workspaceId, role: "member" }),
      );
      yield* Deferred.await(paused);
      yield* data.delete(alice, { workspaceId, confirmName: "Late" });
      yield* Deferred.succeed(resume, undefined);
      assert.strictEqual((yield* Effect.flip(Fiber.join(invite)))._tag, "PersistenceSqlError");
      const at = "2026-11-07T00:00:00.000Z";
      const task = { item_id: "late", kind: "task", title: "Late", status: "todo" };
      const late = db.insert(workspaceId, "tasks", { ...task, created_at: at, updated_at: at });
      assert.strictEqual((yield* Effect.flip(late))._tag, "PersistenceSqlError");
      assert.isTrue((yield* rowCounts(workspaceId)).every(([, count]) => count === 0));
    }).pipe(Effect.provide(services(gated)));
  }),
);
