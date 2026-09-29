import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MemoryTransport } from '../server/sync/transport.ts';

// Thread files and harness session files between two Macs in one process: each has its own data dir and its own
// home dir, and both use one in-memory relay. No network, and nothing under the real ~/.claude, ~/.codex or ~/.cursor.

async function machine(name: string) {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), `omni-files-${name}-`));
  process.env.OMNI_DATA_DIR = join(root, 'data');
  const home = join(root, 'home');
  mkdirSync(home);
  const config = await import('../server/config.ts');
  const db = await import('../server/db.ts');
  const files = await import('../server/sync/files.ts');
  const opts = { transport: relay, home, env: {} };
  const put = (rel: string, body: string | Buffer) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
    return p;
  };
  return { name, root, home, config, db, files, opts, put };
}

const relay = new MemoryTransport();
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
let a: Awaited<ReturnType<typeof machine>>;
let b: Awaited<ReturnType<typeof machine>>;

const thread = (id: string, cwd: string, patch: Record<string, unknown> = {}) => ({
  id, channel_id: 'inbox', title: 'Files', status: 'done', role: null, model: null, harness: 'claude-code', effort: '',
  session_id: id, has_run: 1, cwd, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  last_text: null, created_at: '2026-09-29T10:00:00.000Z', updated_at: '2026-09-29T10:00:00.000Z', ...patch,
}) as any;

beforeAll(async () => {
  a = await machine('mac-a');
  b = await machine('mac-b');
});

describe('thread files', () => {
  it('uploads the synced areas content-addressed, with a manifest, and B downloads them', async () => {
    const dir = a.config.threadDir('t1');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    mkdirSync(join(dir, 'uploads'), { recursive: true });
    writeFileSync(join(dir, 'uploads', 'photo.png'), png);
    mkdirSync(join(dir, 'artifacts', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'artifacts', 'report.html'), '<h1>Report</h1>');
    writeFileSync(join(dir, 'artifacts', 'deep', 'copy.html'), '<h1>Report</h1>');
    writeFileSync(join(dir, 'artifacts', '.draft.html'), 'hidden');
    mkdirSync(join(dir, 'browser'), { recursive: true });
    writeFileSync(join(dir, 'browser', 'shot.png'), 'shot');
    // Rebuilt per machine, never synced.
    writeFileSync(join(dir, 'mcp.json'), '{"secret":"nope"}');
    mkdirSync(join(dir, 'cursor-plugin'), { recursive: true });
    writeFileSync(join(dir, 'cursor-plugin', 'plugin.json'), '{}');

    const pushed = await a.files.pushThreadFiles('t1', a.opts);
    // Same content twice is one blob.
    expect(pushed.count).toBe(3);
    expect(relay.objects.has(`blobs/${sha('<h1>Report</h1>')}`)).toBe(true);
    expect(relay.objects.has(`blobs/${sha(png)}`)).toBe(true);
    const manifest = JSON.parse(Buffer.from(relay.objects.get('manifests/t1.json')!).toString());
    expect(Object.keys(manifest.files).sort()).toEqual([
      'artifacts/deep/copy.html', 'artifacts/report.html', 'browser/shot.png', 'uploads/photo.png',
    ]);
    expect(manifest.files['uploads/photo.png']).toMatchObject({ sha: sha(png), size: png.length });

    const pulled = await b.files.pullThreadFiles('t1', b.opts);
    expect(pulled).toEqual({ count: 4, skipped: 0 });
    const bdir = b.config.threadDir('t1');
    expect(readFileSync(join(bdir, 'uploads', 'photo.png'))).toEqual(png);
    expect(readFileSync(join(bdir, 'artifacts', 'deep', 'copy.html'), 'utf8')).toBe('<h1>Report</h1>');
    expect(existsSync(join(bdir, 'mcp.json'))).toBe(false);
    expect(existsSync(join(bdir, 'artifacts', '.draft.html'))).toBe(false);
    // The file keeps its mtime from A.
    const mtime = statSync(join(bdir, 'browser', 'shot.png')).mtimeMs;
    expect(Math.abs(mtime - manifest.files['browser/shot.png'].mtime)).toBeLessThanOrEqual(1);
  });

  it('uploads nothing again when nothing changed, and only the changed file when one did', async () => {
    const put = vi.spyOn(relay, 'putObject');
    expect(await a.files.pushThreadFiles('t1', a.opts)).toEqual({ count: 0, skipped: 0 });
    expect(put).not.toHaveBeenCalled();

    writeFileSync(join(a.config.threadDir('t1'), 'artifacts', 'report.html'), '<h1>Report v2</h1>');
    expect((await a.files.pushThreadFiles('t1', a.opts)).count).toBe(1);
    expect(put.mock.calls.map((c) => c[0]).sort()).toEqual([`blobs/${sha('<h1>Report v2</h1>')}`, 'manifests/t1.json']);
    put.mockRestore();
  });

  it('never overwrites a file B already has', async () => {
    const path = join(b.config.threadDir('t1'), 'artifacts', 'report.html');
    writeFileSync(path, 'edited on B');
    expect((await b.files.pullThreadFiles('t1', b.opts)).count).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe('edited on B');
  });

  it('skips manifest entries outside the synced areas and blobs that do not match their sha', async () => {
    const good = sha('fine');
    relay.objects.set(`blobs/${good}`, Buffer.from('fine'));
    relay.objects.set(`blobs/${sha('real')}`, Buffer.from('tampered'));
    const entry = (s: string) => ({ sha: s, size: 4, mtime: Date.now() });
    relay.objects.set('manifests/t2.json', Buffer.from(JSON.stringify({
      v: 1, sessions: {},
      files: {
        '../../escape.txt': entry(good), 'artifacts/../../x.txt': entry(good), '/abs.txt': entry(good), 'mcp.json': entry(good),
        'artifacts/bad.txt': entry(sha('real')), 'artifacts/missing.txt': entry(sha('never uploaded')), 'artifacts/ok.txt': entry(good),
      },
    })));
    expect(await b.files.pullThreadFiles('t2', b.opts)).toEqual({ count: 1, skipped: 6 });
    expect(readFileSync(join(b.config.threadDir('t2'), 'artifacts', 'ok.txt'), 'utf8')).toBe('fine');
    expect(existsSync(join(b.config.paths.data, 'escape.txt'))).toBe(false);
    expect(existsSync(join(b.config.threadDir('t2'), 'artifacts', 'bad.txt'))).toBe(false);
  });

  it('a thread with no manifest pulls nothing', async () => {
    expect(await b.files.pullThreadFiles('nothing-here', b.opts)).toEqual({ count: 0, skipped: 0 });
  });
});

