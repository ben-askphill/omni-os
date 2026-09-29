import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// Whether a synced thread can take a new turn on this Mac: not while the other Mac runs it, not when its folder
// is not here. A worktree thread gets its worktree back from its branch; the web UI reads the reason from the API.

const r = await startRunner();
const { app } = await import('../server/app.ts');

const detail = async (id: string) => (await app.request(`/api/threads/${id}`)).json() as Promise<any>;
const post = async (id: string, prompt = 'carry on') => {
  const res = await app.request(`/api/threads/${id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }),
  });
  return { status: res.status, body: (await res.json()) as any };
};

const thread = (id: string, patch: Record<string, unknown> = {}) =>
  r.db.threads.create({
    id, channel_id: 'scratch', title: id, status: 'done', role: null, model: null, session_id: id, cwd: '/nowhere/omni-test', branch: null,
    parent_id: null, task_id: null, source: 'manual', automation: null, has_run: 1, ...(patch as object),
  });

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

/** A repo with a commit on main and one more on `branch`, which is left checked out nowhere. */
function repo(name: string, branch: string) {
  const dir = join(r.tmp, name);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'main\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'main');
  git(dir, 'checkout', '-q', '-b', branch);
  writeFileSync(join(dir, 'branch.txt'), 'work on the branch\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'branch work');
  git(dir, 'checkout', '-q', 'main');
  return dir;
}

describe('with sync off', () => {
  it('the thread API is unchanged and a missing folder is not checked', async () => {
    thread('off-missing');
    const d = await detail('off-missing');
    expect(d).not.toHaveProperty('blocked');
  });
});

describe('with sync on', () => {
  it('arms', () => {
    r.db.outbox.arm('mac-a');
    expect(r.db.outbox.machineId()).toBe('mac-a');
  });

  it('a thread whose folder is not on this Mac is read-only, with the reason', async () => {
    thread('missing');
    const d = await detail('missing');
    expect(d.blocked).toMatch(/not on this Mac/);
    expect(d.blocked).toContain('/nowhere/omni-test');
    const res = await post('missing');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(d.blocked);
    expect(r.events('missing')).toEqual([]);
    expect(r.thread('missing').status).toBe('done');
  });

  it('a thread running on the other Mac takes no turn here', async () => {
    thread('elsewhere', { cwd: r.tmp });
    r.db.db.prepare(`UPDATE threads SET status = 'running' WHERE id = 'elsewhere'`).run();
    r.db.syncMeta.set('thread', 'elsewhere', new Date().toISOString(), 'mac-b');
    const d = await detail('elsewhere');
    expect(d.blocked).toMatch(/running on your other Mac/);
    const res = await post('elsewhere');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(d.blocked);
    expect(r.events('elsewhere')).toEqual([]);
    expect(() => r.runner.sendMessage('elsewhere', 'direct')).toThrow(/running on your other Mac/);
    // An open thread hears it on its stream when the thread changes.
    const ctl = new AbortController();
    const res2 = await app.request('/api/threads/elsewhere/stream', { signal: ctl.signal });
    const reader = res2.body!.getReader();
    await reader.read(); // the first ping
    const { publishFeed } = await import('../server/bus.ts');
    publishFeed({ type: 'thread', thread: r.thread('elsewhere') });
    let text = '';
    while (!text.includes('"kind":"thread"')) text += new TextDecoder().decode((await reader.read()).value);
    ctl.abort();
    expect(JSON.parse(text.split('data: ').at(-1)!.split('\n')[0])).toMatchObject({ kind: 'thread', blocked: d.blocked });
    // Once it finishes there, it is free here.
    r.db.db.prepare(`UPDATE threads SET status = 'done' WHERE id = 'elsewhere'`).run();
    expect(await detail('elsewhere')).not.toHaveProperty('blocked');
  });

  it('a thread running here is not running elsewhere, even when the other Mac wrote to it last', async () => {
    const t = await r.start('THINK:1500 a long answer');
    await r.untilStatus(t.id, 'running');
    // The other Mac renamed it mid-run: its row came with status running, from mac-b.
    r.db.syncMeta.set('thread', t.id, new Date(Date.now() + 60_000).toISOString(), 'mac-b');
    expect(await detail(t.id)).not.toHaveProperty('blocked');
    expect(() => r.runner.sendMessage(t.id, 'and one more thing', { mode: 'queue' })).not.toThrow();
    await r.untilResults(t.id, 2);
  });

  it('a thread whose folder is here is not blocked', async () => {
    thread('here', { cwd: r.tmp });
    expect(await detail('here')).not.toHaveProperty('blocked');
  });

  it("gets its worktree back from its branch when a turn starts, in this Mac's worktrees folder", async () => {
    const branch = 'omni/wt000001';
    const dir = repo('wt-repo', branch);
    r.db.channels.create({ id: 'wt', name: 'Worktrees', repo_path: dir, use_worktree: 1 });
    // The other Mac keeps its data somewhere else.
    thread('wt-thread', { channel_id: 'wt', branch, cwd: '/Users/someone/omni-os/data/worktrees/wt-thread' });
    expect(await detail('wt-thread')).not.toHaveProperty('blocked');
    const res = await post('wt-thread', 'keep going');
    expect(res.status).toBe(200);
    const cwd = join(r.paths.worktrees, 'wt-thread');
    expect(res.body.cwd).toBe(cwd);
    expect(r.thread('wt-thread').cwd).toBe(cwd);
    expect(readFileSync(join(cwd, 'branch.txt'), 'utf8')).toBe('work on the branch\n');
    expect(git(cwd, 'branch', '--show-current')).toBe(branch);
    await r.untilResults('wt-thread', 1);
    expect(realpathSync(r.spawns('wt-thread').at(-1)!.cwd)).toBe(realpathSync(cwd));
  });

  it('recreates a worktree at the same path when that path is this Mac\'s', async () => {
    const branch = 'omni/wt000002';
    const dir = repo('wt-repo-2', branch);
    r.db.channels.create({ id: 'wt2', name: 'Worktrees 2', repo_path: dir, use_worktree: 1 });
    const cwd = join(r.paths.worktrees, 'wt-same');
    thread('wt-same', { channel_id: 'wt2', branch, cwd });
    expect((await post('wt-same')).status).toBe(200);
    expect(existsSync(join(cwd, 'branch.txt'))).toBe(true);
    await r.untilResults('wt-same', 1);
  });

  it('refuses the turn, with the reason, when the branch is on neither this Mac nor its origin', async () => {
    const dir = repo('wt-repo-3', 'omni/other');
    r.db.channels.create({ id: 'wt3', name: 'Worktrees 3', repo_path: dir, use_worktree: 1 });
    thread('wt-lost', { channel_id: 'wt3', branch: 'omni/gone0000', cwd: '/Users/someone/omni-os/data/worktrees/wt-lost' });
    const res = await post('wt-lost');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/omni\/gone0000/);
    expect(r.events('wt-lost')).toEqual([]);
    expect(existsSync(join(r.paths.worktrees, 'wt-lost'))).toBe(false);
  });

  it("a thread that ran in its own data folder gets this Mac's", async () => {
    thread('own-dir', { cwd: '/Users/someone/omni-os/data/threads/own-dir' });
    expect(await detail('own-dir')).not.toHaveProperty('blocked');
    const res = await post('own-dir');
    expect(res.status).toBe(200);
    expect(r.thread('own-dir').cwd).toBe(join(r.paths.threads, 'own-dir'));
    expect(existsSync(join(r.paths.threads, 'own-dir'))).toBe(true);
    await r.untilResults('own-dir', 1);
  });
});
