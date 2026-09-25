import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './config.ts';

export type ChannelKind = 'client' | 'internal' | 'personal' | 'system';
export type ThreadStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped' | 'imported';
export type ThreadSource = 'manual' | 'automation' | 'conductor' | 'import' | 'capture';

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  repo_path: string | null;
  github_repo: string | null;
  use_worktree: number;
  base_dir: string | null;
  store_domain: string | null;
  portal_slug: string | null;
  browser_headless: number;
  notes: string | null;
  archived: number;
  created_at: string;
}

export interface Thread {
  id: string;
  channel_id: string;
  title: string;
  status: ThreadStatus;
  role: string | null;
  model: string | null;
  /** The harness this thread runs on. Existing rows migrate to 'claude-code'. */
  harness: string;
  /** Reasoning effort for the model. Empty means the model's default (nothing passed to the CLI). */
  effort: string;
  session_id: string;
  has_run: number;
  cwd: string;
  branch: string | null;
  parent_id: string | null;
  task_id: string | null;
  source: ThreadSource;
  automation: string | null;
  last_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: number;
  thread_id: string;
  kind: string;
  payload: string;
  created_at: string;
}

export interface Artifact {
  id: number;
  thread_id: string;
  path: string;
  name: string;
  kind: string;
  size: number;
  created_at: string;
  updated_at: string;
}

mkdirSync(dirname(paths.db), { recursive: true });
export const db = new DatabaseSync(paths.db);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
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
`);

/**
 * Startup migration: add columns the current schema needs to a database created by an older
 * version. Safe to run again. Existing threads pick up the column default, so they open as
 * Claude Code threads with their model unchanged.
 */
function ensureColumn(table: string, column: string, decl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}
export function migrate() {
  ensureColumn('threads', 'harness', `TEXT NOT NULL DEFAULT 'claude-code'`);
  ensureColumn('threads', 'effort', `TEXT NOT NULL DEFAULT ''`);
}
migrate();

const now = () => new Date().toISOString();

// Seed the two system channels every install needs.
db.prepare(
  `INSERT OR IGNORE INTO channels (id, name, kind, use_worktree, notes) VALUES
   ('conductor', 'Conductor', 'system', 0, 'Front agent. Delegates to crew threads in other channels.'),
   ('inbox', 'Inbox', 'internal', 0, 'Default channel for quick asks, research and ops.')`,
).run();

// ---------- channels ----------

export const channels = {
  list: (includeArchived = false) =>
    db
      .prepare(`SELECT * FROM channels ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY kind = 'system' DESC, name`)
      .all() as unknown as Channel[],
  get: (id: string) => db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as unknown as Channel | undefined,
  create(c: Partial<Channel> & { id: string; name: string }) {
    db.prepare(
      `INSERT INTO channels (id, name, kind, repo_path, github_repo, use_worktree, base_dir, store_domain, portal_slug, browser_headless, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      c.id,
      c.name,
      c.kind ?? 'client',
      c.repo_path ?? null,
      c.github_repo ?? null,
      c.use_worktree ?? 1,
      c.base_dir ?? null,
      c.store_domain ?? null,
      c.portal_slug ?? null,
      c.browser_headless ?? 1,
      c.notes ?? null,
    );
    return channels.get(c.id)!;
  },
  update(id: string, patch: Partial<Channel>) {
    const allowed = [
      'name', 'kind', 'repo_path', 'github_repo', 'use_worktree', 'base_dir',
      'store_domain', 'portal_slug', 'browser_headless', 'notes', 'archived',
    ] as const;
    const keys = allowed.filter((k) => k in patch);
    if (keys.length) {
      db.prepare(`UPDATE channels SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
        ...keys.map((k) => (patch[k] ?? null) as string | number | null),
        id,
      );
    }
    return channels.get(id);
  },
};

// ---------- threads ----------

export const threads = {
  get: (id: string) => db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as unknown as Thread | undefined,
  byChannel: (channelId: string, limit = 200) =>
    db
      .prepare('SELECT * FROM threads WHERE channel_id = ? ORDER BY updated_at DESC LIMIT ?')
      .all(channelId, limit) as unknown as Thread[],
  recent: (limit = 50) =>
    db.prepare('SELECT * FROM threads ORDER BY updated_at DESC LIMIT ?').all(limit) as unknown as Thread[],
  children: (parentId: string) =>
    db.prepare('SELECT * FROM threads WHERE parent_id = ? ORDER BY created_at').all(parentId) as unknown as Thread[],
  running: () => db.prepare(`SELECT * FROM threads WHERE status IN ('running','queued')`).all() as unknown as Thread[],
  list(filter: { channel?: string; status?: string; limit?: number }) {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.channel) (where.push('channel_id = ?'), args.push(filter.channel));
    if (filter.status) (where.push('status = ?'), args.push(filter.status));
    args.push(filter.limit ?? 30);
    return db
      .prepare(`SELECT * FROM threads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`)
      .all(...args) as unknown as Thread[];
  },
  create(t: Omit<Thread, 'created_at' | 'updated_at' | 'has_run' | 'last_text' | 'harness' | 'effort'> & { has_run?: number; created_at?: string; harness?: string; effort?: string }) {
    const ts = t.created_at ?? now();
    db.prepare(
      `INSERT INTO threads (id, channel_id, title, status, role, model, harness, effort, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      t.id, t.channel_id, t.title, t.status, t.role, t.model, t.harness ?? 'claude-code', t.effort ?? '', t.session_id, t.has_run ?? 0, t.cwd,
      t.branch, t.parent_id, t.task_id, t.source, t.automation, ts, ts,
    );
    return threads.get(t.id)!;
  },
  update(id: string, patch: Partial<Thread>) {
    const allowed = ['title', 'status', 'model', 'harness', 'effort', 'session_id', 'has_run', 'cwd', 'branch', 'last_text', 'updated_at'] as const;
    const keys = allowed.filter((k) => k in patch);
    const sets = keys.map((k) => `${k} = ?`);
    const vals = keys.map((k) => (patch[k] ?? null) as string | number | null);
    if (!('updated_at' in patch)) (sets.push('updated_at = ?'), vals.push(now()));
    db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    return threads.get(id);
  },
  /** Threads that were mid-run when the server died can never finish. */
  failInterrupted() {
    return db
      .prepare(`UPDATE threads SET status = 'failed' WHERE status IN ('running','queued')`)
      .run().changes;
  },
};

// ---------- events ----------

/** Kinds whose text is worth searching. */
const SEARCHABLE = new Set(['user', 'assistant_text', 'crew_report', 'error']);

export const events = {
  add(threadId: string, kind: string, payload: unknown, createdAt?: string): EventRow {
    const json = JSON.stringify(payload);
    const ts = createdAt ?? now();
    const res = db
      .prepare('INSERT INTO events (thread_id, kind, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(threadId, kind, json, ts);
    const id = Number(res.lastInsertRowid);
    if (SEARCHABLE.has(kind)) {
      const text = (payload as { text?: string })?.text;
      if (text) db.prepare('INSERT INTO search_fts (body, thread_id, event_id) VALUES (?, ?, ?)').run(text, threadId, id);
    }
    return { id, thread_id: threadId, kind, payload: json, created_at: ts };
  },
  since: (threadId: string, afterId = 0) =>
    db
      .prepare('SELECT * FROM events WHERE thread_id = ? AND id > ? ORDER BY id')
      .all(threadId, afterId) as unknown as EventRow[],
  lastAssistantText(threadId: string): string | null {
    const row = db
      .prepare(`SELECT payload FROM events WHERE thread_id = ? AND kind = 'assistant_text' ORDER BY id DESC LIMIT 1`)
      .get(threadId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload).text as string) : null;
  },
  /** All assistant text produced by the most recent run (after the last message the agent actually saw, and after `after`). */
  lastRunText(threadId: string, after = 0): string {
    const rows = db
      .prepare(
        `SELECT payload FROM events WHERE thread_id = ? AND kind = 'assistant_text'
         AND id > MAX(COALESCE((SELECT MAX(id) FROM events WHERE thread_id = ? AND kind IN ('user', 'crew_report')
           AND json_extract(payload, '$.dropped') IS NOT 1), 0), ?) ORDER BY id`,
      )
      .all(threadId, threadId, after) as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload).text as string).join('\n\n');
  },
};

