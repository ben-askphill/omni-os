import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CleanupRun, CleanupState } from '@omni/shared/worktree-cleanup.ts';
import type { WorktreeScan } from '@omni/shared/worktree-inventory.ts';
import { startRunner } from './runner-boot.ts';
import { sleep } from './support.ts';

// Worktree cleanup against real temp repos with an origin: what a reviewed cleanup and the retention pass remove,
// that branches, transcripts, uploads and artifacts stay, that the next turn checks the branch out again, and what
// keeps a worktree: changes after the review, a turn, message or terminal that comes in during the checks, held
// input, and anything the review did not list. A merged branch counts only when origin's default branch has it.

const r = await startRunner({ OMNI_KEEPALIVE_SECONDS: '0' });
// Each test makes a few worktree threads in real repos, which takes seconds when the whole suite runs at once.
const T = { timeout: 60_000 };
const { app } = await import('../app.ts');
const { artifactsDir, uploadsDir } = await import('../config.ts');
const { configPath } = await import('../user-config.ts');
const { inspectWorktree, startWorktreeScan, currentWorktreeScan } = await import('../worktree-inventory.ts');
const { cleanupState, retentionPass, setRetentionPolicy, startCleanup } = await import('../worktree-cleanup.ts');
const { withWorkspace, keptRef, trashOf } = await import('../workspace.ts');
const { closeTerminal, openTerminal } = await import('../terminal.ts');
const { runsHere } = await import('../runner/state.ts');
const { startRun, stopRun } = await import('../actions.ts');
const { channelActions } = await import('../db.ts');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

// gh, as the merge check calls it: the merged PRs this test writes, and no open ones.
const merged = join(r.tmp, 'gh-merged.json');
writeFileSync(join(r.tmp, 'bin', 'gh'), `#!/bin/sh\ncase "$*" in *"--state merged"*) cat "${merged}" 2>/dev/null || echo '[]' ;; *) echo '[]' ;; esac\n`, { mode: 0o755 });

