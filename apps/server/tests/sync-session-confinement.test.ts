import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';

// A session push uploads only a file this machine finds in the harness's own session folder: never one the relay's
// file list names, and never one a link leads to outside that folder (security audit: "Codex sync trusts remote
// filenames when choosing local files to upload").

/**
 * The next call of one of `fns` on one of `paths` runs `before` first and `after` once it returns: a swap in a gap
 * between two steps of a session push.
 */
interface Hook {
  fns: string[];
  paths: string[];
  before: () => void;
  after: () => void;
}
const race = vi.hoisted(() => ({ hooks: [] as Hook[], noProc: false }));

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const around = <F extends (...args: any[]) => any>(name: string, fn: F) =>
    ((p: unknown, ...rest: unknown[]) => {
      const i = race.hooks.findIndex((h) => h.fns.includes(name) && h.paths.includes(p as string));
      if (i < 0) return fn(p, ...rest);
      const [hook] = race.hooks.splice(i, 1);
      hook.before();
      try {
        return fn(p, ...rest);
      } finally {
        hook.after();
      }
    }) as F;
  // As on macOS, which has no /proc to name an open file's path.
  const readlinkSync = ((p: unknown, ...rest: unknown[]) => {
    if (race.noProc && typeof p === 'string' && p.startsWith('/proc/')) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    return (fs.readlinkSync as (...args: unknown[]) => unknown)(p, ...rest);
  }) as typeof fs.readlinkSync;
  const openSync = around('openSync', fs.openSync);
  const readFileSync = around('readFileSync', fs.readFileSync);
  const lstatSync = around('lstatSync', fs.lstatSync);
  const wrapped = { openSync, readFileSync, lstatSync, readlinkSync };
  return { ...fs, ...wrapped, default: { ...fs, ...wrapped } };
});

const relay = new MemoryTransport();
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const stored = (key: string) => (relay.objects.has(key) ? Buffer.from(relay.objects.get(key)!).toString() : null);

async function machine(name: string) {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), `omni-confine-${name}-`));
  process.env.OMNI_DATA_DIR = join(root, 'data');
  const home = join(root, 'home');
  mkdirSync(home);
  const files = await import('../sync/files.ts');
  await import('../db.ts');
  const put = (rel: string, body: string) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
    return p;
  };
  /** The push options with a CODEX_HOME of this test's own, so no test sees another's rollouts. */
  const codex = (dir: string) => ({ transport: relay, home, env: { CODEX_HOME: join(root, dir) } });
  return { root, home, files, put, codex, opts: { transport: relay, home, env: {} } };
}

const thread = (id: string, cwd: string, patch: Record<string, unknown>) => ({
  id, channel_id: 'inbox', title: 'Session', status: 'done', role: null, model: null, harness: 'claude-code', effort: '',
  session_id: id, has_run: 1, cwd, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  last_text: null, created_at: '2026-11-18T10:00:00.000Z', updated_at: '2026-11-18T10:00:00.000Z', ...patch,
}) as any;

/** A relay file list for the thread whose session entry names `files`. */
const hostileManifest = (threadId: string, harness: string, sid: string, files: string[]) =>
  relay.objects.set(`manifests/${threadId}.json`, Buffer.from(JSON.stringify({
    v: 1, files: {},
    sessions: { [`${harness}:${sid}`]: { harness, id: sid, files: Object.fromEntries(files.map((f) => [f, { sha: sha('old'), size: 3, mtime: 1 }])) } },
  })));

let a: Awaited<ReturnType<typeof machine>>;
let b: Awaited<ReturnType<typeof machine>>;

beforeAll(async () => {
  a = await machine('a');
  b = await machine('b');
});

afterEach(() => {
  race.hooks.length = 0;
  race.noProc = false;
});

