import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SlimRun, SlimState } from '@omni/shared/worktree-slim.ts';
import type { WorktreeScan } from '@omni/shared/worktree-inventory.ts';
import { startRunner } from './runner-boot.ts';

// Stripping caches from idle worktrees against real temp repos: what a reviewed strip and the scheduled pass delete
// (only build output git ignores), that the worktree, its branch, its changes and other ignored files stay, what keeps
// a worktree out of the list (recent activity, a running turn), and that a link out of the worktree is never followed.

const r = await startRunner({ OMNI_KEEPALIVE_SECONDS: '0' });
const T = { timeout: 60_000 };
const { app } = await import('../app.ts');
const { configPath } = await import('../user-config.ts');
const { startWorktreeScan, currentWorktreeScan } = await import('../worktree-inventory.ts');
const { slimPass, slimState, setSlimPolicy } = await import('../worktree-slim.ts');
const { setRetentionPolicy } = await import('../worktree-cleanup.ts');
const { runsHere } = await import('../runner/state.ts');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

let n = 0;
function repo() {
  const origin = join(r.tmp, `slim-origin-${++n}.git`);
  const dir = join(r.tmp, `slim-repo-${n}`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  writeFileSync(join(dir, '.gitignore'), '.env\n');
  mkdirSync(join(dir, 'apps', 'mac', 'OmniKit'), { recursive: true });
  writeFileSync(join(dir, 'apps', 'mac', 'OmniKit', 'Package.swift'), '// swift\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  // Without a trailing slash, so a link named node_modules is ignored too.
  appendFileSync(join(dir, '.git', 'info', 'exclude'), 'node_modules\n.build\n');
  return dir;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();

/** An open thread's worktree, idle `idle` days, with installs, build output, an untracked file, a change and a .env. */
async function idleWorktree(idle = 10) {
  const dir = repo();
  const channel = `slim-ch-${n}`;
  r.db.channels.create({ id: channel, name: channel, repo_path: dir, use_worktree: 1 });
  const t = await r.runner.createThread({ channel, prompt: 'work' });
  await r.untilResults(t.id, 1);
  await r.until('process closed', () => !runsHere(t.id));
  const wt = r.thread(t.id).cwd;
  mkdirSync(join(wt, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(wt, 'node_modules', 'dep', 'index.js'), 'x'.repeat(64 * 1024));
  mkdirSync(join(wt, 'apps', 'mac', 'OmniKit', '.build'));
  writeFileSync(join(wt, 'apps', 'mac', 'OmniKit', '.build', 'out.o'), 'x'.repeat(64 * 1024));
  writeFileSync(join(wt, 'notes.txt'), 'mine\n');
  writeFileSync(join(wt, 'README.md'), 'edited\n');
  writeFileSync(join(wt, '.env'), 'SECRET=1\n');
  r.db.threads.update(t.id, { updated_at: daysAgo(idle) });
  return { t: r.thread(t.id), repo: dir, wt };
}

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
type View = { scan: WorktreeScan | null; slim: SlimState };
const view = async () => (await (await app.request('/api/worktrees/scan')).json()) as View;

async function scanned() {
  startWorktreeScan();
  await r.until('scan finished', () => currentWorktreeScan()?.state === 'done');
}
const manualDone = () =>
  r.until('strip finished', () => {
    const m = slimState().runs.manual;
    return m?.state !== 'running' && m;
  }, 20_000);
const outcome = (run: SlimRun, id: string) => run.items.find((i) => i.id === id)?.outcome;

describe('stripping caches', T, () => {
  it('measures caches, lists an idle open thread, and deletes only its build output', async () => {
    setSlimPolicy({ idleDays: 7 });
    const { t, repo: main, wt } = await idleWorktree();
    const head = git(wt, 'rev-parse', 'HEAD');
    await scanned();
    const before = await view();
    const item = before.scan!.items.find((i) => i.id === t.id)!;
    expect(item.cacheBytes).toBeGreaterThanOrEqual(128 * 1024);
    expect(item.verdict).toBe('kept');
    expect(before.slim.preview!.candidates.map((c) => c.id)).toContain(t.id);

    const res = await app.request('/api/worktrees/slim', json('POST', { ids: [t.id] }));
    expect(res.status).toBe(202);
    const run = await manualDone();
    expect(outcome(run, t.id)).toBe('slimmed');
    expect(run.freedBytes).toBeGreaterThanOrEqual(128 * 1024);

    expect(existsSync(join(wt, 'node_modules'))).toBe(false);
    expect(existsSync(join(wt, 'apps', 'mac', 'OmniKit', '.build'))).toBe(false);
    expect(readFileSync(join(wt, 'notes.txt'), 'utf8')).toBe('mine\n');
    expect(readFileSync(join(wt, 'README.md'), 'utf8')).toBe('edited\n');
    expect(readFileSync(join(wt, '.env'), 'utf8')).toBe('SECRET=1\n');
    expect(existsSync(join(wt, 'apps', 'mac', 'OmniKit', 'Package.swift'))).toBe(true);
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(main, 'worktree', 'list')).toContain(t.id);
    // The scan shows it without caches, so it is not offered again.
    const after = await view();
    expect(after.scan!.items.find((i) => i.id === t.id)!.cacheBytes).toBe(0);
    expect(after.slim.preview!.candidates.map((c) => c.id)).not.toContain(t.id);
  });

  it('leaves out a thread active within the idle days, and skips one that starts running after the scan', async () => {
    setSlimPolicy({ idleDays: 7 });
    const recent = await idleWorktree(2);
    const idle = await idleWorktree(10);
    await scanned();
    const ids = (await view()).slim.preview!.candidates.map((c) => c.id);
    expect(ids).not.toContain(recent.t.id);
    expect(ids).toContain(idle.t.id);

    r.db.threads.update(idle.t.id, { status: 'running' });
    await app.request('/api/worktrees/slim', json('POST', { ids: [idle.t.id] }));
    const run = await manualDone();
    r.db.threads.update(idle.t.id, { status: 'done' });
    expect(outcome(run, idle.t.id)).toBe('skipped');
    expect(run.items[0].reasons.map((x) => x.code)).toContain('running');
    expect(existsSync(join(idle.wt, 'node_modules', 'dep', 'index.js'))).toBe(true);
  });

  it('refuses ids the last scan did not list', async () => {
    const res = await app.request('/api/worktrees/slim', json('POST', { ids: ['not-a-worktree'] }));
    expect(res.status).toBe(409);
  });

  it('deletes a link named node_modules, never what it points to', async () => {
    setSlimPolicy({ idleDays: 7 });
    const { t, wt } = await idleWorktree();
    const outside = join(r.tmp, `outside-${n}`);
    mkdirSync(outside);
    writeFileSync(join(outside, 'precious.txt'), 'keep');
    execFileSync('rm', ['-rf', join(wt, 'node_modules')]);
    symlinkSync(outside, join(wt, 'node_modules'));
    await scanned();
    await app.request('/api/worktrees/slim', json('POST', { ids: [t.id] }));
    expect(outcome(await manualDone(), t.id)).toBe('slimmed');
    expect(existsSync(join(wt, 'node_modules'))).toBe(false);
    expect(readFileSync(join(outside, 'precious.txt'), 'utf8')).toBe('keep');
  });

  it("saves this Mac's schedule beside retention, and the scheduled pass runs only with it on", async () => {
    setRetentionPolicy({ enabled: false, idleDays: 30 });
    const res = await app.request('/api/worktrees/slim', json('PUT', { enabled: false, idleDays: 7 }));
    expect((await res.json()).slim.policy).toEqual({ enabled: false, idleDays: 7 });
    const saved = JSON.parse(readFileSync(configPath(), 'utf8'));
    expect(saved.worktrees).toEqual({ retention: { enabled: false, idleDays: 30 }, slim: { enabled: false, idleDays: 7 } });
    // Saving retention keeps the schedule.
    setRetentionPolicy({ idleDays: 14 });
    expect(JSON.parse(readFileSync(configPath(), 'utf8')).worktrees.slim).toEqual({ enabled: false, idleDays: 7 });

    const { t, wt } = await idleWorktree();
    expect(await slimPass()).toBeNull();
    expect(existsSync(join(wt, 'node_modules'))).toBe(true);
    setSlimPolicy({ enabled: true });
    const run = await slimPass();
    expect(run).toMatchObject({ trigger: 'scheduled', state: 'done' });
    expect(outcome(run!, t.id)).toBe('slimmed');
    expect(existsSync(join(wt, 'node_modules'))).toBe(false);
    expect(existsSync(join(wt, 'notes.txt'))).toBe(true);
    setSlimPolicy({ enabled: false });
  });

  it('rejects idle days outside 1 to 365', async () => {
    expect((await app.request('/api/worktrees/slim', json('PUT', { idleDays: 0 }))).status).toBe(400);
  });
});
