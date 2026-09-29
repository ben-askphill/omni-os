import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A database from before sync: events, artifacts and automation runs with no uid. db.ts backfills one on import.
let db: typeof import('../server/db.ts');

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-uid-'));
  const old = new DatabaseSync(join(dir, 'omni.db'));
  old.exec(`
    CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'client',
      repo_path TEXT, github_repo TEXT, use_worktree INTEGER NOT NULL DEFAULT 1, base_dir TEXT,
      store_domain TEXT, portal_slug TEXT, browser_headless INTEGER NOT NULL DEFAULT 1, notes TEXT,
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE threads (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
      role TEXT, model TEXT, session_id TEXT NOT NULL, has_run INTEGER NOT NULL DEFAULT 0, cwd TEXT NOT NULL,
      branch TEXT, parent_id TEXT, task_id TEXT, source TEXT NOT NULL DEFAULT 'manual', automation TEXT,
      last_text TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, kind TEXT NOT NULL,
      payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE automation_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, automation TEXT NOT NULL, thread_id TEXT,
      trigger TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    INSERT INTO channels (id, name) VALUES ('inbox', 'Inbox');
    INSERT INTO threads (id, channel_id, title, status, session_id, cwd) VALUES ('old-1', 'inbox', 'Legacy', 'done', 'old-1', '/tmp');
    INSERT INTO events (thread_id, kind, payload) VALUES ('old-1', 'user', '{"text":"a"}'), ('old-1', 'assistant_text', '{"text":"b"}');
    INSERT INTO artifacts (thread_id, path, name, kind) VALUES ('old-1', '/tmp/x.html', 'x.html', 'html');
    INSERT INTO automation_runs (automation, thread_id, trigger) VALUES ('morning', 'old-1', 'cron');
  `);
  old.close();
  process.env.OMNI_DATA_DIR = dir;
  db = await import('../server/db.ts');
});

const uids = (table: string) => (db.db.prepare(`SELECT uid FROM ${table} ORDER BY id`).all() as { uid: string | null }[]).map((r) => r.uid);

describe('uid backfill', () => {
  it('gives every old event, artifact and automation run a distinct uuid', () => {
    const all = [...uids('events'), ...uids('artifacts'), ...uids('automation_runs')];
    expect(all).toHaveLength(4);
    for (const u of all) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(all).size).toBe(4);
  });

  it('runs once: a second migrate keeps the uids', () => {
    const before = uids('events');
    db.migrate();
    expect(uids('events')).toEqual(before);
  });

  it('refuses a duplicate uid', () => {
    const [u] = uids('events');
    expect(() => db.db.prepare(`INSERT INTO events (uid, thread_id, kind, payload) VALUES (?, 'old-1', 'user', '{}')`).run(u)).toThrow(/UNIQUE/);
  });
});