describe('a session file the relay names', () => {
  it('uploads the Codex rollout found here, not a file outside the sessions folder that the relay lists', async () => {
    const sid = '01a0bc16-4ca5-79c3-805a-d8efb930a001';
    a.put('secret.txt', 'private key');
    a.put(`codex-1/sessions/2026/11/18/rollout-2026-11-18T10-00-00-${sid}.jsonl`, '{"type":"session_meta"}\n');
    hostileManifest('x1', 'codex', sid, ['../../secret.txt']);
    expect(await a.files.pushSession(thread('x1', join(a.home, 'w'), { harness: 'codex', session_id: sid }), a.codex('codex-1'))).toBe(1);
    expect(stored(`sessions/codex/${sid}.jsonl`)).toBe('{"type":"session_meta"}\n');
  });

  it('never uploads another session\'s rollout that the relay lists for this one', async () => {
    const sid = '01a0bc16-4ca5-79c3-805a-d8efb930a002';
    const other = '2026/11/17/rollout-2026-11-17T09-00-00-01a0bc16-0000-0000-0000-000000000000.jsonl';
    a.put(`codex-2/sessions/${other}`, 'another chat\n');
    hostileManifest('x2', 'codex', sid, [other]);
    expect(await a.files.pushSession(thread('x2', join(a.home, 'w'), { harness: 'codex', session_id: sid }), a.codex('codex-2'))).toBe(0);
    expect(stored(`sessions/codex/${sid}.jsonl`)).toBeNull();
  });

  it('still finds a rollout it pulled, and sends its edits back', async () => {
    const sid = '01a0bc16-4ca5-79c3-805a-d8efb930a003';
    const rel = `2026/11/18/rollout-2026-11-18T11-00-00-${sid}.jsonl`;
    a.put(`codex-3/sessions/${rel}`, 'turn on A\n');
    const t = (cwd: string) => thread('x3', cwd, { harness: 'codex', session_id: sid });
    expect(await a.files.pushSession(t(join(a.home, 'w')), a.codex('codex-3'))).toBe(1);
    expect(await b.files.pullSession(t(join(b.home, 'w')), b.codex('codex-3'))).toBe(1);
    b.put(`codex-3/sessions/${rel}`, 'turn on A\nturn on B\n');
    expect(await b.files.pushSession(t(join(b.home, 'w')), b.codex('codex-3'))).toBe(1);
    expect(stored(`sessions/codex/${sid}.jsonl`)).toBe('turn on A\nturn on B\n');
  });
});

describe('a session file behind a link', () => {
  it('leaves a Claude Code session file that is a symlink on this machine', async () => {
    const sid = 'c0ffee00-0000-4000-8000-00000000a001';
    const cwd = join(a.home, 'link-file');
    const secret = a.put('home/.ssh/id_test', 'private key');
    const dir = join(a.home, '.claude', 'projects', a.files.claudeProjectDir(cwd));
    mkdirSync(dir, { recursive: true });
    symlinkSync(secret, join(dir, `${sid}.jsonl`));
    expect(await a.files.pushSession(thread('l1', cwd, { session_id: sid }), a.opts)).toBe(0);
    expect(stored(`sessions/claude-code/${sid}.jsonl`)).toBeNull();
  });

  it('fails a handoff upload rather than hand off without the session', async () => {
    const sid = 'c0ffee00-0000-4000-8000-00000000a005';
    const cwd = join(a.home, 'link-handoff');
    const secret = a.put('home/.ssh/id_handoff', 'private key');
    const dir = join(a.home, '.claude', 'projects', a.files.claudeProjectDir(cwd));
    mkdirSync(dir, { recursive: true });
    symlinkSync(secret, join(dir, `${sid}.jsonl`));
    await expect(a.files.pushSession(thread('l5', cwd, { session_id: sid }), { ...a.opts, strict: true })).rejects.toThrow(/not a plain file/);
    expect(stored(`sessions/claude-code/${sid}.jsonl`)).toBeNull();
  });

  // Root reads any folder, so the folder below would not stop it.
  it.skipIf(process.getuid?.() === 0)('fails a handoff upload when the Codex sessions folder cannot be read', async () => {
    const sid = '01a0bc16-4ca5-79c3-805a-d8efb930a006';
    a.put(`codex-6/sessions/2026/11/18/rollout-2026-11-18T14-00-00-${sid}.jsonl`, 'turn\n');
    const year = join(a.root, 'codex-6', 'sessions', '2026');
    chmodSync(year, 0o000);
    try {
      const t = thread('l6', join(a.home, 'w'), { harness: 'codex', session_id: sid });
      await expect(a.files.pushSession(t, { ...a.codex('codex-6'), strict: true })).rejects.toThrow(/EACCES/);
    } finally {
      chmodSync(year, 0o755);
    }
    expect(stored(`sessions/codex/${sid}.jsonl`)).toBeNull();
  });

  it('leaves a Codex rollout in a folder linked from outside the sessions folder', async () => {
    const sid = '01a0bc16-4ca5-79c3-805a-d8efb930a004';
    a.put(`outside/11/18/rollout-2026-11-18T12-00-00-${sid}.jsonl`, 'private\n');
    mkdirSync(join(a.root, 'codex-4', 'sessions'), { recursive: true });
    symlinkSync(join(a.root, 'outside'), join(a.root, 'codex-4', 'sessions', '2026'));
    expect(await a.files.pushSession(thread('l2', join(a.home, 'w'), { harness: 'codex', session_id: sid }), a.codex('codex-4'))).toBe(0);
    expect(stored(`sessions/codex/${sid}.jsonl`)).toBeNull();
  });

  it('leaves a Cursor chat whose folder is a link', async () => {
    const sid = '06da61e9-a772-4ee1-9270-768dc1c8a001';
    const cwd = join(a.home, 'link-chat');
    a.put('elsewhere/store.db', 'private db');
    a.put('elsewhere/meta.json', '{}');
    const chats = join(a.home, '.cursor', 'chats', md5(cwd));
    mkdirSync(chats, { recursive: true });
    symlinkSync(join(a.root, 'elsewhere'), join(chats, sid));
    expect(await a.files.pushSession(thread('l3', cwd, { harness: 'cursor', session_id: sid }), a.opts)).toBe(0);
    expect(stored(`sessions/cursor/${sid}/store.db`)).toBeNull();
  });

  it('still syncs when the harness folder itself is a link, as with CODEX_HOME on another disk', async () => {
    const sid = '01a0bc16-4ca5-79c3-805a-d8efb930a005';
    a.put(`disk/codex/sessions/2026/11/18/rollout-2026-11-18T13-00-00-${sid}.jsonl`, 'turn\n');
    symlinkSync(join(a.root, 'disk', 'codex'), join(a.root, 'codex-5'));
    expect(await a.files.pushSession(thread('l4', join(a.home, 'w'), { harness: 'codex', session_id: sid }), a.codex('codex-5'))).toBe(1);
    expect(stored(`sessions/codex/${sid}.jsonl`)).toBe('turn\n');
  });
});