describe('Claude Code session files', () => {
  const sid = 'c0ffee00-0000-4000-8000-000000000001';

  it('goes up after a turn and comes down into the project folder for this machine\'s cwd', async () => {
    const cwdA = join(a.home, 'work', 'volero');
    const cwdB = join(b.home, 'code', 'volero');
    expect(a.files.claudeProjectDir('/Users/ben/work/volero.x')).toBe('-Users-ben-work-volero-x');
    const local = a.put(`home/.claude/projects/${a.files.claudeProjectDir(cwdA)}/${sid}.jsonl`, '{"type":"user"}\n');

    expect(await a.files.pushSession(thread('t3', cwdA, { session_id: sid }), a.opts)).toBe(1);
    expect(Buffer.from(relay.objects.get(`sessions/claude-code/${sid}.jsonl`)!).toString()).toBe('{"type":"user"}\n');
    // Unchanged: no upload.
    expect(await a.files.pushSession(thread('t3', cwdA, { session_id: sid }), a.opts)).toBe(0);

    const onB = thread('t3', cwdB, { session_id: sid });
    expect(await b.files.pullSession(onB, b.opts)).toBe(1);
    const there = join(b.home, '.claude', 'projects', b.files.claudeProjectDir(cwdB), `${sid}.jsonl`);
    expect(readFileSync(there, 'utf8')).toBe('{"type":"user"}\n');
    expect(await b.files.pullSession(onB, b.opts)).toBe(0);

    // A runs another turn; B's copy has not changed since it synced, so B takes the new one.
    writeFileSync(local, '{"type":"user"}\n{"type":"assistant"}\n');
    expect(await a.files.pushSession(thread('t3', cwdA, { session_id: sid }), a.opts)).toBe(1);
    expect(await b.files.pullSession(onB, b.opts)).toBe(1);
    expect(readFileSync(there, 'utf8')).toBe('{"type":"user"}\n{"type":"assistant"}\n');
  });

  it('keeps a local session that changed since it last synced', async () => {
    const cwdB = join(b.home, 'code', 'volero');
    const there = join(b.home, '.claude', 'projects', b.files.claudeProjectDir(cwdB), `${sid}.jsonl`);
    writeFileSync(there, 'turn run on B, not pushed yet\n');
    const future = new Date(Date.now() + 5_000);
    utimesSync(there, future, future);
    expect(await b.files.pullSession(thread('t3', cwdB, { session_id: sid }), b.opts)).toBe(0);
    expect(readFileSync(there, 'utf8')).toBe('turn run on B, not pushed yet\n');
  });

  it('has nothing to do for Hermes, or for a Codex or Cursor thread before its first turn', async () => {
    const cwd = join(a.home, 'x');
    expect(a.files.sessionRoot(thread('h1', cwd, { harness: 'hermes' }), a.home, {})).toBeNull();
    expect(a.files.sessionRoot(thread('c1', cwd, { harness: 'codex' }), a.home, {})).toBeNull();
    expect(a.files.sessionRoot(thread('u1', cwd, { harness: 'cursor' }), a.home, {})).toBeNull();
    expect(await a.files.pushSession(thread('h1', cwd, { harness: 'hermes', session_id: 'omni-h1' }), a.opts)).toBe(0);
  });
});

