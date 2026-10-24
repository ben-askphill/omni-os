import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarize, type WorktreeItem } from '@omni/shared/worktree-inventory.ts';
import { startRunner } from './runner-boot.ts';

// The storage inventory against real temp repos with an origin: which folders it calls managed, orphan or stale,
// the reasons it keeps one, what it reports as unknown, and that a scan reports progress, can be cancelled and
// deletes nothing.

const r = await startRunner({ OMNI_KEEPALIVE_SECONDS: '0' });
// Each test makes worktree threads in real repos, which takes seconds when the whole suite runs at once.
const T = { timeout: 60_000 };
const { app } = await import('../app.ts');
const { inspectWorktree, startWorktreeScan, cancelWorktreeScan, currentWorktreeScan } = await import('../worktree-inventory.ts');
const { runsHere } = await import('../runner/state.ts');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

let n = 0;
function repo() {
  const origin = join(r.tmp, `inv-origin-${++n}.git`);
  const dir = join(r.tmp, `inv-repo-${n}`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.env\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  return dir;
}

async function worktreeThread() {
  const dir = repo();
  const channel = `inv-ch-${n}`;
  r.db.channels.create({ id: channel, name: channel, repo_path: dir, use_worktree: 1 });
  const t = await r.runner.createThread({ channel, prompt: 'work' });
  await r.untilResults(t.id, 1);
  await r.until('process closed', () => !runsHere(t.id));
  const wt = r.thread(t.id).cwd;
  mkdirSync(join(wt, 'node_modules'));
  writeFileSync(join(wt, 'node_modules', 'dep.js'), 'x');
  return { t: r.thread(t.id), repo: dir, wt };
}

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();
const codes = (it: WorktreeItem) => it.reasons.map((x) => x.code);
const scanDone = async () => {
  startWorktreeScan();
  await r.until('scan finished', () => currentWorktreeScan()?.state !== 'running');
  return currentWorktreeScan()!;
};

describe('worktree inventory: verdicts', T, () => {
  it('calls a worktree of an archived thread eligible, with its size, and build output does not keep it', async () => {
    const { t, wt } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    const it = await inspectWorktree(t.id);
    expect(it).toMatchObject({ kind: 'managed', verdict: 'eligible', eligibleBecause: 'archived', registered: true, folder: true, threadId: t.id });
    expect(it.reasons).toEqual([]);
    expect(it.bytes).toBeGreaterThan(0);
    expect(existsSync(wt)).toBe(true);
  });

  it('keeps an open thread, and a merged branch only once the thread has been idle a week', async () => {
    const { t } = await worktreeThread();
    r.db.threads.update(t.id, { updated_at: daysAgo(2) });
    expect(codes(await inspectWorktree(t.id))).toEqual(['open-thread']);
    r.db.threads.update(t.id, { updated_at: daysAgo(8) });
    expect(await inspectWorktree(t.id)).toMatchObject({ verdict: 'eligible', eligibleBecause: 'merged' });
  });

  it('calls a deleted thread eligible when the folder is on its planned branch in a channel repo', async () => {
    const { t } = await worktreeThread();
    r.db.db.prepare('DELETE FROM threads WHERE id = ?').run(t.id);
    expect(await inspectWorktree(t.id)).toMatchObject({ kind: 'managed', verdict: 'eligible', eligibleBecause: 'deleted', threadId: null });
  });

  it('keeps uncommitted, untracked and unpushed work and non-build ignored files, each with its count', async () => {
    const { t, wt } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    writeFileSync(join(wt, 'README.md'), 'edited\n');
    writeFileSync(join(wt, 'a.txt'), 'a');
    writeFileSync(join(wt, 'b.txt'), 'b');
    writeFileSync(join(wt, '.env'), 'SECRET=1\n');
    writeFileSync(join(wt, 'c.txt'), 'c');
    git(wt, 'add', 'c.txt');
    git(wt, 'commit', '-q', '-m', 'local');
    const it = await inspectWorktree(t.id);
    expect(it.verdict).toBe('kept');
    expect(codes(it).sort()).toEqual(['changed', 'ignored', 'unpushed', 'untracked']);
    const msg = (c: string) => it.reasons.find((x) => x.code === c)!.message;
    expect(msg('changed')).toBe('1 file with uncommitted changes.');
    expect(msg('untracked')).toBe('2 untracked files.');
    expect(msg('unpushed')).toBe('1 commit no remote has.');
    expect(msg('ignored')).toContain('.env');
    expect(msg('ignored')).not.toContain('node_modules');
  });

  it('keeps a thread with queued work, or a worktree whose branch moved', async () => {
    const { t, wt } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1, status: 'queued' });
    expect(codes(await inspectWorktree(t.id))).toContain('queued');
    r.db.threads.update(t.id, { status: 'done' });
    git(wt, 'checkout', '-q', '-b', 'elsewhere');
    expect(codes(await inspectWorktree(t.id))).toEqual(['branch-mismatch']);
  });

  it('keeps a folder another live thread also works in, and a running thread', async () => {
    const { t, wt } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    const other = await r.runner.createThread({ channel: t.channel_id, prompt: 'second' });
    r.db.threads.update(other.id, { cwd: wt });
    const it = await inspectWorktree(t.id);
    expect(codes(it)).toContain('shared');
    expect(it.sharedWith).toEqual([other.id]);
    r.db.threads.update(t.id, { status: 'running' });
    expect(codes(await inspectWorktree(t.id))).toContain('running');
  });

  it('reports an unreadable pull request state as unknown, not eligible', async () => {
    const { t } = await worktreeThread();
    r.db.db.prepare('UPDATE channels SET github_repo = ? WHERE id = ?').run('nobody/nothing-here', t.channel_id);
    r.db.threads.update(t.id, { archived: 1 });
    const it = await inspectWorktree(t.id);
    expect(it.verdict).toBe('unknown');
    expect(it.errors.join(' ')).toMatch(/could not read pull requests/);
  });
});

