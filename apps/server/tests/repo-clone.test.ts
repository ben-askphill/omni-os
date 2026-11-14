import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// A worktree thread in a repo channel whose repository is not on this machine: setup clones the channel's GitHub repo
// first (apps/server/repo-clone.ts), then makes the worktree as usual. A fake `gh` first on PATH clones from local
// bare repos, logging each clone, and can be made slow or failing through files in its folder.

const r = await startRunner();
const { app } = await import('../app.ts');
const { updateUserConfig } = await import('../user-config.ts');
const { githubRepoOf } = await import('../repo-clone.ts');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

const fake = join(r.tmp, 'fake-gh');
const sources = join(fake, 'sources');
const cloneLog = join(fake, 'clones.log');
mkdirSync(sources, { recursive: true });
writeFileSync(
  join(r.tmp, 'bin', 'gh'),
  `#!/bin/sh
[ "$1" = repo ] && [ "$2" = clone ] || { echo "unexpected gh $*" >&2; exit 2; }
echo "$3 $4" >> '${cloneLog}'
# A clone that dies part way: something written, then the error.
if [ -f '${fake}/fail' ]; then mkdir -p "$4/.git" && echo partial > "$4/.git/HEAD"; echo "GraphQL: Could not resolve to a Repository with the name '$3'." >&2; exit 1; fi
[ -f '${fake}/delay' ] && sleep "$(cat '${fake}/delay')"
exec git clone --quiet '${sources}'/"$3" "$4"
`,
  { mode: 0o755 },
);
const clones = () => (existsSync(cloneLog) ? readFileSync(cloneLog, 'utf8').split('\n').filter(Boolean) : []);

let n = 0;
/** A GitHub repo the fake gh can clone, with one commit. */
function source(name = `shop-${++n}`, owner = 'acme') {
  const repo = `${owner}/${name}`;
  const work = join(r.tmp, `work-${owner}-${name}`);
  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  writeFileSync(join(work, 'README.md'), `${name}\n`);
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'first');
  mkdirSync(join(sources, owner), { recursive: true });
  execFileSync('git', ['clone', '-q', '--bare', work, join(sources, repo)]);
  return { repo, name };
}
/** A worktree channel over repoPath, cloned from github. */
const channel = (repoPath: string, github: string | null) => {
  const id = `clone-${++n}`;
  r.db.channels.create({ id, name: id, repo_path: repoPath, github_repo: github, use_worktree: 1 });
  return id;
};
/** A folder under a parent that exists, with nothing in it yet. */
const missing = (name: string) => {
  const parent = join(r.tmp, `home-${++n}`);
  mkdirSync(parent);
  return join(parent, name);
};
const actions = async (id: string) => (await (await app.request(`/api/threads/${id}/actions`)).json()) as any;
/** The thread's actions once they name a clone, as the setup card polls them. */
async function cloneShown(id: string) {
  for (const end = Date.now() + 8000; Date.now() < end; await new Promise((done) => setTimeout(done, 20))) {
    const { clone } = await actions(id);
    if (clone) return clone;
  }
  throw new Error('timed out waiting for the clone step');
}
const retry = (id: string) => app.request(`/api/threads/${id}/setup/retry`, { method: 'POST' });
const failed = (id: string) => r.until(`setup to fail: ${JSON.stringify(r.thread(id))}`, () => r.thread(id).setup === 'failed' && r.thread(id));
const originOf = (dir: string) => realpathSync(git(dir, 'remote', 'get-url', 'origin'));

beforeEach(() => {
  rmSync(cloneLog, { force: true });
  rmSync(join(fake, 'fail'), { force: true });
  rmSync(join(fake, 'delay'), { force: true });
});

