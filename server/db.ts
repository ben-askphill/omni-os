import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
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
  /** A guess at Ben's next reply once a turn is done, the reply box's placeholder. Local only, not synced. */
  suggestion: string | null;
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

/** What the sync relay carries. Events, artifacts and automation runs are keyed by their uid, the rest by id or key. */
export type SyncEntity = 'channel' | 'thread' | 'event' | 'artifact' | 'automation_run' | 'kv';
export type SyncOp = 'upsert' | 'delete';

export interface OutboxRow {
  id: number;
  entity: SyncEntity;
  entity_id: string;
  op: SyncOp;
  ts: string;
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
/** A random v4 uuid, per row, in SQL. */
const UUID_SQL = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
  || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`;

export function migrate() {
  ensureColumn('threads', 'harness', `TEXT NOT NULL DEFAULT 'claude-code'`);
  ensureColumn('threads', 'effort', `TEXT NOT NULL DEFAULT ''`);
  // Sync: the machine id of the Mac running or queueing the thread, null otherwise. Synced, kept out of the API.
  ensureColumn('threads', 'run_machine', 'TEXT');
  ensureColumn('threads', 'suggestion', 'TEXT');
  // Sync matches these rows on uid, never on the local integer id. Old rows get one once; the index then makes the check free.
  for (const table of ['events', 'artifacts', 'automation_runs']) {
    ensureColumn(table, 'uid', 'TEXT');
    db.exec(`UPDATE ${table} SET uid = ${UUID_SQL} WHERE uid IS NULL`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_uid ON ${table}(uid)`);
  }
}
migrate();

const now = () => new Date().toISOString();

let savepoints = 0;
/**
 * Run fn in one transaction. A savepoint, so it nests inside a caller's BEGIN (import-history) or another tx.
 * Every repo write below goes through it, so the row and its outbox entry commit together or not at all.
 */