describe('worktree inventory: what is not managed', T, () => {
  it('lists a leftover folder no repo knows as an orphan that is kept', async () => {
    const id = `leftover-${Date.now()}`;
    mkdirSync(join(r.paths.worktrees, id));
    writeFileSync(join(r.paths.worktrees, id, 'x.txt'), 'x');
    expect(await inspectWorktree(id)).toMatchObject({ kind: 'orphan', verdict: 'kept', registered: false, repo: null });
  });

  it('never treats a worktree of an unrelated repo as managed', async () => {
    const stranger = repo();
    const id = `stranger-${Date.now()}`;
    git(stranger, 'worktree', 'add', '-q', '-b', 'feature', join(r.paths.worktrees, id));
    const it = await inspectWorktree(id);
    expect(it).toMatchObject({ kind: 'orphan', verdict: 'kept', registered: true });
    expect(codes(it)).toEqual(['unowned']);
  });

  it('does not follow a symlink into another repository', async () => {
    const id = `link-${Date.now()}`;
    symlinkSync(repo(), join(r.paths.worktrees, id));
    expect(await inspectWorktree(id)).toMatchObject({ kind: 'orphan', verdict: 'kept', bytes: 0 });
  });
});

describe('worktree inventory: stale registrations and missing folders', T, () => {
  it('separates a registration whose folder is gone, which takes no space', async () => {
    const { t, repo: main, wt } = await worktreeThread();
    rmSync(wt, { recursive: true, force: true });
    expect(git(main, 'worktree', 'list')).toContain(wt.replace(/^\/private/, ''));
    const scan = await scanDone();
    const stale = scan.items.find((i) => i.id === t.id)!;
    expect(stale).toMatchObject({ kind: 'stale-registration', verdict: 'eligible', eligibleBecause: 'stale', folder: false, registered: true, bytes: 0 });
    expect(summarize(scan.items).stale).toBeGreaterThan(0);
    expect(existsSync(wt)).toBe(false);
  });

  it('lists nothing for a thread whose worktree folder and registration are both gone', async () => {
    const { t, repo: main, wt } = await worktreeThread();
    rmSync(wt, { recursive: true, force: true });
    git(main, 'worktree', 'prune');
    expect((await scanDone()).items.find((i) => i.id === t.id)).toBeUndefined();
    expect(await inspectWorktree(t.id)).toMatchObject({ folder: false, verdict: 'unknown' });
  });
});

describe('worktree inventory: the thread changes during the scan', T, () => {
  it('reports unknown when the thread is archived between the checks and the verdict', async () => {
    const { t } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    const it = await inspectWorktree(t.id, { between: () => void r.db.threads.update(t.id, { archived: 0 }) });
    expect(it.verdict).toBe('unknown');
    expect(it.errors.join(' ')).toMatch(/changed while it was being checked/);
  });

  it('reports unknown when the thread is deleted mid-check', async () => {
    const { t } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    const it = await inspectWorktree(t.id, { between: () => void r.db.db.prepare('DELETE FROM threads WHERE id = ?').run(t.id) });
    expect(it.verdict).toBe('unknown');
  });

  it('keeps one whose thread started running mid-check', async () => {
    const { t } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    const it = await inspectWorktree(t.id, { between: () => void r.db.threads.update(t.id, { status: 'running' }) });
    expect(it.verdict).not.toBe('eligible');
  });
});

describe('worktree inventory: the background scan and its API', T, () => {
  it('reports progress, lists items and deletes nothing', async () => {
    const { t, wt } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    const first = await app.request('/api/worktrees/scan', { method: 'POST' });
    expect(first.status).toBe(202);
    expect((await first.json()).scan.state).toBe('running');
    await r.until('scan finished', () => currentWorktreeScan()?.state === 'done');
    const body = await (await app.request('/api/worktrees/scan')).json();
    expect(body.scan).toMatchObject({ state: 'done', phase: 'finished', total: body.scan.items.length, done: body.scan.total });
    expect(body.scan.items.find((i: WorktreeItem) => i.id === t.id)).toMatchObject({ verdict: 'eligible', kind: 'managed' });
    expect(body.summary.eligible.count).toBeGreaterThan(0);
    expect(existsSync(wt)).toBe(true);
  });

  it('cancels a running scan without a result for what was in flight, and then scans again', async () => {
    for (let i = 0; i < 3; i++) await worktreeThread();
    const scan = startWorktreeScan();
    expect(startWorktreeScan().id).toBe(scan.id);
    expect(cancelWorktreeScan()).toBe(true);
    const after = currentWorktreeScan()!;
    expect(after).toMatchObject({ state: 'cancelled', phase: 'finished' });
    expect(after.finishedAt).not.toBeNull();
    expect(cancelWorktreeScan()).toBe(false);
    const res = await app.request('/api/worktrees/scan/cancel', { method: 'POST' });
    expect((await res.json()).cancelled).toBe(false);
    expect((await scanDone()).state).toBe('done');
  }, 60_000);
});
