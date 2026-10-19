import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// A channel that asks for a worktree per thread never runs a local harness anywhere else: not in the repo, not in
// the brain. A worktree that cannot be made or checked leaves the thread failed with the reason and its first
// prompt and files kept, and Retry makes it on the same thread, branch and session. Each failure is forced here
// against the shared launch path, with the fake claude CLI logging every process it starts and where.

const r = await startRunner();
const { app } = await import('../app.ts');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

let n = 0;
/** A git repo, with one commit unless `empty`. */
function repo(opts: { empty?: boolean } = {}) {
  const dir = join(r.tmp, `repo-${++n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  if (!opts.empty) commit(dir);
  return dir;
}
const commit = (dir: string) => {
  writeFileSync(join(dir, 'README.md'), `commit ${Date.now()}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'work');
};
/** A channel with worktrees on, over repoPath. */
const channel = (repoPath: string, patch: Record<string, unknown> = {}) => {
  const id = `wt-${++n}`;
  r.db.channels.create({ id, name: id, repo_path: repoPath, use_worktree: 1, ...patch });
  return id;
};

const request = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body instanceof FormData || !body ? undefined : { 'content-type': 'application/json' },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};
const retry = (id: string) => request('POST', `/threads/${id}/setup/retry`);
const detail = async (id: string) => (await request('GET', `/threads/${id}`)).body;

/** Every stream-json process started anywhere, with the folder it ran in. */
const allSpawns = () => r.invocations().filter((i) => i.mode === 'stream');
const ranIn = (dir: string) => allSpawns().filter((s) => realpathSync(s.cwd) === realpathSync(dir));
/** The thread once its setup failed. */
const failed = (id: string) => r.until(`setup to fail: ${JSON.stringify(r.thread(id))}`, () => r.thread(id).setup === 'failed' && r.thread(id));