let n = 0;
/** A clone of a bare origin, on main, with everything pushed. */
function repo() {
  const origin = join(r.tmp, `clean-origin-${++n}.git`);
  const dir = join(r.tmp, `clean-repo-${n}`);
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

/** A worktree thread whose first turn is done and whose process has exited, with build output that never keeps it. */
async function worktreeThread(dir = repo()) {
  const channel = `clean-ch-${n}`;
  if (!r.db.channels.get(channel)) r.db.channels.create({ id: channel, name: channel, repo_path: dir, use_worktree: 1 });
  const t = await r.runner.createThread({ channel, prompt: 'work' });
  await r.untilResults(t.id, 1);
  await r.until('process closed', () => !runsHere(t.id));
  const wt = r.thread(t.id).cwd;
  mkdirSync(join(wt, 'node_modules'));
  writeFileSync(join(wt, 'node_modules', 'dep.js'), 'x');
  return { t: r.thread(t.id), repo: dir, wt };
}

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
type View = { scan: WorktreeScan | null; cleanup: CleanupState };
const view = async () => (await (await app.request('/api/worktrees/scan')).json()) as View;
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();
const commit = (wt: string, file: string) => {
  writeFileSync(join(wt, file), `${file}\n`);
  git(wt, 'add', file);
  git(wt, 'commit', '-q', '-m', file);
  return git(wt, 'rev-parse', 'HEAD');
};

/** The manual run once it has finished. */
const manualDone = () =>
  r.until('cleanup finished', () => {
    const m = cleanupState().runs.manual;
    return m?.state !== 'running' && m;
  }, 20_000);

async function scanned() {
  startWorktreeScan();
  await r.until('scan finished', () => currentWorktreeScan()?.state === 'done');
}

/** A manual cleanup of ids, run to its end. */
async function cleanUp(ids: string[], opts: Parameters<typeof startCleanup>[1] = {}): Promise<CleanupRun> {
  await scanned();
  startCleanup(ids, opts);
  return manualDone();
}
const outcomes = (run: CleanupRun) => Object.fromEntries(run.items.map((i) => [i.id, i.outcome]));
const codes = (run: CleanupRun, id: string) => run.items.find((i) => i.id === id)!.reasons.map((x) => x.code);

describe('cleanup: what it removes', T, () => {
  it('previews, then removes what Ben reviewed, keeping the branch, its last commit, the transcript, uploads and artifacts', async () => {
    const { t, repo: main, wt } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    mkdirSync(artifactsDir(t.id), { recursive: true });
    writeFileSync(join(artifactsDir(t.id), 'report.html'), '<p>kept</p>');
    mkdirSync(uploadsDir(t.id), { recursive: true });
    writeFileSync(join(uploadsDir(t.id), 'brief.pdf'), 'kept');
    const events = r.events(t.id).length;
    const head = git(wt, 'rev-parse', 'HEAD');

    await scanned();
    const before = await view();
    expect(before.cleanup.preview!.manual.candidates.map((c) => [c.id, c.because])).toContainEqual([t.id, 'archived']);

    const res = await app.request('/api/worktrees/cleanup', json('POST', { ids: [t.id] }));
    expect(res.status).toBe(202);
    const run = await manualDone();
    expect(outcomes(run)).toEqual({ [t.id]: 'removed' });
    expect(run.freedBytes).toBeGreaterThan(0);
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(trashOf(wt))).toBe(false);
    expect(git(main, 'worktree', 'list')).not.toContain(wt);
    expect(git(main, 'rev-parse', `refs/heads/${t.branch}`)).toBe(head);
    expect(git(main, 'rev-parse', keptRef(t.id))).toBe(head);
    expect(r.events(t.id)).toHaveLength(events);
    expect(readFileSync(join(artifactsDir(t.id), 'report.html'), 'utf8')).toBe('<p>kept</p>');
    expect(existsSync(join(uploadsDir(t.id), 'brief.pdf'))).toBe(true);
    // The inventory drops it, so it is not offered again.
    expect((await view()).scan!.items.map((i) => i.id)).not.toContain(t.id);
  });

  it('checks the branch out again on the next message, and makes the branch again from the kept commit when it is gone', async () => {
    const { t, repo: main, wt } = await worktreeThread();
    const head = commit(wt, 'kept.txt');
    git(wt, 'push', '-q', 'origin', t.branch!);
    r.db.threads.update(t.id, { archived: 1 });
    expect(outcomes(await cleanUp([t.id]))).toEqual({ [t.id]: 'removed' });

    git(main, 'branch', '-D', t.branch!);
    git(main, 'push', '-q', 'origin', '--delete', t.branch!);
    r.db.threads.update(t.id, { archived: 0 });
    const res = await app.request(`/api/threads/${t.id}/messages`, json('POST', { prompt: 'again' }));
    expect(res.status).toBeLessThan(300);
    await r.untilResults(t.id, 2);
    expect(git(wt, 'branch', '--show-current')).toBe(t.branch);
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(head);
    expect(existsSync(join(wt, 'kept.txt'))).toBe(true);
  });

  it("resumes at the kept commit when origin's copy of a deleted branch is behind it", async () => {
    const { t, repo: main, wt } = await worktreeThread();
    commit(wt, 'pushed.txt');
    git(wt, 'push', '-q', 'origin', t.branch!);
    // The last commit is on origin only under another name, so nothing local is lost and the cleanup removes it.
    const head = commit(wt, 'later.txt');
    git(wt, 'push', '-q', 'origin', 'HEAD:refs/heads/elsewhere');
    r.db.threads.update(t.id, { archived: 1 });
    expect(outcomes(await cleanUp([t.id]))).toEqual({ [t.id]: 'removed' });

    git(main, 'branch', '-D', t.branch!);
    r.runner.sendMessage(t.id, 'again');
    await r.untilResults(t.id, 2);
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(main, 'for-each-ref', keptRef(t.id))).toBe('');
  });

  it('gets the checkout back after a removal cut short after its move, and finishes the removal on the next run', async () => {
    const { t, repo: main, wt } = await worktreeThread();
    const other = await worktreeThread(main);
    const head = git(wt, 'rev-parse', 'HEAD');
    for (const x of [t.id, other.t.id]) r.db.threads.update(x, { archived: 1 });
    // What a restart in the middle of a removal leaves: the folder moved aside, still on the thread's branch.
    git(main, 'worktree', 'move', wt, trashOf(wt));
    await scanned();
    const leftover = currentWorktreeScan()!.items.find((i) => i.id === `.removing-${t.id}`)!;
    expect(leftover).toMatchObject({ verdict: 'kept', reasons: [{ code: 'unowned', message: expect.stringMatching(/cut short/) }] });

    r.runner.sendMessage(t.id, 'back to it');
    await r.untilResults(t.id, 2);
    expect(git(wt, 'branch', '--show-current')).toBe(t.branch);
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(head);

    expect(outcomes(await cleanUp([other.t.id]))).toEqual({ [other.t.id]: 'removed' });
    expect(existsSync(trashOf(wt))).toBe(false);
    expect(existsSync(join(wt, 'README.md'))).toBe(true);
  });

  it("checks a removed folder out again on its owner's branch for another thread working in it", async () => {
    const owner = await worktreeThread();
    const sharer = await r.runner.createThread({ channel: 'scratch', prompt: 'share' });
    await r.untilResults(sharer.id, 1);
    await r.until('process closed', () => !runsHere(sharer.id));
    r.db.threads.update(sharer.id, { cwd: owner.wt, archived: 1 });
    r.db.threads.update(owner.t.id, { archived: 1 });
    expect(outcomes(await cleanUp([owner.t.id]))).toEqual({ [owner.t.id]: 'removed' });

    r.db.threads.update(sharer.id, { archived: 0 });
    r.runner.sendMessage(sharer.id, 'back in the shared folder');
    await r.untilResults(sharer.id, 2);
    expect(git(owner.wt, 'branch', '--show-current')).toBe(owner.t.branch);
  });

  it('says what to do when the branch and the kept commit are both gone', async () => {
    const { t, repo: main } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    expect(outcomes(await cleanUp([t.id]))).toEqual({ [t.id]: 'removed' });
    git(main, 'branch', '-D', t.branch!);
    git(main, 'update-ref', '-d', keptRef(t.id));
    const res = await app.request(`/api/threads/${t.id}/messages`, json('POST', { prompt: 'again' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(new RegExp(`its branch ${t.branch} is gone from .* Make it again at the commit`));
  });

  it('checks the worktree out again for a turn Omni starts itself, which skips the message path', async () => {
    const { t, wt } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    expect(outcomes(await cleanUp([t.id]))).toEqual({ [t.id]: 'removed' });
    r.runner.sendMessage(t.id, 'a report came in');
    await r.untilResults(t.id, 2);
    expect(existsSync(wt)).toBe(true);
    expect(git(wt, 'branch', '--show-current')).toBe(t.branch);
    expect(r.thread(t.id).setup).toBeNull();
  });

  it('makes a start that comes while the folder is held wait, then checks the branch out again', async () => {
    const { t, repo: main, wt } = await worktreeThread();
    const spawned = r.spawns(t.id).length;
    let release = () => {};
    const held = withWorkspace(wt, () => {
      git(main, 'worktree', 'remove', wt);
      return new Promise<void>((done) => (release = done));
    });
    r.runner.sendMessage(t.id, 'started during the removal');
    await sleep(400);
    expect(r.spawns(t.id)).toHaveLength(spawned);
    expect(existsSync(wt)).toBe(false);
    release();
    await held;
    await r.untilResults(t.id, 2);
    expect(existsSync(wt)).toBe(true);
    expect(git(wt, 'branch', '--show-current')).toBe(t.branch);
  });
});

describe('retention: what the scheduled pass removes', T, () => {
  it('does nothing while the policy is off, the default', async () => {
    const { t, wt } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1, updated_at: daysAgo(400) });
    expect((await view()).cleanup.policy).toEqual({ enabled: false, idleDays: 14 });
    expect(await retentionPass()).toBeNull();
    expect(existsSync(wt)).toBe(true);
    r.db.threads.update(t.id, { archived: 0 });
  });

  it('removes archived, merged and deleted threads idle for the policy, and leaves a recent one', async () => {
    const old = await worktreeThread();
    const recent = await worktreeThread();
    const mergedIdle = await worktreeThread();
    const deleted = await worktreeThread();
    r.db.threads.update(old.t.id, { archived: 1, updated_at: daysAgo(20) });
    r.db.threads.update(recent.t.id, { archived: 1, updated_at: daysAgo(2) });
    r.db.threads.update(mergedIdle.t.id, { updated_at: daysAgo(30) });
    r.db.db.prepare('DELETE FROM threads WHERE id = ?').run(deleted.t.id);
    setRetentionPolicy({ enabled: true, idleDays: 10 });
    try {
      await scanned();
      expect((await view()).cleanup.preview!.retention.candidates.map((c) => c.id)).not.toContain(recent.t.id);
      const run = (await retentionPass())!;
      expect(run).toMatchObject({ trigger: 'retention', state: 'done' });
      for (const x of [old, mergedIdle, deleted]) expect(existsSync(x.wt)).toBe(false);
      expect(existsSync(recent.wt)).toBe(true);
      expect(run.items.map((i) => i.id)).not.toContain(recent.t.id);
      expect(Object.fromEntries(run.items.filter((i) => [old.t.id, mergedIdle.t.id, deleted.t.id].includes(i.id)).map((i) => [i.id, i.because]))).toEqual({
        [old.t.id]: 'archived',
        [mergedIdle.t.id]: 'merged',
        [deleted.t.id]: 'deleted',
      });
      expect((await view()).cleanup.runs.retention!.id).toBe(run.id);
    } finally {
      setRetentionPolicy({ enabled: false, idleDays: 14 });
      r.db.threads.update(recent.t.id, { archived: 0 });
    }
  });

  it('keeps running, queued, held and scheduled work through a pass, as a restart leaves it', async () => {
    const running = await worktreeThread();
    const held = await worktreeThread();
    const scheduled = await worktreeThread();
    for (const x of [running, held, scheduled]) r.db.threads.update(x.t.id, { archived: 1, updated_at: daysAgo(30) });
    r.db.threads.update(running.t.id, { status: 'running' });
    // What a restart makes of a message that was waiting: parked for Resume.
    const { row } = r.db.messageRequests.accept({ thread_id: held.t.id, request_id: 'held-1', prompt: 'later', mode: 'queue', source: 'ben', attachments: null, fingerprint: 'f', machine_id: null });
    r.db.messageRequests.park(row.id);
    r.db.threads.setLimit(scheduled.t.id, { state: 'scheduled', resets_at: daysAgo(-1), id: 'limit-1', machine: null });
    setRetentionPolicy({ enabled: true, idleDays: 1 });
    try {
      await retentionPass();
      for (const x of [running, held, scheduled]) expect(existsSync(x.wt)).toBe(true);
      const scan = currentWorktreeScan()!;
      const why = (id: string) => scan.items.find((i) => i.id === id)!.reasons.map((x) => x.code);
      expect(why(running.t.id)).toContain('running');
      expect(why(held.t.id)).toContain('queued');
      expect(why(scheduled.t.id)).toContain('queued');
    } finally {
      setRetentionPolicy({ enabled: false, idleDays: 14 });
      for (const x of [running, held, scheduled]) r.db.threads.update(x.t.id, { archived: 0, status: 'done' });
      r.db.threads.setLimit(scheduled.t.id, null);
      r.db.messageRequests.mark(row.id, 'discarded');
    }
  });
});

