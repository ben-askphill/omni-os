import { db } from './connection.ts';

const SCHEMA = `
-- Machine-local diagnostics. No raw arguments or error bodies; not part of the sync relay.
CREATE TABLE IF NOT EXISTS tool_failures (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL,
  thread_id TEXT NOT NULL, channel_id TEXT NOT NULL, harness TEXT NOT NULL,
  session_id TEXT NOT NULL, call_id TEXT NOT NULL, tool TEXT NOT NULL,
  category TEXT NOT NULL, detail TEXT NOT NULL, event_id INTEGER, parent_call_id TEXT,
  retry_of TEXT, recovery TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_failures_group ON tool_failures(group_id);
CREATE TABLE IF NOT EXISTS tool_failure_triage (
  group_id TEXT PRIMARY KEY, status TEXT NOT NULL, guidance TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'client',
  repo_path TEXT,
  github_repo TEXT,
  use_worktree INTEGER NOT NULL DEFAULT 1,
  base_dir TEXT,
  store_domain TEXT,
  portal_slug TEXT,
  browser_headless INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  icon TEXT,
  design_system TEXT,
  design_system_name TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  role TEXT,
  model TEXT,
  harness TEXT NOT NULL DEFAULT 'claude-code',
  effort TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL,
  has_run INTEGER NOT NULL DEFAULT 0,
  cwd TEXT NOT NULL,
  branch TEXT,
  parent_id TEXT REFERENCES threads(id),
  task_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  automation TEXT,
  last_text TEXT,
  suggestion TEXT,
  next_title TEXT,
  next_prompt TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS threads_channel ON threads(channel_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS threads_parent ON threads(parent_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS events_thread ON events(thread_id, id);
-- Messages only, for the recent commands every slash menu asks for.
CREATE INDEX IF NOT EXISTS events_user ON events(id) WHERE kind = 'user';
-- Questions an agent asked and their answers, which Needs you looks for in every thread.
CREATE INDEX IF NOT EXISTS events_question ON events(id) WHERE kind = 'question';
CREATE INDEX IF NOT EXISTS events_question_answer ON events(thread_id) WHERE kind = 'question_answer';

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  body, thread_id UNINDEXED, event_id UNINDEXED, tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Names and scopes only. Values live in the macOS Keychain.
CREATE TABLE IF NOT EXISTS secrets (
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (scope, name)
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation TEXT NOT NULL,
  thread_id TEXT REFERENCES threads(id),
  trigger TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Sidebar folders (db/repos/folders.ts). One channel each; parent_id stays null until nesting lands. Synced, except collapsed.
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER,
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS folders_channel ON folders(channel_id);

-- Sync (server/sync/). What changed locally and still has to go to the relay: a reference, read again at push time.
CREATE TABLE IF NOT EXISTS sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  ts TEXT NOT NULL
);
-- The last write each last-writer-wins row took, local or remote, so an older change never overwrites a newer one.
CREATE TABLE IF NOT EXISTS sync_meta (
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  PRIMARY KEY (entity, entity_id)
);
-- Remote changes that could not apply yet (a thread before its channel, no handler yet), retried after each pull.
CREATE TABLE IF NOT EXISTS sync_deferred (
  seq INTEGER PRIMARY KEY,
  change TEXT NOT NULL,
  error TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 1
);
-- Messages accepted through the API (db/repos/requests.ts), saved before the client hears so. Local, not synced.
CREATE TABLE IF NOT EXISTS message_requests (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Queue order, seq until Ben reorders.
  pos INTEGER,
  id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL,
  source TEXT NOT NULL,
  attachments TEXT,
  -- user, or crew_report. A message Omni wrote itself (a crew report, a team's go) keeps its transcript payload.
  kind TEXT NOT NULL DEFAULT 'user',
  payload TEXT,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  machine_id TEXT,
  event_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (thread_id, request_id)
);
CREATE INDEX IF NOT EXISTS message_requests_open ON message_requests(thread_id, seq) WHERE state NOT IN ('delivered','dropped','discarded','cancelled');

-- Needs you (db/repos/needs-you.ts). A turn that ended done, failed or stopped, written by the trigger below on the Mac
-- that ran the turn, whatever wrote the status. Its uid is the result's identity on every Mac; n is its place among
-- the thread's results, the same everywhere since it travels with the row. seq orders arrival on this Mac only.
-- Synced, insert-only (server/sync/handlers/needs-you.ts).
CREATE TABLE IF NOT EXISTS completions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  -- The thread's newest event when the turn ended, by its synced uid: where the result sits in the transcript.
  event_uid TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS completions_thread ON completions(thread_id, seq);
-- The newest result Ben has seen per thread, by its (n, uid): read state, kept apart from the thread row so reading
-- never moves updated_at, status or its folder. Only ever moves forward, here and when the other Mac's arrives.
CREATE TABLE IF NOT EXISTS result_reads (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  uid TEXT NOT NULL,
  read_at TEXT NOT NULL
);

-- The commit a thread's Changes panel compares its checkout to (server/changes.ts), recorded once so it stays put
-- across refreshes: where its worktree was cut, else the merge base with the repo's default branch. Local, not synced.
CREATE TABLE IF NOT EXISTS thread_bases (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  ref TEXT NOT NULL,
  how TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

-- A saved before/after snapshot of a worktree thread's checkout for each turn (server/turns.ts), so the turn's diff
-- stays readable after later edits and restarts. The snapshots are commits under hidden refs named by the turn's id
-- (refs/omni/turns/<thread>/<id>/before and /after), never on Ben's branch or index. completion_uid is the Result the
-- turn ended with, when it left one. Local, not synced: the refs live in this Mac's repo.
CREATE TABLE IF NOT EXISTS turn_snapshots (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  state TEXT NOT NULL,
  error TEXT,
  before_sha TEXT,
  before_head TEXT,
  before_skipped TEXT,
  after_sha TEXT,
  after_head TEXT,
  after_skipped TEXT,
  -- The n of the thread's newest Result when the turn started: the Result after it is this turn's.
  prior_n INTEGER NOT NULL DEFAULT 0,
  completion_uid TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS turn_snapshots_thread ON turn_snapshots(thread_id, n);

-- A thread the other Mac filed in a folder that has not arrived here yet. The folder's arrival puts it there.
CREATE TABLE IF NOT EXISTS sync_folder_wait (
  thread_id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL
);
`;