describe('Codex session files', () => {
  const sid = '01a0bc16-4ca5-79c3-805a-d8efb930fdd8';
  const rel = `2026/09/20/rollout-2026-09-20T01-52-53-${sid}.jsonl`;

  it('restores the rollout at the same place under this machine\'s sessions folder', async () => {
    a.put(`home/.codex/sessions/${rel}`, '{"type":"session_meta"}\n');
    a.put('home/.codex/sessions/2026/09/20/rollout-2026-09-20T01-52-53-someone-else.jsonl', 'other\n');
    const onA = thread('t4', join(a.home, 'w'), { harness: 'codex', session_id: sid });
    expect(await a.files.pushSession(onA, a.opts)).toBe(1);
    expect(relay.objects.has(`sessions/codex/${sid}.jsonl`)).toBe(true);

    const onB = thread('t4', join(b.home, 'w'), { harness: 'codex', session_id: sid });
    expect(await b.files.pullSession(onB, b.opts)).toBe(1);
    expect(readFileSync(join(b.home, '.codex', 'sessions', rel), 'utf8')).toBe('{"type":"session_meta"}\n');
  });

  it('follows CODEX_HOME', async () => {
    const codexHome = join(b.root, 'codex-home');
    const onB = thread('t4', join(b.home, 'w'), { harness: 'codex', session_id: sid });
    expect(await b.files.pullSession(onB, { ...b.opts, env: { CODEX_HOME: codexHome } })).toBe(1);
    expect(existsSync(join(codexHome, 'sessions', rel))).toBe(true);
  });
});

