import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CleanupState } from '@omni/shared/worktree-cleanup.ts';
import type { WorktreeScan } from '@omni/shared/worktree-inventory.ts';
import { FAKE_CLAUDE, fakeAlive, sleep, waitFor } from './support.ts';

// The retention pass across a real restart: apps/server/index.ts as a process of its own on a throwaway data dir,
// with this Mac's policy on. The server is killed mid-turn, the data is left as a crash leaves it (a turn cut off, a
// file written while it was down, another thread now working in an archived thread's folder, folders Omni never
// made), and the pass that runs after the next boot removes only the clean, idle, archived worktree.

const ROOT = resolve(import.meta.dirname, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'omni-retention-'));
const data = join(tmp, 'data');
const fakeLog = join(tmp, 'fake-claude.jsonl');
const T = { timeout: 90_000 };
const children: ChildProcess[] = [];

const killFakes = () => {
  const lines = existsSync(fakeLog) ? readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  for (const pid of new Set(lines.map((l) => l.pid as number))) if (fakeAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
};

afterAll(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  killFakes();
  rmSync(tmp, { recursive: true, force: true });
});

function boot(firstPassMs: number) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'apps/server/index.ts'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      OMNI_DATA_DIR: data,
      OMNI_TOKEN: process.env.OMNI_TOKEN,
      OMNI_PORT: '0',
      OMNI_HOST: '127.0.0.1',
      OMNI_CLAUDE_BIN: FAKE_CLAUDE,
      OMNI_CODEX_BIN: join(tmp, 'no-codex'),
      OMNI_CURSOR_BIN: join(tmp, 'no-cursor-agent'),
      OMNI_BROWSER: '0',
      OMNI_BRAIN_DIR: join(tmp, 'brain'),
      OMNI_DEFAULT_MODEL: 'sonnet',
      OMNI_KEEPALIVE_SECONDS: '0',
      OMNI_SUGGESTIONS: '0',
      OMNI_WEB_DIST: join(tmp, 'no-web'),
      OMNI_RETENTION_FIRST_PASS_MS: String(firstPassMs),
      FAKE_CLAUDE_LOG: fakeLog,
      FAKE_CLAUDE_LATENCY_MS: '10',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  child.stdout!.on('data', (d) => (output += d));
  child.stderr!.on('data', (d) => (output += d));
  const port = waitFor(() => Number(output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]) || (child.exitCode !== null && -1), () => `the server to listen:\n${output}`, 20_000).then((p) => {
    if (p === -1) throw new Error(`the server exited before it listened:\n${output}`);
    return p;
  });
  return { child, port, output: () => output };
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