describe('merge cleanup: the head must be on origin\'s default branch', T, () => {
  /** A branch with one pushed commit, squash-merged into main on origin: HEAD stays outside main, its PR says merged. */
  async function squashed() {
    const x = await worktreeThread();
    const head = commit(x.wt, 'feature.txt');
    git(x.wt, 'push', '-q', 'origin', x.t.branch!);
    git(x.repo, 'checkout', '-q', 'main');
    writeFileSync(join(x.repo, 'feature.txt'), 'feature.txt\n');
    git(x.repo, 'add', 'feature.txt');
    git(x.repo, 'commit', '-q', '-m', 'feature (#1)');
    git(x.repo, 'push', '-q', 'origin', 'main');
    const squash = git(x.repo, 'rev-parse', 'HEAD');
    r.db.db.prepare('UPDATE channels SET github_repo = ? WHERE id = ?').run('acme/widgets', x.t.channel_id);
    r.db.threads.update(x.t.id, { updated_at: daysAgo(30) });
    return { ...x, head, squash };
  }
  const pr = (over: Record<string, unknown>) => writeFileSync(merged, JSON.stringify([{ number: 1, baseRefName: 'main', ...over }]));

  it('counts a squash merge into main whose head is HEAD and whose merge commit main has', async () => {
    const x = await squashed();
    pr({ headRefOid: x.head, mergeCommit: { oid: x.squash } });
    expect(await inspectWorktree(x.t.id)).toMatchObject({ verdict: 'eligible', eligibleBecause: 'merged' });
    expect(outcomes(await cleanUp([x.t.id]))).toEqual({ [x.t.id]: 'removed' });
  });

  it('does not count a PR into another branch, one whose head is not HEAD, or a merge commit main lacks', async () => {
    const x = await squashed();
    const cases = [
      { headRefOid: x.head, mergeCommit: { oid: x.squash }, baseRefName: 'release' },
      { headRefOid: git(x.repo, 'rev-parse', 'HEAD~1'), mergeCommit: { oid: x.squash } },
      { headRefOid: x.head, mergeCommit: { oid: 'f'.repeat(40) } },
      { headRefOid: x.head, mergeCommit: null },
    ];
    for (const c of cases) {
      pr(c);
      const it = await inspectWorktree(x.t.id);
      expect(it.verdict, JSON.stringify(c)).toBe('kept');
      expect(it.reasons.map((y) => y.code)).toContain('open-thread');
    }
    writeFileSync(merged, '[]');
  });
});