describe('Cursor Agent chats', () => {
  const sid = '06da61e9-a772-4ee1-9270-768dc1c817ab';
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');

  it('moves the chat folder to the one for this machine\'s cwd, and points meta.json at it', async () => {
    const cwdA = join(a.home, 'shop');
    const cwdB = join(b.home, 'elsewhere', 'shop');
    a.put(`home/.cursor/chats/${md5(cwdA)}/${sid}/meta.json`, JSON.stringify({ schemaVersion: 1, title: 'Shop', cwd: cwdA }));
    a.put(`home/.cursor/chats/${md5(cwdA)}/${sid}/store.db`, Buffer.from('SQLite format 3\0...'));
    a.put(`home/.cursor/chats/${md5(cwdA)}/${sid}/store.db-shm`, Buffer.from('shared memory'));
    expect(await a.files.pushSession(thread('t5', cwdA, { harness: 'cursor', session_id: sid }), a.opts)).toBe(2);
    expect(relay.objects.has(`sessions/cursor/${sid}/store.db`)).toBe(true);
    expect(relay.objects.has(`sessions/cursor/${sid}/store.db-shm`)).toBe(false);

    const onB = thread('t5', cwdB, { harness: 'cursor', session_id: sid });
    expect(await b.files.pullSession(onB, b.opts)).toBe(2);
    const chat = join(b.home, '.cursor', 'chats', md5(cwdB), sid);
    expect(readFileSync(join(chat, 'store.db'), 'utf8')).toBe('SQLite format 3\0...');
    expect(JSON.parse(readFileSync(join(chat, 'meta.json'), 'utf8'))).toEqual({ schemaVersion: 1, title: 'Shop', cwd: cwdB });
    // The rewritten meta.json counts as in sync: B does not send it back.
    const put = vi.spyOn(relay, 'putObject');
    expect(await b.files.pushSession(onB, b.opts)).toBe(0);
    expect(put).not.toHaveBeenCalled();
    put.mockRestore();
  });
});

describe('paths from the relay', () => {
  it('never writes a Cursor chat outside its chats folder, whatever the session id says', async () => {
    const cwd = join(b.home, 'shop');
    const sid = '../../../../escape';
    const key = `cursor:${sid}`;
    const body = Buffer.from('owned');
    relay.objects.set('manifests/t9.json', Buffer.from(JSON.stringify({
      v: 1, files: {}, sessions: { [key]: { harness: 'cursor', id: sid, files: { 'evil.txt': { sha: sha(body), size: 5, mtime: 1 } } } },
    })));
    relay.objects.set(`sessions/cursor/${sid}/evil.txt`, body);
    expect(await b.files.pullSession(thread('t9', cwd, { harness: 'cursor', session_id: sid }), b.opts)).toBe(0);
    expect(existsSync(join(b.home, 'escape', 'evil.txt'))).toBe(false);
    expect(existsSync(join(b.home, '..', 'escape'))).toBe(false);
  });

  it('never builds a thread folder from an id that is not one folder name', async () => {
    const body = Buffer.from('owned');
    relay.objects.set('manifests/../../escape.json', Buffer.from(JSON.stringify({ v: 1, files: { 'uploads/x.txt': { sha: sha(body), size: 5, mtime: 1 } }, sessions: {} })));
    relay.objects.set(`blobs/${sha(body)}`, body);
    expect(await b.files.pullThreadFiles('../../escape', b.opts)).toEqual({ count: 0, skipped: 0 });
    expect(existsSync(join(b.config.paths.threads, '..', '..', 'escape'))).toBe(false);
  });
});

describe('a malformed manifest from the relay', () => {
  it('skips a broken entry and still downloads the rest, leaving no temp file behind', async () => {
    const good = Buffer.from('fine');
    const odd = Buffer.from('odd mtime');
    relay.objects.set(`blobs/${sha(good)}`, good);
    relay.objects.set(`blobs/${sha(odd)}`, odd);
    relay.objects.set('manifests/t10.json', Buffer.from(JSON.stringify({
      v: 1,
      files: {
        'uploads/a-null.txt': null,
        'uploads/b-odd.txt': { sha: sha(odd), size: odd.length, mtime: 'not a time' },
        'uploads/c-good.txt': { sha: sha(good), size: good.length, mtime: 1_700_000_000_000 },
      },
      sessions: {},
    })));
    const r = await b.files.pullThreadFiles('t10', b.opts);
    expect(r).toEqual({ count: 2, skipped: 1 });
    const dir = join(b.config.threadDir('t10'), 'uploads');
    expect(readFileSync(join(dir, 'c-good.txt'), 'utf8')).toBe('fine');
    expect(readFileSync(join(dir, 'b-odd.txt'), 'utf8')).toBe('odd mtime');
    expect(readdirSync(dir).filter((n) => n.startsWith('.'))).toEqual([]);
  });
});
