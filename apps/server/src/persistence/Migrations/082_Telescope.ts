import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Every Telescope table, shaped by `@t3tools/contracts` Telescope schemas. Each row carries
 * `workspace_id`, which TelescopeDb filters on. JSON columns are TEXT; booleans are 0/1.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE telescope_workspaces (
    workspace_id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
    created_at TEXT NOT NULL, created_by TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE telescope_members (
    workspace_id TEXT NOT NULL, subject_id TEXT NOT NULL, display_name TEXT NOT NULL,
    role TEXT NOT NULL, joined_at TEXT NOT NULL, revoked_at TEXT,
    PRIMARY KEY (workspace_id, subject_id)
  )`;
  yield* sql`CREATE INDEX telescope_members_subject ON telescope_members (subject_id)`;
  yield* sql`CREATE TABLE telescope_invitations (
    invitation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL, invited_by TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_by TEXT,
    accepted_at TEXT
  )`;
  yield* sql`CREATE TABLE telescope_project_bindings (
    workspace_id TEXT NOT NULL, environment_id TEXT NOT NULL, project_id TEXT NOT NULL,
    lead_subject_id TEXT, PRIMARY KEY (workspace_id, environment_id, project_id)
  )`;
  yield* sql`CREATE TABLE telescope_agents (
    agent_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, owner_subject_id TEXT,
    kind TEXT NOT NULL, project_id TEXT, name TEXT NOT NULL, model_selection_json TEXT,
    standing_powers_json TEXT NOT NULL, exposure TEXT NOT NULL,
    sync_with_board INTEGER NOT NULL, dispatch_mode TEXT NOT NULL, channels_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  // Tasks and decisions share one board; decision-only columns are null on tasks and vice versa.
  yield* sql`CREATE TABLE telescope_tasks (
    item_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, project_id TEXT,
    title TEXT NOT NULL, status TEXT NOT NULL, owner_subject_id TEXT, owner_agent_id TEXT,
    lease_id TEXT, forge_issue_json TEXT, thread_id TEXT,
    goal_chain_json TEXT NOT NULL DEFAULT '[]', free_text_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 0, text TEXT, supersedes TEXT, author_id TEXT,
    options_json TEXT, chosen TEXT, decided_by TEXT, decided_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE telescope_task_commits (
    commit_id TEXT PRIMARY KEY, parent_id TEXT, workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL, run_id TEXT, author_id TEXT NOT NULL, on_behalf_of_json TEXT,
    device_sig TEXT,
    base_version INTEGER NOT NULL, changed_fields_json TEXT NOT NULL,
    merge_level INTEGER NOT NULL, merge_reason TEXT, created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX telescope_task_commits_task ON telescope_task_commits (task_id, created_at)`;
  yield* sql`CREATE TABLE telescope_leases (
    lease_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE,
    holder_agent_id TEXT NOT NULL, holder_subject_id TEXT NOT NULL, acquired_at TEXT NOT NULL,
    heartbeat_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE telescope_grants (
    grant_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, on_behalf_of_json TEXT NOT NULL,
    files_json TEXT NOT NULL, home_dirs_json TEXT NOT NULL, tools_json TEXT NOT NULL,
    hosts_json TEXT NOT NULL, secret_handles_json TEXT NOT NULL, skills_json TEXT NOT NULL,
    budget_json TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
  )`;
  yield* sql`CREATE TABLE telescope_audit (
    audit_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, grant_id TEXT NOT NULL,
    on_behalf_of_json TEXT NOT NULL, tool TEXT NOT NULL, args_redacted_json TEXT NOT NULL,
    outcome TEXT NOT NULL, reason TEXT, at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE telescope_budgets (
    workspace_id TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT NOT NULL,
    limit_tokens INTEGER, limit_usd REAL, used_tokens INTEGER NOT NULL DEFAULT 0,
    used_usd REAL NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, scope, scope_id)
  )`;
  yield* sql`CREATE TABLE telescope_kill_switches (
    workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL, state TEXT NOT NULL,
    by_subject_id TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (workspace_id, agent_id)
  )`;
  yield* sql`CREATE TABLE telescope_wakes (
    wake_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, reason TEXT NOT NULL,
    agent_id TEXT NOT NULL, coalesce_key TEXT NOT NULL, priority INTEGER NOT NULL,
    subject_id TEXT NOT NULL, thread_id TEXT, task_id TEXT, project_id TEXT,
    payload_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
    started_at TEXT, finished_at TEXT
  )`;
  yield* sql`CREATE INDEX telescope_wakes_queue ON telescope_wakes (status, priority, created_at)`;
  yield* sql`CREATE INDEX telescope_wakes_coalesce ON telescope_wakes (coalesce_key, status)`;
  yield* sql`CREATE TABLE telescope_runs (
    run_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL, wake_id TEXT,
    grant_id TEXT, on_behalf_of_json TEXT NOT NULL, input_snapshot_json TEXT NOT NULL,
    started_at TEXT NOT NULL, finished_at TEXT, orchestration_event_id TEXT, thread_id TEXT,
    result_labels_json TEXT NOT NULL DEFAULT '[]', input_tokens INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    output_summary TEXT
  )`;
  yield* sql`CREATE INDEX telescope_runs_agent ON telescope_runs (agent_id, started_at)`;
  yield* sql`CREATE TABLE telescope_run_calls (
    call_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, run_id TEXT NOT NULL,
    seq INTEGER NOT NULL, tool TEXT NOT NULL, args_json TEXT NOT NULL, grant_id TEXT,
    grant_check TEXT NOT NULL, tokens INTEGER, duration_ms INTEGER NOT NULL, at TEXT NOT NULL,
    UNIQUE (run_id, seq)
  )`;
  yield* sql`CREATE TABLE telescope_memories (
    memory_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL,
    scope TEXT NOT NULL, layer TEXT NOT NULL, level TEXT NOT NULL, project_id TEXT,
    about_subject_id TEXT, kind TEXT NOT NULL, text TEXT NOT NULL, source_json TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0, valid_from TEXT NOT NULL, invalid_at TEXT,
    last_retrieved_at TEXT, uses INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0
  )`;
  // Builds without FTS5 or the trigram tokenizer fail with SQLITE_ERROR; memory search scans then.
  // Keyed by memory_id rather than rowid, which VACUUM may renumber.
  const fts = yield* sql`CREATE VIRTUAL TABLE telescope_memories_fts USING fts5(
    memory_id UNINDEXED,
    workspace_id UNINDEXED,
    text,
    tokenize = 'trigram'
  )`.pipe(
    Effect.as(true),
    Effect.catchIf(
      (cause) =>
        Predicate.hasProperty(cause.reason.cause, "errcode") && cause.reason.cause.errcode === 1,
      (cause) =>
        Effect.logWarning("Telescope memory index unavailable; search will scan.", cause).pipe(
          Effect.as(false),
        ),
    ),
  );
  if (fts) {
    yield* sql`CREATE TRIGGER telescope_memories_fts_insert AFTER INSERT ON telescope_memories BEGIN
      INSERT INTO telescope_memories_fts (memory_id, workspace_id, text)
      VALUES (new.memory_id, new.workspace_id, new.text);
    END`;
    yield* sql`CREATE TRIGGER telescope_memories_fts_update AFTER UPDATE OF text ON telescope_memories BEGIN
      UPDATE telescope_memories_fts SET text = new.text WHERE memory_id = old.memory_id;
    END`;
    yield* sql`CREATE TRIGGER telescope_memories_fts_delete AFTER DELETE ON telescope_memories BEGIN
      DELETE FROM telescope_memories_fts WHERE memory_id = old.memory_id;
    END`;
  }
  yield* sql`CREATE TABLE telescope_routing_rules (
    rule_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT,
    task_type TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL,
    priority INTEGER NOT NULL
  )`;
  yield* sql`CREATE TABLE telescope_channel_bindings (
    binding_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, channel TEXT NOT NULL,
    account TEXT NOT NULL, counterpart TEXT NOT NULL, agent_id TEXT NOT NULL,
    subject_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (channel, account, counterpart)
  )`;
  yield* sql`CREATE TABLE telescope_delegations (
    delegation_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, parent_id TEXT,
    workspace_id TEXT NOT NULL, from_agent_id TEXT NOT NULL, to_agent_id TEXT NOT NULL,
    state TEXT NOT NULL, brief_json TEXT NOT NULL, report_json TEXT,
    messages_json TEXT NOT NULL DEFAULT '[]', artifacts_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX telescope_delegations_context ON telescope_delegations (context_id)`;

  // Tables whose primary key does not already start with workspace_id.
  for (const table of [
    "invitations",
    "agents",
    "tasks",
    "task_commits",
    "leases",
    "grants",
    "audit",
    "wakes",
    "runs",
    "run_calls",
    "memories",
    "routing_rules",
    "channel_bindings",
    "delegations",
  ]) {
    yield* sql.unsafe(
      `CREATE INDEX telescope_${table}_workspace ON telescope_${table} (workspace_id)`,
    );
  }
});
