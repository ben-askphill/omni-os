import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// GET /api/threads/:id/changes against real temp repos: a worktree thread made by Setup, and a thread that runs in
// the repo itself. Committed, staged, unstaged and untracked changes, deletions, renames, binary and oversized
// files, and the threads that have no checkout here to read.

const r = await startRunner();
const { app } = await import('../app.ts');
const { MAX_FILE_LINES, MAX_FILES, MAX_UNTRACKED_BYTES, addedFileDiff, parseNameStatus, parseNumstat, splitPatch } = await import('../changes.ts');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

let n = 0;
/** A repo on main with a README, a file to delete and one to rename. */
function repo() {
  const dir = join(r.tmp, `changes-repo-${++n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'one\ntwo\nthree\n');
  writeFileSync(join(dir, 'old.txt'), 'going away\n');
  writeFileSync(join(dir, 'move-me.txt'), Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n');
  writeFileSync(join(dir, '.gitignore'), 'ignored/\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  return dir;
}
const channel = (repoPath: string | null, worktree = true) => {
  const id = `ch-${++n}`;
  r.db.channels.create({ id, name: id, repo_path: repoPath, use_worktree: worktree ? 1 : 0 });
  return id;
};
const changes = async (id: string) => {
  const res = await app.request(`/api/threads/${id}/changes`);
  return { status: res.status, body: (await res.json()) as any };
};
const group = (body: any, kind: string) => body.groups.find((g: any) => g.kind === kind);
const paths = (body: any, kind: string) => group(body, kind).files.map((f: any) => [f.status, f.path]);

/** A worktree thread whose first turn is done, so its worktree is made and its base recorded. */
async function worktreeThread() {
  const dir = repo();
  const t = await r.runner.createThread({ channel: channel(dir), prompt: 'work' });
  await r.untilResults(t.id, 1);
  return { t: r.thread(t.id), repo: dir };
}

describe('branch changes of a worktree thread', () => {
  it('splits committed, staged, unstaged and untracked work against the commit the branch was cut from', async () => {
    const { t, repo: main } = await worktreeThread();
    const start = git(main, 'rev-parse', 'HEAD');
    // main moves on after the thread started: none of that is the thread's change.
    writeFileSync(join(main, 'later-on-main.txt'), 'not ours\n');
    git(main, 'add', '.');
    git(main, 'commit', '-q', '-m', 'main moves');

    const wt = t.cwd;
    // Committed: an edit, a deletion and a rename.
    writeFileSync(join(wt, 'README.md'), 'one\n2\nthree\nfour\n');
    git(wt, 'rm', '-q', 'old.txt');
    git(wt, 'mv', 'move-me.txt', 'moved.txt');
    git(wt, 'commit', '-q', '-am', 'branch work');
    // Staged, then unstaged on top of a different file.
    writeFileSync(join(wt, 'staged.txt'), 'staged\n');
    git(wt, 'add', 'staged.txt');
    writeFileSync(join(wt, 'README.md'), 'one\n2\nthree\nfour\nfive\n');
    // Untracked, and an ignored one that never shows.
    writeFileSync(join(wt, 'notes.md'), 'a\nb');
    mkdirSync(join(wt, 'ignored'));
    writeFileSync(join(wt, 'ignored', 'x.txt'), 'x\n');

    const { status, body } = await changes(t.id);
    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.base).toMatchObject({ sha: start, ref: 'main', how: 'thread-start' });
    expect(body.branch).toBe(t.branch);
    expect(body.head).toBe(git(wt, 'rev-parse', 'HEAD'));
    expect(body.groups.map((g: any) => g.kind)).toEqual(['committed', 'staged', 'unstaged', 'untracked']);

    expect(paths(body, 'committed')).toEqual([
      ['modified', 'README.md'],
      ['renamed', 'moved.txt'],
      ['deleted', 'old.txt'],
    ]);
    const [readme, moved, old] = group(body, 'committed').files;
    expect(readme).toMatchObject({ additions: 2, deletions: 1, binary: false, omitted: null });
    expect(readme.diff).toMatch(/^diff --git a\/README\.md b\/README\.md\n/);
    expect(readme.diff).toContain('\n-two\n+2\n');
    expect(moved).toMatchObject({ old_path: 'move-me.txt', additions: 0, deletions: 0 });
    expect(moved.diff).toContain('rename from move-me.txt');
    expect(old).toMatchObject({ status: 'deleted', additions: 0, deletions: 1 });
    expect(old.diff).toContain('-going away');

    expect(paths(body, 'staged')).toEqual([['added', 'staged.txt']]);
    expect(paths(body, 'unstaged')).toEqual([['modified', 'README.md']]);
    expect(group(body, 'unstaged').files[0].diff).toContain('+five');
    expect(paths(body, 'untracked')).toEqual([['added', 'notes.md']]);
    const notes = group(body, 'untracked').files[0];
    expect(notes).toMatchObject({ additions: 2, deletions: 0, omitted: null });
    expect(notes.diff).toBe('diff --git a/notes.md b/notes.md\nnew file mode 100644\n--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file\n');

    // The base stays put across refreshes, even after the thread's own commits.
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', 'everything');
    const again = (await changes(t.id)).body;
    expect(again.base).toEqual(body.base);
    expect(paths(again, 'committed').map((p: string[]) => p[1])).toEqual(['README.md', 'moved.txt', 'notes.md', 'old.txt', 'staged.txt']);
    expect(group(again, 'staged').files).toEqual([]);
    expect(group(again, 'untracked').files).toEqual([]);
  });

  it('bounds binary, oversized and symlinked files, and never reads outside the checkout', async () => {
    const { t } = await worktreeThread();
    const wt = t.cwd;
    writeFileSync(join(wt, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]));
    writeFileSync(join(wt, 'tracked.bin'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(wt, 'huge.txt'), Array.from({ length: MAX_FILE_LINES + 10 }, (_, i) => `row ${i}`).join('\n') + '\n');
    git(wt, 'add', 'tracked.bin', 'huge.txt');
    git(wt, 'commit', '-q', '-m', 'big and binary');
    writeFileSync(join(wt, 'too-big.log'), 'x'.repeat(MAX_UNTRACKED_BYTES + 1));
    const outside = join(r.tmp, `secret-${n}.txt`);
    writeFileSync(outside, 'never shown\n');
    symlinkSync(outside, join(wt, 'link.txt'));

    const { body } = await changes(t.id);
    const committed = Object.fromEntries(group(body, 'committed').files.map((f: any) => [f.path, f]));
    expect(committed['tracked.bin']).toMatchObject({ binary: true, additions: null, deletions: null, omitted: 'binary', diff: '' });
    expect(committed['huge.txt']).toMatchObject({ binary: false, additions: MAX_FILE_LINES + 10, omitted: 'too_large', diff: '' });
    const untracked = Object.fromEntries(group(body, 'untracked').files.map((f: any) => [f.path, f]));
    expect(untracked['logo.png']).toMatchObject({ binary: true, omitted: 'binary', diff: '' });
    expect(untracked['too-big.log']).toMatchObject({ omitted: 'too_large', additions: null, diff: '' });
    expect(untracked['link.txt']).toMatchObject({ omitted: 'symlink', diff: '' });
    expect(JSON.stringify(body)).not.toContain('never shown');
  });

  it('lists at most MAX_FILES untracked files and says it cut the list', async () => {
    const { t } = await worktreeThread();
    mkdirSync(join(t.cwd, 'many'));
    for (let i = 0; i < MAX_FILES + 5; i++) writeFileSync(join(t.cwd, 'many', `f${String(i).padStart(4, '0')}.txt`), `${i}\n`);
    const { body } = await changes(t.id);
    expect(group(body, 'untracked').files).toHaveLength(MAX_FILES);
    expect(group(body, 'untracked').truncated).toBe(true);
  });

  it('is unavailable while the worktree is not on this Mac or not on its branch', async () => {
    const { t } = await worktreeThread();
    git(t.cwd, 'checkout', '-q', '-b', 'elsewhere');
    expect((await changes(t.id)).body).toEqual({ available: false, reason: expect.stringContaining('not omni/') });
    rmSync(t.cwd, { recursive: true, force: true });
    expect((await changes(t.id)).body).toEqual({ available: false, reason: "This thread's worktree is not on this Mac." });
  });
});

describe('branch changes of other threads', () => {
  it('records the merge base with main for a thread that runs in the repo itself', async () => {
    const dir = repo();
    const base = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(dir, 'feature.txt'), 'f\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'feature');
    const t = r.db.threads.create({
      id: `t-${++n}`, channel_id: channel(dir, false), title: 'in repo', status: 'done', role: null, model: null, session_id: 's',
      cwd: dir, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
    });
    const { body } = await changes(t.id);
    expect(body.base).toMatchObject({ sha: base, ref: 'main', how: 'merge-base' });
    expect(paths(body, 'committed')).toEqual([['added', 'feature.txt']]);
    expect(r.db.threadBases.get(t.id)?.sha).toBe(base);
  });

  it('says why for Hermes, no repo, a thread outside the repo, and an unknown thread', async () => {
    const dir = repo();
    const make = (patch: Record<string, unknown>) =>
      r.db.threads.create({
        id: `t-${++n}`, channel_id: channel(dir, false), title: 'x', status: 'done', role: null, model: null, session_id: 's',
        cwd: dir, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null, ...patch,
      } as any);
    const hermes = make({ harness: 'hermes' });
    expect((await changes(hermes.id)).body).toEqual({ available: false, reason: expect.stringContaining('Hermes server') });
    const noRepo = make({ channel_id: channel(null, false) });
    expect((await changes(noRepo.id)).body).toEqual({ available: false, reason: expect.stringContaining('no repository') });
    const brain = make({ cwd: r.tmp });
    expect((await changes(brain.id)).body).toEqual({ available: false, reason: expect.stringContaining("does not run in its channel's repository") });
    expect((await changes('nope')).status).toBe(404);
  });
});

describe('diff parsing helpers', () => {
  it('reads -z name-status and numstat, renames included', () => {
    expect(parseNameStatus('M\0a.txt\0R087\0old name.txt\0new name.txt\0D\0gone\0')).toEqual([
      { status: 'modified', path: 'a.txt', old_path: null },
      { status: 'renamed', path: 'new name.txt', old_path: 'old name.txt' },
      { status: 'deleted', path: 'gone', old_path: null },
    ]);
    expect(parseNumstat('3\t1\ta.txt\0' + '0\t0\t\0old\0new\0' + '-\t-\tbin\0')).toEqual([
      { additions: 3, deletions: 1 },
      { additions: 0, deletions: 0 },
      { additions: null, deletions: null },
    ]);
  });

  it('splits a patch per file and makes an added file diff', () => {
    expect(splitPatch('diff --git a/x b/x\n@@ -1 +1 @@\n-diff --git a/y b/y\n+z\ndiff --git a/y b/y\n')).toEqual([
      'diff --git a/x b/x\n@@ -1 +1 @@\n-diff --git a/y b/y\n+z\n',
      'diff --git a/y b/y\n',
    ]);
    expect(addedFileDiff('e', '')).toEqual({ diff: 'diff --git a/e b/e\nnew file mode 100644\n', additions: 0 });
    expect(addedFileDiff('one', 'x\n').diff).toContain('@@ -0,0 +1 @@\n+x\n');
  });
});