export function tx<T>(fn: () => T): T {
  const name = `omni_tx_${savepoints++}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const out = fn();
    db.exec(`RELEASE ${name}`);
    return out;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  } finally {
    savepoints--;
  }
}

// ---------- sync outbox ----------

/** Rows where the newest write wins. Events and automation runs are insert-only. */
const LWW = new Set<SyncEntity>(['channel', 'thread', 'kv', 'artifact']);
/** kv keys that stay on this machine: the sync cursor, machine id, switches and path map. */
const localKey = (key: string) => key.startsWith('sync.');

/** This machine's sync id once sync was set up here. Until then nothing is recorded, so an Omni without sync writes no extra rows. */
let armedId: string | null =
  (db.prepare(`SELECT value FROM kv WHERE key = 'sync.machine_id'`).get() as { value: string } | undefined)?.value ?? null;
if (armedId) armedId = JSON.parse(armedId) as string;

/** Note that a row changed. Call it inside the write's tx. Remote-applied changes never call it, so nothing echoes back. */
function record(entity: SyncEntity, entityId: string, op: SyncOp = 'upsert') {
  if (!armedId) return;
  let ts = now();
  // A write here always comes after the last write the row took: in the same millisecond, or after one from a Mac
  // whose clock runs ahead. Otherwise the other Mac would keep the older value while this one shows the newer.
  const last = LWW.has(entity) ? syncMeta.get(entity, entityId)?.ts : undefined;
  if (last && ts <= last) ts = new Date(Date.parse(last) + 1).toISOString();
  db.prepare('INSERT INTO sync_outbox (entity, entity_id, op, ts) VALUES (?, ?, ?, ?)').run(entity, entityId, op, ts);
  if (LWW.has(entity)) syncMeta.set(entity, entityId, ts, armedId);
  onRecord?.();
}
let onRecord: (() => void) | null = null;

/**
 * The time a last-writer-wins row is queued with by the first arm: before any real write. A Mac joining later
 * seeds its built-in channels and kv too, and those are defaults, not edits newer than the other Mac's. A seeded
 * copy therefore loses to any write, and never replaces a row the receiving Mac already has (apply.ts claim).
 */
export const SEED_TS = '1970-01-01T00:00:00.000Z';

/** Queue every row there is, parents first, the first time sync is set up on this machine. */
function seed(machineId: string) {
  const ts = now();
  const q = (entity: SyncEntity, select: string) =>
    db
      .prepare(`INSERT INTO sync_outbox (entity, entity_id, op, ts) SELECT '${entity}', k, 'upsert', ? FROM (${select})`)
      .run(LWW.has(entity) ? SEED_TS : ts);
  q('channel', 'SELECT id AS k FROM channels ORDER BY created_at, rowid');
  q('thread', 'SELECT id AS k FROM threads ORDER BY created_at, rowid');
  q('event', 'SELECT uid AS k FROM events ORDER BY id');
  q('artifact', 'SELECT uid AS k FROM artifacts ORDER BY id');
  q('automation_run', 'SELECT uid AS k FROM automation_runs ORDER BY id');
  q('kv', `SELECT key AS k FROM kv WHERE key NOT LIKE 'sync.%' ORDER BY key`);
  db.prepare(
    `INSERT OR REPLACE INTO sync_meta (entity, entity_id, ts, machine_id)
     SELECT entity, entity_id, ts, ? FROM sync_outbox WHERE entity IN ('channel', 'thread', 'kv', 'artifact')`,
  ).run(machineId);
}

export const outbox = {
  /** This machine's sync id, or null when sync was never set up here. */
  machineId: () => armedId,
  /**
   * Turn recording on for good and return this machine's id: the stored one, else `machineId`, else a new uuid.
   * The first arm also queues the existing history. server/sync/worker.ts calls it; nothing else should.
   * `hardware` (server/sync/hardware.ts) is stored with it. A stored one that differs means this data folder was
   * copied from another Mac, which still has that id: this one takes a new id, and pulls and seeds again from the
   * start, as a first arm does, so neither Mac skips the other's changes as its own.
   */
  arm(machineId?: string, hardware?: string | null): string {
    return tx(() => {
      const setLocal = (key: string, value: unknown) =>
        db.prepare(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
      const stored = kv.get<string>('sync.hardware_id');
      if (hardware && stored !== hardware) setLocal('sync.hardware_id', hardware);
      if (armedId && !(hardware && stored && stored !== hardware)) return armedId;
      const moved = !!armedId;
      const id = moved ? randomUUID() : (machineId ?? randomUUID());
      setLocal('sync.machine_id', id);
      if (moved) {
        // The copy's queue and parked changes were the other Mac's to send and apply. Seeded rows (SEED_TS) only
        // fill gaps over there, so nothing here overwrites what that Mac has; everything it has comes back here.
        setLocal('sync.cursor', 0);
        db.exec('DELETE FROM sync_outbox; DELETE FROM sync_deferred');
      }
      // A thread mid-run as sync is set up is this machine's run, and its row should say so.
      db.prepare(`UPDATE threads SET run_machine = ? WHERE status IN ('running','queued') AND run_machine IS NULL`).run(id);
      seed(id);
      armedId = id;
      return id;
    });
  },
  /** The oldest queued changes for these entities. Rows for other entities wait until a handler exists. */
  pending(limit: number, entities: readonly SyncEntity[]): OutboxRow[] {
    return db
      .prepare(`SELECT * FROM sync_outbox WHERE entity IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT ?`)
      .all(JSON.stringify(entities), limit) as unknown as OutboxRow[];
  },
  /** Called after each recorded write, so the worker can push soon. Only schedule work in it: it runs inside the write's tx. */
  onRecord(fn: (() => void) | null) {
    onRecord = fn;
  },
  /**
   * Queue a row again after a remote change was applied to it, for a handler that kept part of the row as this
   * machine has it: the other machines then get the row as it is here, with a newer ts. Call it inside apply.
   */
  requeue(entity: SyncEntity, entityId: string) {
    record(entity, entityId);
  },
  /** Drop rows the relay took. */
  ack(ids: readonly number[]) {
    db.prepare('DELETE FROM sync_outbox WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(ids));
  },
  /** Rows waiting for these entities, and rows held for entities with no handler. */
  counts(entities: readonly SyncEntity[]): { pending: number; held: number } {
    return db
      .prepare(
        `SELECT COALESCE(SUM(entity IN (SELECT value FROM json_each(?1))), 0) AS pending,
                COALESCE(SUM(entity NOT IN (SELECT value FROM json_each(?1))), 0) AS held FROM sync_outbox`,
      )
      .get(JSON.stringify(entities)) as { pending: number; held: number };
  },
};

/** Last writer per last-writer-wins row. server/sync/apply.ts compares a remote change against it. */
export const syncMeta = {
  get: (entity: SyncEntity, entityId: string) =>
    db.prepare('SELECT ts, machine_id FROM sync_meta WHERE entity = ? AND entity_id = ?').get(entity, entityId) as
      | { ts: string; machine_id: string }
      | undefined,
  set: (entity: SyncEntity, entityId: string, ts: string, machineId: string) =>
    db
      .prepare(
        `INSERT INTO sync_meta (entity, entity_id, ts, machine_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(entity, entity_id) DO UPDATE SET ts = excluded.ts, machine_id = excluded.machine_id`,
      )
      .run(entity, entityId, ts, machineId),
};

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
    return tx(() => {
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
      record('channel', c.id);
      return channels.get(c.id)!;
    });
  },
  update(id: string, patch: Partial<Channel>) {
    const allowed = [
      'name', 'kind', 'repo_path', 'github_repo', 'use_worktree', 'base_dir',
      'store_domain', 'portal_slug', 'browser_headless', 'notes', 'archived',
    ] as const;
    const keys = allowed.filter((k) => k in patch);
    if (keys.length) {
      tx(() => {
        db.prepare(`UPDATE channels SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
          ...keys.map((k) => (patch[k] ?? null) as string | number | null),
          id,
        );
        record('channel', id);
      });
    }
    return channels.get(id);
  },
};

