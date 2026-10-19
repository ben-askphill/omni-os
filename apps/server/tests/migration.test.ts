import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Build a database with the pre-harness threads schema, then let db.ts migrate it on import.
let db: typeof import('../db.ts');

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-migrate-'));
  mkdirSync(join(dir, 'x'), { recursive: true });
  const file = join(dir, 'omni.db');
  const old = new DatabaseSync(file);
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
    INSERT INTO channels (id, name) VALUES ('inbox', 'Inbox');
    INSERT INTO threads (id, channel_id, title, status, model, session_id, cwd)
      VALUES ('old-1', 'inbox', 'Legacy thread', 'done', 'claude-sonnet-5', 'old-1', '/tmp');
    -- Needs you as it first shipped: results ordered by the local seq, the read watermark by it too.
    CREATE TABLE completions (seq INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, thread_id TEXT NOT NULL,
      status TEXT NOT NULL, event_uid TEXT, created_at TEXT NOT NULL);
    CREATE TABLE result_reads (thread_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, uid TEXT NOT NULL, read_at TEXT NOT NULL);
    CREATE TRIGGER threads_completion AFTER UPDATE OF status ON threads BEGIN SELECT 1; END;
    INSERT INTO completions (uid, thread_id, status, created_at) VALUES ('c-1', 'old-1', 'done', '2026-10-01T00:00:00.000Z'),
      ('c-2', 'old-1', 'failed', '2026-10-02T00:00:00.000Z');
    INSERT INTO result_reads (thread_id, seq, uid, read_at) VALUES ('old-1', 1, 'c-1', '2026-10-01T01:00:00.000Z');
  `);
  old.close();

  process.env.OMNI_DATA_DIR = dir;
  db = await import('../db.ts');
});

describe('threads harness migration', () => {
  it('adds the harness and effort columns to an existing database', () => {
    const cols = db.db.prepare('PRAGMA table_info(threads)').all() as unknown as { name: string }[];
    expect(cols.some((c) => c.name === 'harness')).toBe(true);
    expect(cols.some((c) => c.name === 'effort')).toBe(true);
  });

  it('opens existing threads as Claude Code, default effort, model unchanged', () => {
    const t = db.threads.get('old-1')!;
    expect(t.harness).toBe('claude-code');
    expect(t.effort).toBe('');
    expect(t.model).toBe('claude-sonnet-5');
  });

  it('gives existing channels an empty icon', () => {
    expect(db.channels.get('inbox')!.icon).toBeNull();
  });

  it('adds the folders table and leaves existing threads ungrouped', () => {
    expect(db.threads.get('old-1')!.folder_id).toBeNull();
    expect(db.folders.byChannel('inbox')).toEqual([]);
  });

  it('orders existing results by arrival and keeps the read watermark, now by (n, uid)', () => {
    expect(db.completions.forThread('old-1').map((c) => [c.uid, c.n])).toEqual([['c-1', 1], ['c-2', 2]]);
    expect(db.resultReads.get('old-1')).toEqual({ thread_id: 'old-1', n: 1, uid: 'c-1', read_at: '2026-10-01T01:00:00.000Z' });
    expect(db.needsYou().items.find((i) => i.thread.id === 'old-1')?.result).toMatchObject({ uid: 'c-2', status: 'failed' });
    // The trigger is the one that writes a result only for this Mac's turns, and queues it for sync.
    const trigger = db.db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'threads_completion'`).get() as { sql: string };
    expect(trigger.sql).toContain('run_machine');
    expect(trigger.sql).toContain('sync_outbox');
  });

  it('is safe to run again', () => {
    expect(() => db.migrate()).not.toThrow();
  });
});
