import { db } from './connection.ts';

const SCHEMA = `
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

-- Sidebar folders (db/repos/folders.ts). One channel each; parent_id stays null until nesting lands. Local, not synced.
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
  // Sync: the machine id of the Mac running or queueing the thread, null otherwise. Synced, kept out of the API.
  ensureColumn('threads', 'run_machine', 'TEXT');
  ensureColumn('threads', 'suggestion', 'TEXT');
  ensureColumn('threads', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('channels', 'icon', 'TEXT');
  // The sidebar folder a thread sits in, null for ungrouped: every existing thread. Local, not synced.
  ensureColumn('threads', 'folder_id', 'TEXT REFERENCES folders(id) ON DELETE SET NULL');
  db.exec('CREATE INDEX IF NOT EXISTS threads_folder ON threads(folder_id) WHERE folder_id IS NOT NULL');
  // What a new thread in the channel runs on when neither the thread nor its role picks (server/harness/resolve.ts).
  for (const col of ['default_harness', 'default_model', 'default_effort']) ensureColumn('channels', col, 'TEXT');
  // The channel's design system: one standalone HTML file for the pages its threads write, and the file's name.
  ensureColumn('channels', 'design_system', 'TEXT');
  ensureColumn('channels', 'design_system_name', 'TEXT');
  // The claude.ai page an artifact was published as (shared/published.ts), and what the publish said it was.
  ensureColumn('artifacts', 'url', 'TEXT');
  ensureColumn('artifacts', 'description', 'TEXT');
  // Sync matches these rows on uid, never on the local integer id. Old rows get one once; the index then makes the check free.
  for (const table of ['events', 'artifacts', 'automation_runs']) {
    ensureColumn(table, 'uid', 'TEXT');
    db.exec(`UPDATE ${table} SET uid = ${UUID_SQL} WHERE uid IS NULL`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_uid ON ${table}(uid)`);
  }
}
