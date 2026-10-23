import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { startRunner } from './runner-boot.ts';

// A worktree thread's checkout moves between two clones of one repo, as on two Macs: its unpushed commits, its
// uncommitted edits and its untracked files arrive, uncommitted again, and the giving clone is left as it was.

const h = await startRunner();
const { packWorktree, unpackWorktree } = await import('../handoff/worktree.ts');
const relay = new MemoryTransport();
const T = { timeout: 60_000 };
const THREAD = 'thread-1';
const BRANCH = 'omni/thread-1';

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', dir, ...args], { encoding: 'utf8' }).trimEnd();
const write = (path: string, body: string) => (mkdirSync(join(path, '..'), { recursive: true }), writeFileSync(path, body));
const read = (path: string) => readFileSync(path, 'utf8');
/** Every change in the checkout, untracked files one by one. */
const status = (dir: string) => git(dir, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).sort();

const root = join(h.tmp, 'repos');
const origin = join(root, 'origin.git');
const repoA = join(root, 'a');
const repoB = join(root, 'b');
const wtA = join(root, 'a-data', 'worktrees', THREAD);
const wtB = join(root, 'b-data', 'worktrees', THREAD);

const hand = async (from: string, to: { repo: string; dir: string }, offerId: string) => {
  const bundle = await packWorktree(from, THREAD, offerId, relay);
  await unpackWorktree({ ...to, branch: BRANCH, threadId: THREAD, offerId, bundle, transport: relay });
  return bundle;
};

beforeAll(() => {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = join(root, 'seed');
  git(root, 'init', '-q', '-b', 'main', seed);
  git(seed, 'remote', 'add', 'origin', origin);
  write(join(seed, 'README.md'), 'shop\n');
  write(join(seed, '.gitignore'), '*.log\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'first');
  git(seed, 'push', '-q', 'origin', 'HEAD:main');
  git(root, 'clone', '-q', origin, repoA);
  git(root, 'clone', '-q', origin, repoB);
  mkdirSync(join(wtA, '..'), { recursive: true });
  git(repoA, 'worktree', 'add', '-q', '-b', BRANCH, wtA, 'HEAD');
});

describe('a worktree handed to another Mac', () => {
  it('arrives with its unpushed commit and its changes uncommitted, and the giving checkout is untouched', T, async () => {
    write(join(wtA, 'cart.js'), 'export const total = 1;\n');
    git(wtA, 'add', 'cart.js');
    git(wtA, 'commit', '-q', '-m', 'unpushed cart');
    write(join(wtA, 'README.md'), 'shop, edited on A\n');
    write(join(wtA, 'notes', 'todo.md'), '- the drawer\n');
    write(join(wtA, 'staged.txt'), 'staged on A\n');
    git(wtA, 'add', 'staged.txt');
    write(join(wtA, 'debug.log'), 'ignored\n');
    const before = { status: status(wtA), head: git(wtA, 'rev-parse', 'HEAD'), staged: git(wtA, 'diff', '--cached', '--name-only') };

    const bundle = await hand(wtA, { repo: repoB, dir: wtB }, 'offer-1');

    expect({ status: status(wtA), head: git(wtA, 'rev-parse', 'HEAD'), staged: git(wtA, 'diff', '--cached', '--name-only') }).toEqual(before);
    expect(bundle.base).toBe(before.head);
    expect(git(wtB, 'branch', '--show-current')).toBe(BRANCH);
    expect(git(wtB, 'rev-parse', 'HEAD')).toBe(before.head);
    expect(git(wtB, 'log', '--format=%s')).toBe('unpushed cart\nfirst');
    expect(status(wtB)).toEqual([' M README.md', '?? notes/todo.md', '?? staged.txt']);
    expect(read(join(wtB, 'README.md'))).toBe('shop, edited on A\n');
    expect(read(join(wtB, 'notes', 'todo.md'))).toBe('- the drawer\n');
    expect(existsSync(join(wtB, 'debug.log'))).toBe(false);
  });

  it('replaces the stale changes the first Mac kept when the thread comes back', T, async () => {
    write(join(wtB, 'README.md'), 'shop, edited on B\n');
    rmSync(join(wtB, 'notes'), { recursive: true });
    write(join(wtB, 'tax.js'), 'export const tax = 0.21;\n');
    git(wtB, 'add', 'tax.js');
    git(wtB, 'commit', '-q', '-m', 'tax on B');
    write(join(wtB, 'more.txt'), 'new on B\n');

    await hand(wtB, { repo: repoA, dir: wtA }, 'offer-2');

    expect(git(wtA, 'rev-parse', 'HEAD')).toBe(git(wtB, 'rev-parse', 'HEAD'));
    expect(status(wtA)).toEqual([' M README.md', '?? more.txt', '?? staged.txt']);
    expect(read(join(wtA, 'README.md'))).toBe('shop, edited on B\n');
    expect(existsSync(join(wtA, 'notes'))).toBe(false);
    // Ignored files are each Mac's own.
    expect(read(join(wtA, 'debug.log'))).toBe('ignored\n');
  });

  it('leaves a worktree with changes of this Mac\'s own alone and says why', T, async () => {
    write(join(wtB, 'README.md'), 'edited on B after it left\n');
    const mine = status(wtB);
    write(join(wtA, 'cart.js'), 'export const total = 2;\n');

    await expect(hand(wtA, { repo: repoB, dir: wtB }, 'offer-3')).rejects.toThrow(/uncommitted changes of its own/);
    expect(status(wtB)).toEqual(mine);
    expect(read(join(wtB, 'README.md'))).toBe('edited on B after it left\n');
  });
});