describe('a session file that is not a plain file', () => {
  it('leaves a named pipe where the session file should be', async () => {
    const sid = 'c0ffee00-0000-4000-8000-00000000a002';
    const cwd = join(a.home, 'fifo');
    const dir = join(a.home, '.claude', 'projects', a.files.claudeProjectDir(cwd));
    mkdirSync(dir, { recursive: true });
    const fifo = join(dir, `${sid}.jsonl`);
    execFileSync('mkfifo', [fifo]);
    // Something feeds the pipe whatever it likes; a read of it would upload that.
    const writer = spawn('sh', ['-c', 'printf "private key" > "$0"', fifo], { stdio: 'ignore' });
    try {
      expect(await a.files.pushSession(thread('p1', cwd, { session_id: sid }), a.opts)).toBe(0);
      expect(stored(`sessions/claude-code/${sid}.jsonl`)).toBeNull();
    } finally {
      writer.kill();
    }
  });
});

describe('a session folder swapped for a link during the push', () => {
  /** A Claude Code session, a decoy outside its folder, and the swaps that put a link to the decoy in the folder's place and back. */
  const setup = (cwd: string, sid: string) => {
    const name = a.files.claudeProjectDir(cwd);
    const dir = join(a.home, '.claude', 'projects', name);
    const path = a.put(`home/.claude/projects/${name}/${sid}.jsonl`, 'turn 1\n');
    a.put(`decoy-${sid}/${sid}.jsonl`, 'private key');
    return {
      // The push may use the path as given or with its folders resolved (on macOS, /var is a link to /private/var).
      paths: [path, join(realpathSync(a.home), '.claude', 'projects', name, `${sid}.jsonl`)],
      before: () => {
        renameSync(dir, `${dir}.real`);
        symlinkSync(join(a.root, `decoy-${sid}`), dir);
      },
      after: () => {
        unlinkSync(dir);
        renameSync(`${dir}.real`, dir);
      },
    };
  };
  const swapAt = (fns: string[], s: ReturnType<typeof setup>) => race.hooks.push({ fns, ...s });

  it('checks the file it opened, not the path, and uploads nothing from outside', async () => {
    const sid = 'c0ffee00-0000-4000-8000-00000000a003';
    const cwd = join(a.home, 'swap');
    swapAt(['openSync', 'readFileSync'], setup(cwd, sid));
    expect(await a.files.pushSession(thread('s1', cwd, { session_id: sid }), a.opts)).toBe(0);
    expect(stored(`sessions/claude-code/${sid}.jsonl`)).toBeNull();
    // The real session goes up with the next push.
    expect(await a.files.pushSession(thread('s1', cwd, { session_id: sid }), a.opts)).toBe(1);
    expect(stored(`sessions/claude-code/${sid}.jsonl`)).toBe('turn 1\n');
  });

  it('does the same where the system cannot name an open file\'s path', async () => {
    const sid = 'c0ffee00-0000-4000-8000-00000000a004';
    const cwd = join(a.home, 'swap-no-proc');
    race.noProc = true;
    swapAt(['openSync', 'readFileSync'], setup(cwd, sid));
    expect(await a.files.pushSession(thread('s2', cwd, { session_id: sid }), a.opts)).toBe(0);
    expect(stored(`sessions/claude-code/${sid}.jsonl`)).toBeNull();
    expect(await a.files.pushSession(thread('s2', cwd, { session_id: sid }), a.opts)).toBe(1);
  });

  // Linux catches this through /proc, macOS in the open itself. A path check after the open alone would not.
  it('is not fooled by a second swap between its checks', async () => {
    const sid = 'c0ffee00-0000-4000-8000-00000000a007';
    const cwd = join(a.home, 'swap-twice');
    const s = setup(cwd, sid);
    swapAt(['openSync', 'readFileSync'], s);
    swapAt(['lstatSync'], s);
    expect(await a.files.pushSession(thread('s3', cwd, { session_id: sid }), a.opts)).toBe(0);
    expect(stored(`sessions/claude-code/${sid}.jsonl`)).toBeNull();
  });
});