// ---------- threads ----------

/** The columns clients read, without sync's run_machine. */
export const THREAD_COLUMNS =
  'id, channel_id, title, status, role, model, harness, effort, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, last_text, suggestion, created_at, updated_at';

/** Who runs a thread with this status: this machine while it is running or queued here and sync is set up, else nobody. */
const runMachine = (status: ThreadStatus) => (status === 'running' || status === 'queued' ? armedId : null);

export const threads = {
  get: (id: string) => db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE id = ?`).get(id) as unknown as Thread | undefined,
  byChannel: (channelId: string, limit = 200) =>
    db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE channel_id = ? ORDER BY updated_at DESC LIMIT ?`)
      .all(channelId, limit) as unknown as Thread[],
  recent: (limit = 50) =>
    db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads ORDER BY updated_at DESC LIMIT ?`).all(limit) as unknown as Thread[],
  children: (parentId: string) =>
    db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE parent_id = ? ORDER BY created_at`).all(parentId) as unknown as Thread[],
  /** Each channel's `perChannel` most recently updated threads, whatever their status. */
  recentPerChannel: (perChannel = 5) =>
    db
      .prepare(
        `SELECT ${THREAD_COLUMNS} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY updated_at DESC) AS n FROM threads) WHERE n <= ?`,
      )
      .all(perChannel) as unknown as Thread[],
  running: () => db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE status IN ('running','queued')`).all() as unknown as Thread[],
  /** The machine id of the Mac that runs the thread (sync), or null when none does. */
  runMachine: (id: string) =>
    (db.prepare('SELECT run_machine FROM threads WHERE id = ?').get(id) as { run_machine: string | null } | undefined)?.run_machine ?? null,
  list(filter: { channel?: string; status?: string; limit?: number }) {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.channel) (where.push('channel_id = ?'), args.push(filter.channel));
    if (filter.status) (where.push('status = ?'), args.push(filter.status));
    args.push(filter.limit ?? 30);
    return db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM threads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`)
      .all(...args) as unknown as Thread[];
  },
  create(t: Omit<Thread, 'created_at' | 'updated_at' | 'has_run' | 'last_text' | 'suggestion' | 'harness' | 'effort'> & { has_run?: number; created_at?: string; harness?: string; effort?: string }) {
    const ts = t.created_at ?? now();
    return tx(() => {
      db.prepare(
        `INSERT INTO threads (id, channel_id, title, status, role, model, harness, effort, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, run_machine, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        t.id, t.channel_id, t.title, t.status, t.role, t.model, t.harness ?? 'claude-code', t.effort ?? '', t.session_id, t.has_run ?? 0, t.cwd,
        t.branch, t.parent_id, t.task_id, t.source, t.automation, runMachine(t.status), ts, ts,
      );
      record('thread', t.id);
      return threads.get(t.id)!;
    });
  },
  update(id: string, patch: Partial<Thread>) {
    const allowed = ['title', 'status', 'model', 'harness', 'effort', 'session_id', 'has_run', 'cwd', 'branch', 'last_text', 'updated_at'] as const;
    const keys = allowed.filter((k) => k in patch);
    const sets = keys.map((k) => `${k} = ?`);
    const vals = keys.map((k) => (patch[k] ?? null) as string | number | null);
    if (!('updated_at' in patch)) (sets.push('updated_at = ?'), vals.push(now()));
    // Every status write says who runs the thread, so the row itself tells the other Mac (server/sync/guard.ts).
    if (patch.status) (sets.push('run_machine = ?'), vals.push(runMachine(patch.status)));
    tx(() => {
      if (db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id).changes) record('thread', id);
    });
    return threads.get(id);
  },
  /**
   * The reply box's suggestion. Not a change to the thread: updated_at stays, so lists keep their order,
   * and sync never hears of it. True when it changed.
   */
  setSuggestion(id: string, text: string | null) {
    return db.prepare('UPDATE threads SET suggestion = ? WHERE id = ? AND suggestion IS NOT ?').run(text, id, text).changes > 0;
  },
  /** Move a thread to another channel, keeping its place in the lists. import-history's --move-imported uses it. */
  setChannel(id: string, channelId: string) {
    tx(() => {
      if (db.prepare('UPDATE threads SET channel_id = ? WHERE id = ?').run(channelId, id).changes) record('thread', id);
    });
  },
  /**
   * Threads that were mid-run when the server died can never finish. Only the ones this machine ran, or no
   * machine claims: one another Mac runs is that Mac's to fail when it restarts.
   */
  failInterrupted() {
    return tx(() => {
      const ids = db
        .prepare(`SELECT id FROM threads WHERE status IN ('running','queued') AND (run_machine IS NULL OR run_machine = ?)`)
        .all(armedId ?? '') as { id: string }[];
      const fail = db.prepare(`UPDATE threads SET status = 'failed', run_machine = NULL WHERE id = ?`);
      for (const { id } of ids) (fail.run(id), record('thread', id));
      return ids.length;
    });
  },
};

// ---------- events ----------

/** Kinds whose text is worth searching. */
const SEARCHABLE = new Set(['user', 'assistant_text', 'crew_report', 'error']);

/** The columns clients read. The uid is sync's own key, kept out of the API. */
export const EVENT_COLUMNS = 'id, thread_id, kind, payload, created_at';

/** Add an event's text to search. events.add and a synced event both call it. */
export function indexEvent(threadId: string, kind: string, payload: unknown, eventId: number) {
  if (!SEARCHABLE.has(kind)) return;
  const text = (payload as { text?: string })?.text;
  if (text) db.prepare('INSERT INTO search_fts (body, thread_id, event_id) VALUES (?, ?, ?)').run(text, threadId, eventId);
}

export const events = {
  add(threadId: string, kind: string, payload: unknown, createdAt?: string): EventRow {
    const json = JSON.stringify(payload);
    const ts = createdAt ?? now();
    const uid = randomUUID();
    const id = tx(() => {
      const res = db
        .prepare('INSERT INTO events (uid, thread_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(uid, threadId, kind, json, ts);
      const id = Number(res.lastInsertRowid);
      indexEvent(threadId, kind, payload, id);
      record('event', uid);
      return id;
    });
    return { id, thread_id: threadId, kind, payload: json, created_at: ts };
  },
  since: (threadId: string, afterId = 0) =>
    db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE thread_id = ? AND id > ? ORDER BY id`)
      .all(threadId, afterId) as unknown as EventRow[],
  uidOf: (id: number) => (db.prepare('SELECT uid FROM events WHERE id = ?').get(id) as { uid: string } | undefined)?.uid ?? null,
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
  /** The text of the thread's last message that was not dropped. */
  lastUserText(threadId: string): string {
    const row = db
      .prepare(
        `SELECT payload FROM events WHERE thread_id = ? AND kind = 'user' AND json_extract(payload, '$.dropped') IS NOT 1 ORDER BY id DESC LIMIT 1`,
      )
      .get(threadId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload).text as string) ?? '' : '';
  },
  /**
   * The commands Ben used most recently on a harness, in any thread, newest first and each once.
   * Only messages he typed count: in Omni or in claude-bar's hotkey prompt, not the Conductor's or an Automation's.
   */
  recentCommands(harness: string, limit = 20): string[] {
    const rows = db
      .prepare(
        `SELECT json_extract(e.payload, '$.slash.command.name') AS name FROM events e JOIN threads t ON t.id = e.thread_id
         WHERE e.kind = 'user' AND t.harness = ? AND json_extract(e.payload, '$.source') IN ('manual', 'ben', 'capture')
           AND json_extract(e.payload, '$.slash.command.name') IS NOT NULL
         GROUP BY name ORDER BY MAX(e.id) DESC LIMIT ?`,
      )
      .all(harness, limit) as { name: string }[];
    return rows.map((r) => r.name);
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

/** The columns clients read, without sync's uid. */
export const ARTIFACT_COLUMNS = 'id, thread_id, path, name, kind, size, created_at, updated_at';

export const artifacts = {
  upsert(a: { thread_id: string; path: string; name: string; kind: string; size: number }) {
    return tx(() => {
      db.prepare(
        `INSERT INTO artifacts (uid, thread_id, path, name, kind, size) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET size = excluded.size, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      ).run(randomUUID(), a.thread_id, a.path, a.name, a.kind, a.size);
      const row = db.prepare(`SELECT ${ARTIFACT_COLUMNS}, uid FROM artifacts WHERE path = ?`).get(a.path) as unknown as Artifact & { uid: string };
      record('artifact', row.uid);
      const { uid: _uid, ...out } = row;
      return out as Artifact;
    });
  },
  byThread: (threadId: string) =>
    db.prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE thread_id = ? ORDER BY created_at`).all(threadId) as unknown as Artifact[],
  get: (id: number) => db.prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE id = ?`).get(id) as unknown as Artifact | undefined,
  uidOf: (id: number) => (db.prepare('SELECT uid FROM artifacts WHERE id = ?').get(id) as { uid: string } | undefined)?.uid ?? null,
  recent: (limit = 60) =>
    db
      .prepare(
        `SELECT ${ARTIFACT_COLUMNS.split(', ').map((c) => `a.${c}`).join(', ')}, t.title AS thread_title, t.channel_id
         FROM artifacts a JOIN threads t ON t.id = a.thread_id
         WHERE a.kind != 'screenshot' ORDER BY a.updated_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as (Artifact & { thread_title: string; channel_id: string })[],
  remove: (path: string) =>
    tx(() => {
      const row = db.prepare('SELECT uid FROM artifacts WHERE path = ?').get(path) as { uid: string } | undefined;
      const res = db.prepare('DELETE FROM artifacts WHERE path = ?').run(path);
      if (row && res.changes) record('artifact', row.uid, 'delete');
      return res;
    }),
};

// ---------- automation runs ----------

export const automationRuns = {
  add(automation: string, threadId: string, trigger: string): { id: number; uid: string } {
    const uid = randomUUID();
    return tx(() => {
      const res = db
        .prepare('INSERT INTO automation_runs (uid, automation, thread_id, trigger) VALUES (?, ?, ?, ?)')
        .run(uid, automation, threadId, trigger);
      record('automation_run', uid);
      return { id: Number(res.lastInsertRowid), uid };
    });
  },
};

// ---------- kv ----------

export const kv = {
  get: <T>(key: string): T | undefined => {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  },
  set: (key: string, value: unknown) =>
    tx(() => {
      const res = db
        .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value));
      if (!localKey(key)) record('kv', key);
      return res;
    }),
};
