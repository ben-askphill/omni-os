import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The one workspace checkpoint (apps/server/checkpoint.ts) that turn snapshots, Continue and a worktree handoff share:
// the two capture policies, a ref that is new only or replaced, and laying a checkpoint out as uncommitted changes.

const r = await startRunner();
const { applyCheckpoint, captureTree, commitCheckpoint, findCheckpoint } = await import('../checkpoint.ts');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trimEnd();
const status = (dir: string) => git(dir, 'status', '--porcelain', '-uall').split('\n').filter(Boolean).sort();
const names = (dir: string, tree: string) => git(dir, 'ls-tree', '-r', '--name-only', tree).split('\n');

let n = 0;
/** A repo with a commit, an edit, an untracked text file, a binary one and an ignored one. */
function repo() {
  const dir = join(r.tmp, `checkpoint-repo-${++n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'one\n');
  writeFileSync(join(dir, '.gitignore'), '.env\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  writeFileSync(join(dir, 'README.md'), 'one\ntwo\n');
  writeFileSync(join(dir, 'notes.md'), 'note\n');
  writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2]));
  writeFileSync(join(dir, '.env'), 'TOKEN=secret\n');
  return dir;
}

describe('a workspace checkpoint', () => {
  it('keeps what a diff shows under `text`, and everything git does not ignore under `all`', async () => {
    const dir = repo();
    const before = status(dir);
    const text = await captureTree(dir, 'text');
    const all = await captureTree(dir, 'all');
    expect(text.head).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(all.head).toBe(text.head);
    expect(names(dir, text.tree)).toEqual(['.gitignore', 'README.md', 'notes.md']);
    expect(text.skipped).toEqual([{ path: 'blob.bin', reason: 'binary' }]);
    expect(names(dir, all.tree)).toEqual(['.gitignore', 'README.md', 'blob.bin', 'notes.md']);
    expect(all.skipped).toEqual([]);
    expect(status(dir), 'the checkout is left as it was').toEqual(before);
  });

  it('refuses to write a `new` ref twice, and moves a `replace` one', async () => {
    const dir = repo();
    const { tree, head } = await captureTree(dir, 'text');
    const ref = 'refs/omni/test/new';
    const sha = await commitCheckpoint(dir, { tree, parent: head, message: 'one', ref, mode: 'new' });
    expect(await findCheckpoint(dir, ref)).toBe(sha);
    expect(git(dir, 'rev-parse', `${sha}^`)).toBe(head);
    await expect(commitCheckpoint(dir, { tree, parent: head, message: 'two', ref, mode: 'new' })).rejects.toThrow();
    expect(await findCheckpoint(dir, ref)).toBe(sha);
    const moved = await commitCheckpoint(dir, { tree, parent: head, message: 'two', ref, mode: 'replace' });
    expect(moved).not.toBe(sha);
    expect(await findCheckpoint(dir, ref)).toBe(moved);
    expect(await findCheckpoint(dir, 'refs/omni/test/missing')).toBeNull();
  });

  it('lays a checkpoint out as uncommitted changes in a clean checkout at its parent', async () => {
    const dir = repo();
    const { tree, head } = await captureTree(dir, 'text');
    const sha = await commitCheckpoint(dir, { tree, parent: head, message: 'carry', ref: 'refs/omni/test/carry', mode: 'new' });
    const other = join(r.tmp, `checkpoint-wt-${++n}`);
    git(dir, 'worktree', 'add', '-q', '-b', 'carried', other, head);
    await applyCheckpoint(other, sha);
    expect(git(other, 'rev-parse', 'HEAD')).toBe(head);
    expect(status(other)).toEqual([' M README.md', '?? notes.md']);
    expect(readFileSync(join(other, 'README.md'), 'utf8')).toBe('one\ntwo\n');
  });
});
