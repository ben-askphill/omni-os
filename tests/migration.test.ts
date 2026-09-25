import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Build a database with the pre-harness threads schema, then let db.ts migrate it on import.
let db: typeof import('../server/db.ts');

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
  `);
  old.close();

  process.env.OMNI_DATA_DIR = dir;
  db = await import('../server/db.ts');
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

  it('is safe to run again', () => {
    expect(() => db.migrate()).not.toThrow();
  });
});
