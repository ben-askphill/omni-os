import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The worktree sweep against real temp repos with an origin: what it removes (archived, deleted, merged and idle)
// and what it never touches (uncommitted or untracked changes, unpushed commits, a running thread), and that a
// thread whose worktree it removed gets it back on its next message.

const r = await startRunner({ OMNI_KEEPALIVE_SECONDS: '0' });
const { app } = await import('../app.ts');
const { sweepWorktrees } = await import('../worktree-sweep.ts');
const { runsHere } = await import('../runner/state.ts');

beforeAll(() => {
  r.config.worktreeSweep = true;
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

let n = 0;
/** A clone of a bare origin, on main, with everything pushed. */
function repo() {
  const origin = join(r.tmp, `sweep-origin-${++n}.git`);
  const dir = join(r.tmp, `sweep-repo-${n}`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  return dir;
}

/** A worktree thread whose first turn is done and whose process has exited. */
async function worktreeThread() {
  const dir = repo();
  const channel = `sweep-ch-${n}`;
  r.db.channels.create({ id: channel, name: channel, repo_path: dir, use_worktree: 1 });
  const t = await r.runner.createThread({ channel, prompt: 'work' });
  await r.untilResults(t.id, 1);
  await r.until('process closed', () => !runsHere(t.id));
  const wt = r.thread(t.id).cwd;
  // Ignored output never keeps a worktree.
  mkdirSync(join(wt, 'node_modules'));
  writeFileSync(join(wt, 'node_modules', 'dep.js'), 'x');
  return { t: r.thread(t.id), repo: dir, wt };
}

const archive = (id: string) =>
  app.request(`/api/threads/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }) });
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();
const branchExists = (dir: string, branch: string) => git(dir, 'branch', '--list', branch) !== '';

describe('worktree sweep: what it removes', () => {
  it('removes an archived thread worktree when Ben archives it, and keeps the branch', async () => {
    const { t, repo: main, wt } = await worktreeThread();
    expect((await archive(t.id)).status).toBe(200);
    await r.until('worktree removed', () => !existsSync(wt));
    expect(git(main, 'worktree', 'list')).not.toContain(wt);
    expect(branchExists(main, t.branch!)).toBe(true);
  });

  it('removes a worktree whose thread was deleted', async () => {
    const { t, wt } = await worktreeThread();
    r.db.db.prepare('DELETE FROM threads WHERE id = ?').run(t.id);
    const res = await sweepWorktrees({ only: t.id });
    expect(res.removed.map((x) => [x.threadId, x.reason])).toEqual([[t.id, 'deleted']]);
    expect(existsSync(wt)).toBe(false);
  });

  it('removes a merged branch once the thread has been idle a week, not before', async () => {
    const { t, wt } = await worktreeThread();
    r.db.threads.update(t.id, { updated_at: daysAgo(2) });
    expect((await sweepWorktrees({ only: t.id })).removed).toEqual([]);
    expect(existsSync(wt)).toBe(true);
    r.db.threads.update(t.id, { updated_at: daysAgo(8) });
    const res = await sweepWorktrees({ only: t.id });
    expect(res.removed.map((x) => x.reason)).toEqual(['merged']);
    expect(res.freedBytes).toBeGreaterThan(0);
    expect(existsSync(wt)).toBe(false);
  });

  it('runs every thread in one pass and prunes a worktree removed by hand', async () => {
    const { t: a, wt: wa } = await worktreeThread();
    const { t: b, wt: wb } = await worktreeThread();
    r.db.threads.update(a.id, { archived: 1 });
    r.db.threads.update(b.id, { updated_at: daysAgo(30) });
    const res = await sweepWorktrees();
    expect(res.removed.map((x) => x.threadId).sort()).toEqual([a.id, b.id].sort());
    expect(existsSync(wa) || existsSync(wb)).toBe(false);
  });
});

describe('worktree sweep: what it never removes', () => {
  it('keeps an archived worktree with uncommitted or untracked changes', async () => {
    const { t, wt } = await worktreeThread();
    writeFileSync(join(wt, 'notes.txt'), 'not committed\n');
    r.db.threads.update(t.id, { archived: 1 });
    const res = await sweepWorktrees({ only: t.id });
    expect(res.removed).toEqual([]);
    expect(res.skipped[0].reason).toMatch(/uncommitted or untracked/);
    expect(existsSync(join(wt, 'notes.txt'))).toBe(true);

    const { t: t2, wt: wt2 } = await worktreeThread();
    writeFileSync(join(wt2, 'README.md'), 'edited\n');
    r.db.threads.update(t2.id, { archived: 1 });
    expect((await sweepWorktrees({ only: t2.id })).skipped[0].reason).toMatch(/uncommitted/);
    expect(existsSync(wt2)).toBe(true);
  });

  it('keeps an archived worktree with commits that are not pushed', async () => {
    const { t, wt } = await worktreeThread();
    writeFileSync(join(wt, 'feature.txt'), 'work\n');
    git(wt, 'add', 'feature.txt');
    git(wt, 'commit', '-q', '-m', 'feature');
    r.db.threads.update(t.id, { archived: 1 });
    const res = await sweepWorktrees({ only: t.id });
    expect(res.skipped[0].reason).toBe('1 commit(s) not pushed');
    expect(existsSync(wt)).toBe(true);
    // Once pushed it may go: the branch on origin holds the work.
    git(wt, 'push', '-q', 'origin', t.branch!);
    expect((await sweepWorktrees({ only: t.id })).removed.map((x) => x.reason)).toEqual(['archived']);
  });

  it('keeps an idle worktree whose branch is pushed but not merged', async () => {
    const { t, wt } = await worktreeThread();
    writeFileSync(join(wt, 'feature.txt'), 'work\n');
    git(wt, 'add', 'feature.txt');
    git(wt, 'commit', '-q', '-m', 'feature');
    git(wt, 'push', '-q', 'origin', t.branch!);
    r.db.threads.update(t.id, { updated_at: daysAgo(30) });
    expect((await sweepWorktrees({ only: t.id })).removed).toEqual([]);
    expect(existsSync(wt)).toBe(true);
  });

  it('keeps the worktree of a running or queued thread, archived or not', async () => {
    for (const status of ['running', 'queued'] as const) {
      const { t, wt } = await worktreeThread();
      r.db.threads.update(t.id, { status, archived: 1 });
      const res = await sweepWorktrees({ only: t.id });
      expect(res.removed).toEqual([]);
      expect(res.skipped[0].reason).toBe('the thread is running');
      expect(existsSync(wt)).toBe(true);
      r.db.threads.update(t.id, { status: 'done' });
    }
  });

  it('keeps a worktree checked out on another branch than its thread', async () => {
    const { t, wt } = await worktreeThread();
    git(wt, 'checkout', '-q', '-b', 'side');
    r.db.threads.update(t.id, { archived: 1 });
    expect((await sweepWorktrees({ only: t.id })).skipped[0].reason).toMatch(/on branch side/);
    expect(existsSync(wt)).toBe(true);
  });

  it('does nothing on archive with the sweep turned off', async () => {
    const { t, wt } = await worktreeThread();
    r.config.worktreeSweep = false;
    try {
      await archive(t.id);
      await new Promise((done) => setTimeout(done, 300));
      expect(existsSync(wt)).toBe(true);
    } finally {
      r.config.worktreeSweep = true;
    }
  });
});

describe('reopening a thread whose worktree was removed', () => {
  it('checks its branch out again and runs the turn there', async () => {
    const { t, repo: main, wt } = await worktreeThread();
    writeFileSync(join(wt, 'kept.txt'), 'on the branch\n');
    git(wt, 'add', 'kept.txt');
    git(wt, 'commit', '-q', '-m', 'kept');
    git(wt, 'push', '-q', 'origin', t.branch!);
    r.db.threads.update(t.id, { archived: 1 });
    expect((await sweepWorktrees({ only: t.id })).removed).toHaveLength(1);
    expect(existsSync(wt)).toBe(false);

    r.db.threads.update(t.id, { archived: 0 });
    const res = await app.request(`/api/threads/${t.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'again' }),
    });
    expect(res.status).toBeLessThan(300);
    await r.untilResults(t.id, 2);
    expect(existsSync(join(wt, 'kept.txt'))).toBe(true);
    expect(git(wt, 'branch', '--show-current')).toBe(t.branch);
    expect(git(main, 'worktree', 'list')).toContain(wt);
    expect(r.thread(t.id).status).toBe('done');
  });
});
