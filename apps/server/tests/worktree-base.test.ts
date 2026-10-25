import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// A new worktree thread's branch is cut from the base Ben chose, resolved to one commit before the branch exists and
// kept: the repo's HEAD by default, an existing ref, or origin's default branch after a fetch that never moves the
// channel's own checkout. Each case runs in temp repos with a bare "origin" beside the working repo.

const r = await startRunner();
const { app } = await import('../app.ts');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

let n = 0;
const commit = (dir: string, file = 'README.md') => {
  writeFileSync(join(dir, file), `commit ${++n} ${Date.now()}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', `work ${n}`);
  return git(dir, 'rev-parse', 'HEAD');
};

/** A bare origin with one commit on main, a clone of it as the channel's repo, and a second clone to push from. */
function remote() {
  const origin = join(r.tmp, `origin-${++n}.git`);
  git(r.tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  const pusher = join(r.tmp, `pusher-${n}`);
  git(r.tmp, 'clone', '-q', origin, pusher);
  git(pusher, 'checkout', '-q', '-b', 'main');
  commit(pusher);
  git(pusher, 'push', '-q', 'origin', 'main');
  const repo = join(r.tmp, `repo-${n}`);
  git(r.tmp, 'clone', '-q', origin, repo);
  return { origin, pusher, repo, push: () => (commit(pusher), git(pusher, 'push', '-q', 'origin', 'main'), git(pusher, 'rev-parse', 'HEAD')) };
}

const channel = (repoPath: string, patch: Record<string, unknown> = {}) => {
  const id = `base-${++n}`;
  r.db.channels.create({ id, name: id, repo_path: repoPath, use_worktree: 1, ...patch });
  return id;
};

const request = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};
const start = (channelId: string, base?: unknown, prompt = 'fix it') => request('POST', '/threads', { channel: channelId, prompt, ...(base ? { base } : {}) });
const base = async (id: string) => (await request('GET', `/threads/${id}/base`)).body;
const ready = (id: string) => r.until(`setup to finish: ${JSON.stringify(r.thread(id))}`, () => r.thread(id).setup === null && r.thread(id));
const failed = (id: string) => r.until(`setup to fail: ${JSON.stringify(r.thread(id))}`, () => r.thread(id).setup === 'failed' && r.thread(id));
const head = (dir: string) => git(dir, 'rev-parse', 'HEAD');

describe('the base a thread starts from', () => {
  it('is the repo HEAD when nothing is chosen, and the thread says so', async () => {
    const { repo } = remote();
    const local = commit(repo);
    const made = await start(channel(repo));
    const t = await ready(made.body.id);
    expect(head(t.cwd)).toBe(local);
    expect(await base(t.id)).toEqual({ pick: { kind: 'head' }, sha: local, ref: 'main' });
    expect(r.db.threadBases.get(t.id)).toMatchObject({ sha: local, ref: 'main', how: 'thread-start' });
  });

  it('is origin\'s default branch, fetched, when the local HEAD is stale; the main checkout stays as it was', async () => {
    const { repo, push } = remote();
    const stale = head(repo);
    const newest = push();
    const before = { head: head(repo), status: git(repo, 'status', '--porcelain'), branch: git(repo, 'branch', '--show-current') };
    const made = await start(channel(repo), { kind: 'remote-default' });
    expect(made.status).toBe(200);
    const t = await ready(made.body.id);
    expect(head(t.cwd)).toBe(newest);
    expect(await base(t.id)).toEqual({ pick: { kind: 'remote-default' }, sha: newest, ref: 'origin/main' });
    // Only refs/remotes/origin/main moved. Ben's branch, checkout and files are exactly where they were.
    expect(git(repo, 'rev-parse', 'refs/remotes/origin/main')).toBe(newest);
    expect({ head: head(repo), status: git(repo, 'status', '--porcelain'), branch: git(repo, 'branch', '--show-current') }).toEqual(before);
    expect(head(repo)).toBe(stale);
  });

  it('starts from an existing local ref, and a ref that moves later does not move the thread', async () => {
    const { repo } = remote();
    git(repo, 'branch', 'release');
    const pinned = git(repo, 'rev-parse', 'release');
    commit(repo);
    const made = await start(channel(repo), { kind: 'ref', ref: 'release' });
    const t = await ready(made.body.id);
    expect(head(t.cwd)).toBe(pinned);
    expect(head(repo)).not.toBe(pinned);
    git(repo, 'checkout', '-q', 'release');
    const moved = commit(repo);
    git(repo, 'checkout', '-q', 'main');
    expect(await base(t.id)).toEqual({ pick: { kind: 'ref', ref: 'release' }, sha: pinned, ref: 'release' });
    expect(git(repo, 'rev-parse', 'release')).toBe(moved);
  });

  it('keeps the first commit when a Retry comes after the remote branch moved', async () => {
    const { repo, push } = remote();
    const first = push();
    const id = channel(repo);
    // Setup fails after the base is resolved (a hook leaves the new checkout detached), and the remote moves on.
    const hook = join(repo, '.git', 'hooks', 'post-checkout');
    writeFileSync(hook, '#!/bin/sh\n[ -n "$(git branch --show-current)" ] && git checkout -q --detach\nexit 0\n');
    chmodSync(hook, 0o755);
    const made = await start(id, { kind: 'remote-default' });
    const t = await failed(made.body.id);
    expect(t.setup_error).toMatch(/detached HEAD/);
    expect((await base(t.id)).sha).toBe(first);
    push();
    rmSync(hook);
    expect((await request('POST', `/threads/${t.id}/setup/retry`)).status).toBe(200);
    await ready(t.id);
    expect(head(t.cwd)).toBe(first);
    expect((await base(t.id)).sha).toBe(first);
    // A thread started now sees the new commit.
    const later = await ready((await start(id, { kind: 'remote-default' })).body.id);
    expect(head(later.cwd)).not.toBe(first);
  });

  it('refuses a ref that names nothing before it makes a thread, leaving the repo alone', async () => {
    const { repo } = remote();
    const id = channel(repo);
    const count = r.db.threads.list({ limit: 500 }).length;
    for (const ref of ['no-such-branch', '--upload-pack=x', 'a b', 'main..HEAD']) {
      const refused = await start(id, { kind: 'ref', ref });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toMatch(/not a branch, tag or commit|no branch, tag or commit/);
    }
    expect((await start(id, { kind: 'bogus' })).status).toBeGreaterThanOrEqual(400);
    expect(r.db.threads.list({ limit: 500 }).length).toBe(count);
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('fails visibly when origin is unreachable, keeps the prompt and the checkout, and succeeds on Retry once it is back', async () => {
    const { origin, repo } = remote();
    renameSync(origin, `${origin}.away`);
    const local = head(repo);
    const id = channel(repo);
    const made = await start(id, { kind: 'remote-default' }, 'read the spec');
    const t = await failed(made.body.id);
    expect(t.setup_error).toMatch(/Could not reach origin/);
    expect(t.status).toBe('failed');
    expect(head(repo)).toBe(local);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(r.spawns(t.id)).toEqual([]);
    const d = await request('GET', `/threads/${t.id}`);
    expect(d.body.pending).toMatchObject([{ text: 'read the spec', delivery: 'recovered', request_id: 'thread-start' }]);
    expect(await base(t.id)).toEqual({ pick: { kind: 'remote-default' }, sha: null, ref: null });
    renameSync(`${origin}.away`, origin);
    expect((await request('POST', `/threads/${t.id}/setup/retry`)).status).toBe(200);
    await r.untilResults(t.id, 1);
    expect(r.texts(t.id, 'user')).toEqual(['read the spec']);
    expect((await base(t.id)).ref).toBe('origin/main');
  });

  it('gives concurrent new threads one commit each without racing for the fetch or the worktrees', async () => {
    const { repo, push } = remote();
    const newest = push();
    const id = channel(repo);
    const made = await Promise.all(
      [{ kind: 'remote-default' }, { kind: 'remote-default' }, { kind: 'remote-default' }, { kind: 'ref', ref: 'main' }, undefined, { kind: 'remote-default' }].map((b) => start(id, b)),
    );
    expect(made.map((m) => m.status)).toEqual(Array(6).fill(200));
    const threads = await Promise.all(made.map((m) => ready(m.body.id)));
    expect(new Set(threads.map((t) => t.cwd)).size).toBe(6);
    expect(new Set(threads.map((t) => t.branch)).size).toBe(6);
    const shas = threads.map((t) => head(t.cwd));
    expect(shas.filter((s) => s === newest)).toHaveLength(4);
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(7);
    for (const t of threads) expect((await base(t.id)).sha).toBe(head(t.cwd));
  });
});

describe('what the composer offers', () => {
  it('lists the current commit, the refs and origin\'s default branch for a repo channel', async () => {
    const { repo } = remote();
    git(repo, 'branch', 'release');
    git(repo, 'tag', 'v1');
    const { status, body } = await request('GET', `/channels/${channel(repo)}/bases`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: true, head: { ref: 'main', sha: head(repo) }, remote: { remote: 'origin', branch: 'main', sha: head(repo) } });
    expect(body.refs.map((x: any) => [x.ref, x.kind, x.current])).toEqual(expect.arrayContaining([['main', 'branch', true], ['release', 'branch', false], ['v1', 'tag', false]]));
  });

  it('offers no remote without an origin, and no bases for a channel that does not use worktrees', async () => {
    const dir = join(r.tmp, `solo-${++n}`);
    mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir);
    expect((await request('GET', `/channels/${channel(dir)}/bases`)).body).toMatchObject({ available: true, remote: null });
    expect((await request('GET', `/channels/${channel(dir, { use_worktree: 0 })}/bases`)).body).toMatchObject({ available: false });
    expect((await request('GET', '/channels/nope/bases')).status).toBe(404);
  });
});

describe('threads that make no choice or have no worktree', () => {
  it('cut from the repo HEAD as before, with a base recorded for the Changes panel', async () => {
    const { repo } = remote();
    const local = commit(repo);
    const t = await ready((await r.runner.createThread({ channel: channel(repo), prompt: 'no choice' })).id);
    expect(head(t.cwd)).toBe(local);
    expect(r.db.threadBases.get(t.id)).toMatchObject({ sha: local, how: 'thread-start' });
    expect(r.db.threadBasePicks.get(t.id)).toBeUndefined();
  });

  it('drop a pick when the channel runs threads in the repo itself', async () => {
    const { repo } = remote();
    const made = await start(channel(repo, { use_worktree: 0 }), { kind: 'remote-default' });
    expect(made.status).toBe(200);
    expect(r.db.threadBasePicks.get(made.body.id)).toBeUndefined();
    expect(existsSync(made.body.cwd)).toBe(true);
    expect(await base(made.body.id)).toBeNull();
  });
});