describe('a worktree thread', () => {
  it('runs only once its worktree is made and checked, on its own branch', async () => {
    const dir = repo();
    const t = await r.runner.createThread({ channel: channel(dir), prompt: 'fix the cart' });
    // Written as preparing, with the folder and branch it will get.
    expect(t.setup).toBe('preparing');
    expect(t.cwd).toBe(join(r.paths.worktrees, t.id));
    expect(t.branch).toBe(`omni/${t.id.slice(0, 8)}`);
    await r.untilResults(t.id, 1);
    expect(r.thread(t.id).setup).toBeNull();
    expect(git(t.cwd, 'branch', '--show-current')).toBe(t.branch);
    const spawns = r.spawns(t.id);
    expect(spawns).toHaveLength(1);
    expect(realpathSync(spawns[0].cwd)).toBe(realpathSync(t.cwd));
    expect(ranIn(dir)).toEqual([]);
    // The first prompt went as a request, and the transcript keeps the thread's own source.
    expect(r.byKind(t.id, 'user').map((e) => [e.p.text, e.p.source])).toEqual([['fix the cart', 'manual']]);
    expect(r.db.messageRequests.forThread(t.id).map((q) => [q.request_id, q.state])).toEqual([['thread-start', 'delivered']]);
  });

  it('fails visibly when git worktree add fails, keeping the prompt and files, and never runs in the repo', async () => {
    const dir = repo({ empty: true });
    const form = new FormData();
    form.set('payload', JSON.stringify({ channel: channel(dir), prompt: 'read the spec' }));
    form.append('files', new File(['the spec'], 'spec.txt', { type: 'text/plain' }));
    const created = await request('POST', '/threads', form);
    expect(created.status).toBe(200);
    const id = created.body.id;
    const t = await failed(id);
    expect(t.status).toBe('failed');
    expect(t.setup_error).toMatch(/git worktree add failed/);
    expect(r.spawns(id)).toEqual([]);
    expect(ranIn(dir)).toEqual([]);
    expect(r.events(id)).toEqual([]);
    const d = await detail(id);
    expect(d.thread.setup).toBe('failed');
    expect(d.blocked).toMatch(/could not be prepared/);
    expect(d.pending).toMatchObject([
      { kind: 'user', text: 'read the spec', delivery: 'recovered', request_id: 'thread-start', attachments: [{ name: 'spec.txt' }] },
    ]);
    // A message to it is refused with the reason rather than started somewhere else.
    const sent = await request('POST', `/threads/${id}/messages`, { prompt: 'are you there' });
    expect(sent.status).toBe(409);
    expect(sent.body.error).toMatch(/could not be prepared/);
    expect(r.spawns(id)).toEqual([]);
  });

  it('retries on the same thread, branch and session, once, however often Retry is pressed', async () => {
    const dir = repo({ empty: true });
    const before = r.db.threads.list({ limit: 500 }).length;
    const t = await r.runner.createThread({ channel: channel(dir), prompt: 'fix the widget' });
    await failed(t.id);
    commit(dir);
    // Pressed twice, and Resume on the kept prompt too: one preparation, one process.
    const [a, b] = await Promise.all([retry(t.id), retry(t.id)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.thread.setup).toBe('preparing');
    expect((await request('POST', `/threads/${t.id}/requests/resume`, {})).status).toBe(200);
    await r.untilResults(t.id, 1);
    expect((await retry(t.id)).body.thread.setup).toBeNull();
    await new Promise((done) => setTimeout(done, 200));
    expect(r.spawns(t.id)).toHaveLength(1);
    expect(r.spawns(t.id)[0].session_id).toBe(t.id);
    expect(r.texts(t.id, 'user')).toEqual(['fix the widget']);
    expect(r.thread(t.id)).toMatchObject({ cwd: t.cwd, branch: t.branch, session_id: t.id, setup: null });
    expect(r.db.threads.list({ limit: 500 }).length).toBe(before + 1);
    expect(git(dir, 'worktree', 'list').split('\n')).toHaveLength(2);
  });

  it('keeps a worktree an earlier try already made', async () => {
    const dir = repo({ empty: true });
    const t = await r.runner.createThread({ channel: channel(dir), prompt: 'carry on' });
    await failed(t.id);
    commit(dir);
    // The worktree got made after all (a restart between add and the check, or by hand): Retry uses it.
    git(dir, 'worktree', 'add', '-q', '-b', t.branch!, t.cwd, 'HEAD');
    writeFileSync(join(t.cwd, 'notes.txt'), 'kept\n');
    await retry(t.id);
    await r.untilResults(t.id, 1);
    expect(existsSync(join(t.cwd, 'notes.txt'))).toBe(true);
    expect(realpathSync(r.spawns(t.id)[0].cwd)).toBe(realpathSync(t.cwd));
  });

  it('fails when the repository is missing, and never falls back to the base folder or the brain', async () => {
    const base = join(r.tmp, 'base-folder');
    mkdirSync(base, { recursive: true });
    const gone = join(r.tmp, 'no-such-repo');
    const t = await r.runner.createThread({ channel: channel(gone, { base_dir: base }), prompt: 'look around' });
    expect(t.cwd).toBe(join(r.paths.worktrees, t.id));
    const f = await failed(t.id);
    expect(f.setup_error).toMatch(/not on this Mac/);
    expect(r.spawns(t.id)).toEqual([]);
    expect(ranIn(base)).toEqual([]);
    expect(ranIn(r.config.brainDir)).toEqual([]);
  });

  it('fails when the repository is not a git repository', async () => {
    const plain = join(r.tmp, 'plain-folder');
    mkdirSync(plain, { recursive: true });
    const t = await r.runner.createThread({ channel: channel(plain), prompt: 'look around' });
    expect((await failed(t.id)).setup_error).toMatch(/not a git repository/);
    expect(r.spawns(t.id)).toEqual([]);
    expect(ranIn(plain)).toEqual([]);
  });

  it('fails when the worktree it made is not on its branch, takes that worktree out, and a retry starts clean', async () => {
    const dir = repo();
    // A hook that leaves every new checkout on a detached HEAD.
    const hook = join(dir, '.git', 'hooks', 'post-checkout');
    writeFileSync(hook, '#!/bin/sh\n[ -n "$(git branch --show-current)" ] && git checkout -q --detach\nexit 0\n');
    chmodSync(hook, 0o755);
    const t = await r.runner.createThread({ channel: channel(dir), prompt: 'fix it' });
    expect((await failed(t.id)).setup_error).toMatch(/detached HEAD, not omni\//);
    expect(existsSync(t.cwd)).toBe(false);
    expect(r.spawns(t.id)).toEqual([]);
    expect(ranIn(dir)).toEqual([]);
    rmSync(hook);
    await retry(t.id);
    await r.untilResults(t.id, 1);
    expect(git(t.cwd, 'branch', '--show-current')).toBe(t.branch);
  });

  it('never deletes a folder in the way of its worktree', async () => {
    const dir = repo({ empty: true });
    const t = await r.runner.createThread({ channel: channel(dir), prompt: 'go' });
    await failed(t.id);
    commit(dir);
    // Something that is not this thread's worktree now sits where it goes.
    mkdirSync(t.cwd, { recursive: true });
    writeFileSync(join(t.cwd, 'mine.txt'), 'not yours\n');
    await retry(t.id);
    await r.until('the retry to fail', () => r.thread(t.id).setup === 'failed' && /in the way/.test(r.thread(t.id).setup_error ?? ''));
    expect(existsSync(join(t.cwd, 'mine.txt'))).toBe(true);
    expect(r.spawns(t.id)).toEqual([]);
  });
});

describe('the shared launch path', () => {
  /** A thread that ran before, on a branch, with its folder now somewhere it must not run. */
  const ranBefore = (ch: string, cwd: string, branch: string) => {
    const id = `ran-${++n}`;
    return r.db.threads.create({
      id, channel_id: ch, title: id, status: 'done', role: null, model: null, session_id: id, cwd, branch,
      parent_id: null, task_id: null, source: 'manual', automation: null, has_run: 1,
    });
  };

  it('refuses a thread on a branch whose folder is the repo itself, and keeps the message for Retry', async () => {
    const dir = repo();
    const t = ranBefore(channel(dir), dir, 'omni/onrepo00');
    const sent = await request('POST', `/threads/${t.id}/messages`, { prompt: 'keep going' });
    expect(sent.status).toBe(200);
    const f = await failed(t.id);
    expect(f.setup_error).toMatch(/own checkout/);
    expect(r.spawns(t.id)).toEqual([]);
    expect(ranIn(dir)).toEqual([]);
    expect((await detail(t.id)).pending).toMatchObject([{ text: 'keep going', delivery: 'recovered' }]);
  });

  it('refuses a thread whose worktree was removed, then Retry checks its branch out again and sends the message', async () => {
    const dir = repo();
    const branch = 'omni/removed0';
    git(dir, 'branch', branch);
    const t = ranBefore(channel(dir), join(r.paths.worktrees, `removed-${n}`), branch);
    expect((await request('POST', `/threads/${t.id}/messages`, { prompt: 'are you back' })).status).toBe(200);
    expect((await failed(t.id)).setup_error).toMatch(/does not exist/);
    expect(r.spawns(t.id)).toEqual([]);
    await retry(t.id);
    await r.untilResults(t.id, 1);
    expect(realpathSync(r.spawns(t.id)[0].cwd)).toBe(realpathSync(t.cwd));
    expect(r.texts(t.id, 'user')).toEqual(['are you back']);
  });
});

describe('channels without worktrees', () => {
  it('run in the repo itself, as before', async () => {
    const dir = repo();
    const t = await r.runner.createThread({ channel: channel(dir, { use_worktree: 0 }), prompt: 'tidy up' });
    expect(t).toMatchObject({ cwd: dir, branch: null, setup: null });
    await r.untilResults(t.id, 1);
    expect(realpathSync(r.spawns(t.id)[0].cwd)).toBe(realpathSync(dir));
  });

  it('a missing repo still falls back to the base folder', async () => {
    const base = join(r.tmp, 'base-2');
    mkdirSync(base);
    const t = await r.runner.createThread({ channel: channel(join(r.tmp, 'gone-2'), { use_worktree: 0, base_dir: base }), prompt: 'hi' });
    expect(t).toMatchObject({ cwd: base, setup: null });
    await r.untilResults(t.id, 1);
  });
});

describe('teams and parents', () => {
  it("a child that cannot be prepared reports it to its parent, and a lead's worktree failing holds the go until Retry", async () => {
    const empty = repo({ empty: true });
    const { lead, members } = await r.runner.createTeam({
      channel: channel(empty),
      prompt: 'split the work',
      tasks: [{ prompt: 'part one' }],
    });
    await failed(lead.id);
    await failed(members[0].id);
    // The member's failure reached the waiting lead as its report; the lead still waits for its worktree.
    await r.until('the report on the lead', () => r.byKind(lead.id, 'crew_report').length === 1);
    expect(r.byKind(lead.id, 'crew_report')[0].p.text).toMatch(/could not prepare/);
    expect(r.spawns(lead.id)).toEqual([]);
    commit(empty);
    await retry(lead.id);
    await r.untilResults(lead.id, 1);
    expect(realpathSync(r.spawns(lead.id)[0].cwd)).toBe(realpathSync(lead.cwd));
  });
});

describe('boot', () => {
  it('fails a preparation the last server left running', () => {
    const id = `boot-${++n}`;
    r.db.threads.create({
      id, channel_id: 'scratch', title: id, status: 'queued', role: null, model: null, session_id: id, cwd: join(r.paths.worktrees, id),
      branch: 'omni/boot0000', parent_id: null, task_id: null, source: 'manual', automation: null, setup: 'preparing',
    });
    expect(r.db.threads.failPreparing('Omni stopped first.')).toBeGreaterThanOrEqual(1);
    expect(r.thread(id)).toMatchObject({ setup: 'failed', setup_error: 'Omni stopped first.' });
  });
});