// ---------- search ----------

export interface SearchHit {
  thread_id: string;
  title: string;
  channel_id: string;
  status: string;
  updated_at: string;
  snippet: string;
}

export function search(q: string, limit = 40): SearchHit[] {
  const terms = q
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' ');
  if (!terms) return [];
  const bodyHits = db
    .prepare(
      `SELECT t.id AS thread_id, t.title, t.channel_id, t.status, t.updated_at,
              snippet(search_fts, 0, '<mark>', '</mark>', ' … ', 14) AS snippet, bm25(search_fts) AS rank
       FROM search_fts JOIN threads t ON t.id = search_fts.thread_id
       WHERE search_fts MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(terms, limit * 3) as unknown as (SearchHit & { rank: number })[];
  const titleHits = db
    .prepare(
      `SELECT id AS thread_id, title, channel_id, status, updated_at, '' AS snippet FROM threads
       WHERE title LIKE ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(`%${q}%`, limit) as unknown as SearchHit[];
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of [...titleHits, ...bodyHits]) {
    if (seen.has(h.thread_id)) continue;
    seen.add(h.thread_id);
    out.push({ thread_id: h.thread_id, title: h.title, channel_id: h.channel_id, status: h.status, updated_at: h.updated_at, snippet: h.snippet });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- artifacts ----------

export const artifacts = {
  upsert(a: { thread_id: string; path: string; name: string; kind: string; size: number }) {
    db.prepare(
      `INSERT INTO artifacts (thread_id, path, name, kind, size) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET size = excluded.size, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).run(a.thread_id, a.path, a.name, a.kind, a.size);
    return db.prepare('SELECT * FROM artifacts WHERE path = ?').get(a.path) as unknown as Artifact;
  },
  byThread: (threadId: string) =>
    db.prepare('SELECT * FROM artifacts WHERE thread_id = ? ORDER BY created_at').all(threadId) as unknown as Artifact[],
  get: (id: number) => db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as unknown as Artifact | undefined,
  recent: (limit = 60) =>
    db
      .prepare(
        `SELECT a.*, t.title AS thread_title, t.channel_id FROM artifacts a JOIN threads t ON t.id = a.thread_id
         WHERE a.kind != 'screenshot' ORDER BY a.updated_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as (Artifact & { thread_title: string; channel_id: string })[],
  remove: (path: string) => db.prepare('DELETE FROM artifacts WHERE path = ?').run(path),
};

// ---------- kv ----------

export const kv = {
  get: <T>(key: string): T | undefined => {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  },
  set: (key: string, value: unknown) =>
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)),
};