/** Add a column the current schema needs to a database created by an older version. Safe to run again. */
export function ensureColumn(table: string, column: string, decl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

/** A random v4 uuid, per row, in SQL. */
const UUID_SQL = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
  || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`;

/**
 * Startup migration: create tables, then add columns the current schema needs to a database created by an older
 * version. Safe to run again. Existing threads pick up the column default, so they open as
 * Claude Code threads with their model unchanged.
 */
export function migrate() {
  db.exec(SCHEMA);
  ensureColumn('threads', 'harness', `TEXT NOT NULL DEFAULT 'claude-code'`);
  ensureColumn('threads', 'effort', `TEXT NOT NULL DEFAULT ''`);
  ensureColumn('threads', 'auto_reason', 'TEXT');
  // Switching harness mid-thread (apps/server/runner/switch-plan.ts): the sessions it left, and the handover the next
  // turn reads. JSON, null when there is none. Synced with the row, kept out of the API.
  ensureColumn('threads', 'sessions', 'TEXT');
  ensureColumn('threads', 'handover', 'TEXT');
  // A switch picked while a turn ran, applied once the thread is quiet (runner/switch.ts). Synced with the row.
  ensureColumn('threads', 'queued_harness', 'TEXT');
  ensureColumn('threads', 'queued_model', 'TEXT');
  ensureColumn('threads', 'queued_effort', 'TEXT');
  // Sync: the machine id of the Mac running or queueing the thread, null otherwise. Synced, kept out of the API.
  ensureColumn('threads', 'run_machine', 'TEXT');
  ensureColumn('threads', 'suggestion', 'TEXT');
  // A follow-up thread Haiku proposes once a turn is done: its title and first prompt. Local, not synced.
  ensureColumn('threads', 'next_title', 'TEXT');
  ensureColumn('threads', 'next_prompt', 'TEXT');
  ensureColumn('threads', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  // A worktree thread's preparation (apps/server/runner/setup.ts): preparing or failed, with why; null once it is ready. Local, not synced.
  ensureColumn('threads', 'setup', 'TEXT');
  ensureColumn('threads', 'setup_error', 'TEXT');
  // A turn the harness stopped at its usage limit (apps/server/runner/limits.ts): limited, or scheduled to resume at the
  // reset time it reported. limit_id keys the one continuation; limit_machine is the Mac that ran the turn and the
  // only one that resumes it. Synced on its own (apps/server/sync/handlers/limit-stop.ts), never with the thread row;
  // limit_elsewhere is 1 on a Mac that holds the other Mac's stop, so clients show it without offering to act.
  for (const col of ['limit_state', 'limit_resets_at', 'limit_id', 'limit_machine']) ensureColumn('threads', col, 'TEXT');
  ensureColumn('threads', 'limit_elsewhere', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('channels', 'icon', 'TEXT');
  // The sidebar folder a thread sits in, null for ungrouped: every existing thread. Synced with the thread row.
  ensureColumn('threads', 'folder_id', 'TEXT REFERENCES folders(id) ON DELETE SET NULL');
  db.exec('CREATE INDEX IF NOT EXISTS threads_folder ON threads(folder_id) WHERE folder_id IS NOT NULL');
  // When Ben pinned the thread to the sidebar's Pinned section, null for every existing thread. Synced with the row.
  ensureColumn('threads', 'pinned_at', 'TEXT');
  // When Ben marked the thread done, out of Needs you; null for every existing thread. Synced with the row.
  ensureColumn('threads', 'done_at', 'TEXT');
  // What a new thread in the channel runs on when neither the thread nor its role picks (apps/server/harness/resolve.ts).
  for (const col of ['default_harness', 'default_model', 'default_effort']) ensureColumn('channels', col, 'TEXT');
  // The channel's design system: one standalone HTML file for the pages its threads write, and the file's name.
  ensureColumn('channels', 'design_system', 'TEXT');
  ensureColumn('channels', 'design_system_name', 'TEXT');
  // The claude.ai page an artifact was published as (packages/shared/published.ts), and what the publish said it was.
  ensureColumn('artifacts', 'url', 'TEXT');
  ensureColumn('artifacts', 'description', 'TEXT');
  // Sync matches these rows on uid, never on the local integer id. Old rows get one once; the index then makes the check free.
  // Queue order for durable requests (db/repos/requests.ts); a row saved before reordering existed keeps its arrival order.
  ensureColumn('message_requests', 'pos', 'INTEGER');
  db.exec('UPDATE message_requests SET pos = seq WHERE pos IS NULL');
  // Crew reports and a team's go to its lead are durable requests too, with the transcript payload Omni wrote.
  ensureColumn('message_requests', 'kind', `TEXT NOT NULL DEFAULT 'user'`);
  ensureColumn('message_requests', 'payload', 'TEXT');
  for (const table of ['events', 'artifacts', 'automation_runs']) {
    ensureColumn(table, 'uid', 'TEXT');
    db.exec(`UPDATE ${table} SET uid = ${UUID_SQL} WHERE uid IS NULL`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_uid ON ${table}(uid)`);
  }
  // A result's place among its thread's, the same on every Mac. Rows from before it synced count in arrival order.
  ensureColumn('completions', 'n', 'INTEGER');
  db.exec(`UPDATE completions SET n = (SELECT COUNT(*) FROM completions c WHERE c.thread_id = completions.thread_id AND c.seq <= completions.seq)
    WHERE n IS NULL`);
  db.exec('CREATE INDEX IF NOT EXISTS completions_order ON completions(thread_id, n, uid)');
  // result_reads kept the local seq before read state synced: it names the result by (n, uid) now.
  if ((db.prepare('PRAGMA table_info(result_reads)').all() as unknown as { name: string }[]).some((c) => c.name === 'seq')) {
    db.exec(`ALTER TABLE result_reads RENAME TO result_reads_old;
      CREATE TABLE result_reads (thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE, n INTEGER NOT NULL, uid TEXT NOT NULL, read_at TEXT NOT NULL);
      INSERT INTO result_reads (thread_id, n, uid, read_at) SELECT r.thread_id, c.n, r.uid, r.read_at FROM result_reads_old r JOIN completions c ON c.uid = r.uid;
      DROP TABLE result_reads_old;`);
  }
  // Every way a turn ends writes the thread's status (the runners, Setup, boot): a turn leaving running or queued for
  // done, failed or stopped is a result. Only on the Mac that ran it (run_machine was this one, or none): another
  // Mac's turn arrives with its status from sync, and its result comes as that Mac's completion, with the same uid.
  // With sync armed the new row is queued for the relay in the same write.
  db.exec('DROP TRIGGER IF EXISTS threads_completion');
  db.exec(`CREATE TRIGGER threads_completion AFTER UPDATE OF status ON threads
    WHEN NEW.status IN ('done','failed','stopped') AND OLD.status IN ('running','queued')
      AND (OLD.run_machine IS NULL OR OLD.run_machine = (SELECT json_extract(value, '$') FROM kv WHERE key = 'sync.machine_id'))
    BEGIN
      INSERT INTO completions (uid, thread_id, status, n, event_uid, created_at)
      VALUES (${UUID_SQL}, NEW.id, NEW.status, COALESCE((SELECT MAX(n) FROM completions WHERE thread_id = NEW.id), 0) + 1,
        (SELECT uid FROM events WHERE thread_id = NEW.id ORDER BY id DESC LIMIT 1), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      INSERT INTO sync_outbox (entity, entity_id, op, ts)
      SELECT 'completion', uid, 'upsert', created_at FROM completions
      WHERE seq = last_insert_rowid() AND EXISTS (SELECT 1 FROM kv WHERE key = 'sync.machine_id');
    END`);
  // #223 Thread history pages (apps/server/history.ts): turn ends, session starts, and tool calls by their own id.
  db.exec(`CREATE INDEX IF NOT EXISTS events_result ON events(thread_id, id) WHERE kind = 'result';
    CREATE INDEX IF NOT EXISTS events_init ON events(thread_id, id) WHERE kind = 'init';
    CREATE INDEX IF NOT EXISTS events_call ON events(thread_id, json_extract(payload, '$.id')) WHERE kind = 'tool_use';`);
}