describe('a worktree thread whose channel repository is not on this machine', () => {
  it('clones the channel repo to its path, says so while it runs, then makes the worktree from it', async () => {
    const { repo, name } = source();
    const path = missing(name);
    writeFileSync(join(fake, 'delay'), '1');
    const ch = channel(path, repo);
    const t = await r.runner.createThread({ channel: ch, prompt: 'fix the cart' });
    expect(await cloneShown(t.id)).toEqual({ repo, into: path });
    await r.untilResults(t.id, 1);
    expect(clones()).toEqual([`${repo} ${join(path, '..', `.${name}.omni-clone`)}`]);
    expect(originOf(path)).toBe(realpathSync(join(sources, repo)));
    expect(git(t.cwd, 'branch', '--show-current')).toBe(t.branch);
    expect(realpathSync(r.spawns(t.id)[0].cwd)).toBe(realpathSync(t.cwd));
    // The path was this machine's already: nothing to record.
    expect(r.db.channels.get(ch)!.repo_path).toBe(path);
    expect(r.db.kv.get('sync.path_map') ?? {}).not.toHaveProperty(path);
    expect((await actions(t.id)).clone).toBeNull();
  });

  it('never clones when the repository is there', async () => {
    const { repo, name } = source();
    const path = missing(name);
    git(join(path, '..'), 'clone', '-q', join(sources, repo), path);
    const t = await r.runner.createThread({ channel: channel(path, repo), prompt: 'look around' });
    await r.untilResults(t.id, 1);
    expect(clones()).toEqual([]);
    expect(git(t.cwd, 'branch', '--show-current')).toBe(t.branch);
  });

  it('clones once for two threads that start together, and both run from it', async () => {
    const { repo, name } = source();
    const path = missing(name);
    writeFileSync(join(fake, 'delay'), '1');
    const ch = channel(path, repo);
    const [a, b] = await Promise.all([
      r.runner.createThread({ channel: ch, prompt: 'first' }),
      r.runner.createThread({ channel: ch, prompt: 'second' }),
    ]);
    await Promise.all([r.untilResults(a.id, 1), r.untilResults(b.id, 1)]);
    expect(clones()).toHaveLength(1);
    expect(git(path, 'worktree', 'list').split('\n')).toHaveLength(3);
  });

  it('fails visibly when the clone fails, leaves nothing behind, and clones on Retry', async () => {
    const { repo, name } = source();
    const path = missing(name);
    writeFileSync(join(fake, 'fail'), '');
    const t = await r.runner.createThread({ channel: channel(path, repo), prompt: 'deploy it' });
    const f = await failed(t.id);
    expect(f.setup_error).toMatch(new RegExp(`could not clone ${repo} into ${path}: GraphQL: Could not resolve`));
    expect(f.setup_error).toMatch(/gh auth status/);
    expect(r.spawns(t.id)).toEqual([]);
    expect(readdirSync(join(path, '..'))).toEqual([]);
    rmSync(join(fake, 'fail'));
    await retry(t.id);
    await r.untilResults(t.id, 1);
    expect(clones()).toHaveLength(2);
    expect(existsSync(join(path, 'README.md'))).toBe(true);
  });

  it('clones into an empty folder at its path', async () => {
    const { repo, name } = source();
    const path = missing(name);
    mkdirSync(path);
    const t = await r.runner.createThread({ channel: channel(path, repo), prompt: 'go' });
    await r.untilResults(t.id, 1);
    expect(clones()).toHaveLength(1);
    expect(existsSync(join(path, 'README.md'))).toBe(true);
  });

  it('stops at once when Stop is pressed during the clone, and Retry uses that clone', async () => {
    const { repo, name } = source();
    const path = missing(name);
    writeFileSync(join(fake, 'delay'), '2');
    const t = await r.runner.createThread({ channel: channel(path, repo), prompt: 'go' });
    await cloneShown(t.id);
    expect((await app.request(`/api/threads/${t.id}/stop`, { method: 'POST' })).status).toBe(200);
    const f = await r.until('the stop, before the clone ends', () => r.thread(t.id).setup === 'failed' && r.thread(t.id), 1500);
    expect(f).toMatchObject({ status: 'stopped', setup_error: 'Stopped by Ben before the agent started.' });
    expect(existsSync(t.cwd)).toBe(false);
    await r.until('the clone to land', () => existsSync(join(path, 'README.md')), 10_000);
    await retry(t.id);
    await r.untilResults(t.id, 1);
    expect(clones()).toHaveLength(1);
  });

  it('does not clone elsewhere when a folder under a top folder that is here is missing, like an unplugged drive', async () => {
    const { repo, name } = source();
    const path = join(r.tmp, `drive-${++n}`, 'code', name);
    const ch = channel(path, repo);
    const t = await r.runner.createThread({ channel: ch, prompt: 'go' });
    expect((await failed(t.id)).setup_error).toMatch(/is missing too \(a drive that is not connected\?\)/);
    expect(clones()).toEqual([]);
    expect(r.db.channels.get(ch)!.repo_path).toBe(path);
  });

  it('fails, without cloning, when the channel has no GitHub repo to clone from', async () => {
    const t = await r.runner.createThread({ channel: channel(missing('lost'), null), prompt: 'go' });
    expect((await failed(t.id)).setup_error).toMatch(/not on this machine.*Set the channel's GitHub repo/);
    expect(clones()).toEqual([]);
    expect(r.spawns(t.id)).toEqual([]);
  });

  it('fails, without running gh, when the GitHub repo starts with a dash', async () => {
    const t = await r.runner.createThread({ channel: channel(missing('shop'), '-x/shop'), prompt: 'go' });
    expect((await failed(t.id)).setup_error).toMatch(/is not an owner\/name Omni can clone/);
    expect(clones()).toEqual([]);
    expect(r.spawns(t.id)).toEqual([]);
  });
});

describe('a channel path that cannot be made on this machine', () => {
  const repos = join(r.tmp, 'repos');
  // The other machine's own folder, outside this one's home and under a folder that is not here.
  const elsewhere = (name: string) => `/no-such-root-${++n}/ben/${name}`;
  beforeEach(() => {
    updateUserConfig({ workspace: { reposDir: repos } });
  });

  it('clones under the Repos folder and records the path for this machine only', async () => {
    const { repo, name } = source();
    const theirs = elsewhere(name);
    const ch = channel(theirs, repo);
    const t = await r.runner.createThread({ channel: ch, prompt: 'go' });
    await r.untilResults(t.id, 1);
    const ours = join(repos, name);
    expect(clones()).toHaveLength(1);
    expect(originOf(ours)).toBe(realpathSync(join(sources, repo)));
    expect(r.db.channels.get(ch)!.repo_path).toBe(ours);
    // A change from the other machine lands here, and one made here sends that machine its own path back.
    expect(r.db.kv.get<Record<string, string>>('sync.path_map')![theirs]).toBe(ours);
    const { toRemote, fromPortable } = await import('../sync/paths.ts');
    expect(toRemote(ours)).toBe(theirs);
    expect(fromPortable(theirs)).toBe(ours);
    expect(realpathSync(git(t.cwd, 'rev-parse', '--git-common-dir'))).toBe(realpathSync(join(ours, '.git')));
  });

  it('uses a clone of the repo already in that place instead of cloning again', async () => {
    const { repo, name } = source();
    const ours = join(repos, name);
    mkdirSync(repos, { recursive: true });
    // Cloned by hand, or by a clone whose path was never recorded (a restart in between).
    git(repos, 'clone', '-q', join(sources, repo), ours);
    git(ours, 'remote', 'set-url', 'origin', `git@github.com:${repo}.git`);
    const ch = channel(elsewhere(name), repo);
    const t = await r.runner.createThread({ channel: ch, prompt: 'go' });
    await r.untilResults(t.id, 1);
    expect(clones()).toEqual([]);
    expect(r.db.channels.get(ch)!.repo_path).toBe(ours);
  });

  it('never hands a channel the clone of another repo with the same name', async () => {
    const mine = source(`web-${++n}`, 'acme');
    const theirs = source(mine.name, 'client');
    const [pathA, pathB] = [elsewhere(mine.name), elsewhere(theirs.name)];
    writeFileSync(join(fake, 'delay'), '1');
    const a = channel(pathA, mine.repo);
    const b = channel(pathB, theirs.repo);
    const ta = await r.runner.createThread({ channel: a, prompt: 'mine' });
    await cloneShown(ta.id);
    const tb = await r.runner.createThread({ channel: b, prompt: 'theirs' });
    expect((await failed(tb.id)).setup_error).toMatch(`Omni is cloning ${mine.repo} into ${join(repos, mine.name)} for another channel`);
    await r.untilResults(ta.id, 1);
    // Once that clone is there, the path map keeps the folder for the first channel.
    await retry(tb.id);
    expect((await failed(tb.id)).setup_error).toMatch(`this machine's path map already uses that folder for ${pathA}`);
    expect(clones()).toHaveLength(1);
    expect(r.db.channels.get(b)!.repo_path).toBe(pathB);
    expect(r.spawns(tb.id)).toEqual([]);
  });

  it('leaves a repo path set during the clone as it was set', async () => {
    const { repo, name } = source();
    const theirs = elsewhere(name);
    writeFileSync(join(fake, 'delay'), '1');
    const ch = channel(theirs, repo);
    const t = await r.runner.createThread({ channel: ch, prompt: 'go' });
    await cloneShown(t.id);
    const own = join(r.tmp, `own-${++n}`, name);
    mkdirSync(join(own, '..'));
    git(join(own, '..'), 'clone', '-q', join(sources, repo), own);
    r.db.channels.update(ch, { repo_path: own });
    await r.untilResults(t.id, 1);
    expect(r.db.channels.get(ch)!.repo_path).toBe(own);
    expect(r.db.kv.get('sync.path_map') ?? {}).not.toHaveProperty(theirs);
    expect(realpathSync(git(t.cwd, 'rev-parse', '--git-common-dir'))).toBe(realpathSync(join(own, '.git')));
  });

  it('never clones over a folder there that is not the repo', async () => {
    const { repo, name } = source();
    const ours = join(repos, name);
    mkdirSync(ours, { recursive: true });
    writeFileSync(join(ours, 'mine.txt'), 'not yours\n');
    const ch = channel(elsewhere(name), repo);
    const t = await r.runner.createThread({ channel: ch, prompt: 'go' });
    expect((await failed(t.id)).setup_error).toMatch(new RegExp(`${ours} is already there and is not a clone of ${repo}`));
    expect(readdirSync(ours)).toEqual(['mine.txt']);
    expect(clones()).toEqual([]);
    expect(r.db.channels.get(ch)!.repo_path).not.toBe(ours);
  });
});

describe('with sync on', () => {
  it('moves the channel to its clone on this machine only', async () => {
    updateUserConfig({ workspace: { reposDir: join(r.tmp, 'synced-repos') } });
    r.db.outbox.arm('mac-test');
    const { repo, name } = source();
    const ch = channel(`/no-such-root-${++n}/ben/${name}`, repo);
    const queued = () => (r.db.db.prepare(`SELECT count(*) AS n FROM sync_outbox WHERE entity = 'channel' AND entity_id = ?`).get(ch) as { n: number }).n;
    const before = queued();
    const t = await r.runner.createThread({ channel: ch, prompt: 'go' });
    await r.untilResults(t.id, 1);
    expect(r.db.channels.get(ch)!.repo_path).toBe(join(r.tmp, 'synced-repos', name));
    expect(queued()).toBe(before);
  });
});

describe('githubRepoOf', () => {
  it('reads owner/name from the URLs gh and git clone with', () => {
    expect(githubRepoOf('https://github.com/Acme/Shop.git')).toBe('acme/shop');
    expect(githubRepoOf('git@github.com:acme/shop.git')).toBe('acme/shop');
    expect(githubRepoOf('ssh://git@github.com/acme/shop')).toBe('acme/shop');
    expect(githubRepoOf('https://gitlab.com/acme/shop.git')).toBeNull();
  });
});