describe('cleanup: what it keeps', T, () => {
  it('refuses ids the review did not list: a leftover folder, a kept worktree, a running cleanup or scan', async () => {
    const orphan = join(r.paths.worktrees, 'not-a-thread');
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, 'notes.txt'), 'mine');
    const { t, wt } = await worktreeThread();
    await scanned();
    for (const ids of [['not-a-thread'], [t.id]]) {
      const res = await app.request('/api/worktrees/cleanup', json('POST', { ids }));
      expect(res.status).toBe(409);
    }
    expect((await app.request('/api/worktrees/cleanup', json('POST', { ids: [] }))).status).toBe(400);
    startWorktreeScan();
    expect((await app.request('/api/worktrees/cleanup', json('POST', { ids: [t.id] }))).status).toBe(409);
    await r.until('scan finished', () => currentWorktreeScan()?.state === 'done');
    expect(existsSync(join(orphan, 'notes.txt'))).toBe(true);
    expect(existsSync(wt)).toBe(true);
  });

  it('keeps a worktree that changed after the review: a new file, a new commit, an ignored .env, a shared folder', async () => {
    const a = await worktreeThread();
    const b = await worktreeThread();
    const c = await worktreeThread();
    const d = await worktreeThread();
    for (const x of [a, b, c, d]) r.db.threads.update(x.t.id, { archived: 1 });
    await scanned();
    writeFileSync(join(a.wt, 'draft.txt'), 'not saved');
    commit(b.wt, 'local.txt');
    writeFileSync(join(c.wt, '.env'), 'SECRET=1\n');
    // Another open thread starts working in d's folder.
    const other = await r.runner.createThread({ channel: 'scratch', prompt: 'share' });
    await r.untilResults(other.id, 1);
    r.db.threads.update(other.id, { cwd: d.wt });
    startCleanup([a.t.id, b.t.id, c.t.id, d.t.id]);
    const run = await manualDone();
    expect(outcomes(run)).toEqual({ [a.t.id]: 'kept', [b.t.id]: 'kept', [c.t.id]: 'kept', [d.t.id]: 'kept' });
    expect(codes(run, a.t.id)).toContain('untracked');
    expect(codes(run, b.t.id)).toContain('unpushed');
    expect(codes(run, c.t.id)).toContain('ignored');
    expect(codes(run, d.t.id)).toContain('shared');
    for (const x of [a, b, c, d]) expect(existsSync(x.wt)).toBe(true);
    expect(existsSync(join(c.wt, '.env'))).toBe(true);
  });

  it('keeps it when a message, a turn or a terminal comes in while it is checked', async () => {
    const msg = await worktreeThread();
    const turn = await worktreeThread();
    const term = await worktreeThread();
    for (const x of [msg, turn, term]) r.db.threads.update(x.t.id, { archived: 1 });
    let posted: Promise<unknown> | null = null;
    const run = await cleanUp([msg.t.id, turn.t.id, term.t.id], {
      between: (id) => {
        if (id === msg.t.id) posted = r.runner.postMessage(id, 'one more thing');
        if (id === turn.t.id) r.db.threads.update(id, { status: 'running' });
        if (id === term.t.id) openTerminal(id, term.wt);
      },
    });
    expect(outcomes(run)).toEqual({ [msg.t.id]: 'kept', [turn.t.id]: 'kept', [term.t.id]: 'kept' });
    // Waiting, or already started by the last look: either keeps it.
    expect(codes(run, msg.t.id)).toEqual([expect.stringMatching(/^(queued|running|changed-meanwhile)$/)]);
    expect(run.items.find((i) => i.id === turn.t.id)!.errors.join(' ')).toMatch(/changed while it was being checked/);
    expect(codes(run, term.t.id)).toContain('terminal');
    for (const x of [msg, turn, term]) expect(existsSync(x.wt)).toBe(true);
    closeTerminal(term.t.id);
    r.db.threads.update(turn.t.id, { status: 'done' });
    await posted;
    await r.untilResults(msg.t.id, 2);
  });

  it('keeps it while a channel action runs in it, and an action started during a removal checks the branch out again', async () => {
    const { t, wt } = await worktreeThread();
    r.db.threads.update(t.id, { archived: 1 });
    const serve = channelActions.create(t.channel_id, { name: 'Serve', command: 'sleep 30', secrets: [], port: null, setup: null });
    const { run: serving } = await startRun(r.thread(t.id), serve);
    await scanned();
    expect(currentWorktreeScan()!.items.find((i) => i.id === t.id)!.reasons.map((x) => x.code)).toContain('action');
    await stopRun(serving.id);

    const check = channelActions.create(t.channel_id, { name: 'Check', command: 'git branch --show-current', secrets: [], port: null, setup: null });
    const late: ReturnType<typeof startRun>[] = [];
    const run = await cleanUp([t.id], { between: (id) => void late.push(startRun(r.thread(id), check)) });
    expect(outcomes(run)).toEqual({ [t.id]: 'removed' });
    const { finished } = await late[0];
    const done = await finished;
    expect(done.state).toBe('succeeded');
    expect(done.output.trim()).toBe(t.branch);
    expect(existsSync(wt)).toBe(true);
  });
});

describe('retention settings', T, () => {
  it('saves the policy in this Mac\'s omni.config.json, rejects a bad one, and records nothing for sync', async () => {
    r.db.outbox.arm();
    const queued = () => (r.db.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as { n: number }).n;
    const before = queued();
    const res = await app.request('/api/worktrees/retention', json('PUT', { enabled: true, idleDays: 30 }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as View).cleanup.policy).toEqual({ enabled: true, idleDays: 30 });
    expect(JSON.parse(readFileSync(configPath(), 'utf8')).worktrees).toEqual({ retention: { enabled: true, idleDays: 30 } });
    expect((await app.request('/api/worktrees/retention', json('PUT', { idleDays: 0 }))).status).toBe(400);
    expect(queued()).toBe(before);
    await app.request('/api/worktrees/retention', json('PUT', { enabled: false }));
  });
});