function repo(name: string) {
  const origin = join(tmp, `${name}.git`);
  const dir = join(tmp, name);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), `${name}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  return dir;
}

function client(port: number) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${process.env.OMNI_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return JSON.parse(text);
  };
}

type Thread = { id: string; status: string; cwd: string };

describe('the retention pass after a restart', () => {
  it('removes only the clean idle archived worktree, never an unmanaged, shared, active or newly changed one', T, async () => {
    mkdirSync(join(tmp, 'brain'));
    mkdirSync(data);
    writeFileSync(join(data, 'omni.config.json'), JSON.stringify({ version: 1, worktrees: { retention: { enabled: true, idleDays: 1 } } }));
    const shop = repo('shop');

    const first = boot(3_600_000);
    const api = client(await first.port);
    await api('POST', '/channels', { id: 'shop', name: 'Shop', kind: 'client', use_worktree: 1, repo_path: shop });
    await api('POST', '/channels', { id: 'notes', name: 'Notes', kind: 'client', use_worktree: 0, base_dir: join(tmp, 'notes') });
    const start = async (channel: string, prompt: string) => (await api('POST', '/threads', { channel, prompt, title: prompt })) as Thread;
    const idle = async (t: Thread) => {
      for (const end = Date.now() + 20_000; ; await sleep(50)) {
        const d = (await api('GET', `/threads/${t.id}`)) as { thread: Thread };
        if (d.thread.status === 'done') return d.thread;
        if (Date.now() > end) throw new Error(`thread ${t.id} never finished: ${d.thread.status}`);
      }
    };
    const clean = await idle(await start('shop', 'tidy the shop'));
    const changed = await idle(await start('shop', 'draft the notes'));
    const owner = await idle(await start('shop', 'lend the folder'));
    const sharer = await idle(await start('notes', 'work in the shop folder'));
    for (const t of [clean, changed, owner]) await api('PATCH', `/threads/${t.id}`, { archived: true });
    const running = async (prompt: string) => {
      const t = await start('shop', prompt);
      for (const end = Date.now() + 20_000; ; await sleep(50)) {
        const d = (await api('GET', `/threads/${t.id}`)) as { thread: Thread; events: { kind: string }[] };
        if (d.thread.status === 'running' && d.events.some((e) => e.kind === 'tool_use')) break;
        if (Date.now() > end) throw new Error(`${prompt} never ran its tool`);
      }
      await api('PATCH', `/threads/${t.id}`, { archived: true });
      return ((await api('GET', `/threads/${t.id}`)) as { thread: Thread }).thread;
    };
    // Mid-turn at the kill, with a message held behind the turn: the restart parks it for Resume.
    const held = await running('TOOL:60000 audit the checkout');
    await api('POST', `/threads/${held.id}/messages`, { prompt: 'then write it up', mode: 'queue' });
    // Mid-turn at the kill with nothing held: the restart marks it failed and leaves when it was last active.
    const cut = await running('TOOL:60000 count the stock');

    first.child.kill('SIGKILL');
    await waitFor(() => first.child.exitCode !== null || first.child.signalCode !== null, 'the killed server to exit');
    killFakes();

    // While it was down: everything but the turn cut off went idle long ago, a file was written, another thread moved
    // into a folder, and two folders appeared that Omni never made.
    const db = new DatabaseSync(join(data, 'omni.db'));
    db.prepare('UPDATE threads SET updated_at = ? WHERE id != ?').run(new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), cut.id);
    db.prepare('UPDATE threads SET cwd = ? WHERE id = ?').run(owner.cwd, sharer.id);
    db.close();
    writeFileSync(join(changed.cwd, 'draft.md'), 'not saved\n');
    const leftover = join(data, 'worktrees', 'leftover');
    mkdirSync(leftover);
    writeFileSync(join(leftover, 'mine.txt'), 'mine\n');
    const other = repo('other');
    const foreign = join(data, 'worktrees', 'foreign');
    git(other, 'worktree', 'add', '-q', '-b', 'foreign', foreign);

    const second = boot(200);
    const api2 = client(await second.port);
    await waitFor(() => /\[worktrees\] retention cleanup:/.test(second.output()), () => `the retention pass:\n${second.output()}`, 30_000);

    expect(existsSync(clean.cwd)).toBe(false);
    expect(git(shop, 'branch', '--list', `omni/${clean.id.slice(0, 8)}`)).not.toBe('');
    for (const [name, dir] of Object.entries({ changed: changed.cwd, owner: owner.cwd, held: held.cwd, cut: cut.cwd, leftover, foreign })) expect(existsSync(dir), `${name} ${dir}\n${second.output()}`).toBe(true);
    expect(readFileSync(join(changed.cwd, 'draft.md'), 'utf8')).toBe('not saved\n');
    expect(readFileSync(join(leftover, 'mine.txt'), 'utf8')).toBe('mine\n');

    const v = (await api2('GET', '/worktrees/scan')) as { scan: WorktreeScan; cleanup: CleanupState };
    expect(v.cleanup.runs.retention!.items.map((i) => [i.id, i.outcome])).toEqual([[clean.id, 'removed']]);
    const why = (id: string) => v.scan.items.find((i) => i.id === id)!.reasons.map((r) => r.code);
    expect(why(changed.id)).toContain('untracked');
    expect(why(owner.id)).toContain('shared');
    expect(why(held.id)).toContain('queued');
    expect(v.scan.items.find((i) => i.id === cut.id)!.lastActiveAt! > new Date(Date.now() - 3600_000).toISOString()).toBe(true);
    expect(v.scan.items.find((i) => i.id === 'leftover')).toMatchObject({ kind: 'orphan', verdict: 'kept' });
    expect(v.scan.items.find((i) => i.id === 'foreign')).toMatchObject({ kind: 'orphan', verdict: 'kept' });
  });
});
