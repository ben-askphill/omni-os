import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { worktreeProblem } from '../sandbox.ts';
import { MAX_FILE_BYTES } from '../sync/files.ts';
import type { SyncTransport } from '../sync/transport.ts';

// A worktree thread's checkout, carried between Macs as a git bundle: the branch's commits that are on no remote, and
// one more commit on top holding its uncommitted and untracked files (what .gitignore keeps out stays on each Mac).
// The giving Mac's working tree and index are never touched. The taking Mac gets the branch at the same commit and the
// changes uncommitted again. Each handoff's commit stays under refs/omni/handoff/<thread>/<offer> on both Macs, which
// is how a Mac knows its worktree holds only what it handed away earlier.

/** The storage path and commits a worktree thread's offer names (packages/shared/handoff.ts). */
export interface WorktreeBundle {
  path: string;
  /** The branch's HEAD on the giving Mac. */
  base: string;
  /** The commit on top of base with the uncommitted changes. */
  wip: string;
}

const run = promisify(execFile);
/** The handoff commit is Omni's, never on a branch: no identity of Ben's is needed or used. */
const IDENTITY = { GIT_AUTHOR_NAME: 'Omni', GIT_AUTHOR_EMAIL: 'omni@localhost', GIT_COMMITTER_NAME: 'Omni', GIT_COMMITTER_EMAIL: 'omni@localhost' };

async function git(dir: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, ...args], {
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
      // Never wait on a credential prompt: a Mac is waiting for the thread.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const why = (e.stderr || e.message || String(err)).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('hint:'));
    throw new Error(`git ${args[0]} failed: ${why.slice(-2).join(' ') || 'unknown error'}`);
  }
}

const succeeds = (p: Promise<unknown>) => p.then(() => true, () => false);

export const handoffRef = (threadId: string, offerId: string) => `refs/omni/handoff/${threadId}/${offerId}`;

/** True when the thread runs in a worktree of its own: Omni's, named after it, on its branch. */
export const inOwnWorktree = (t: { id: string; cwd: string; branch: string | null }) =>
  !!t.branch && basename(t.cwd) === t.id && basename(dirname(t.cwd)) === 'worktrees';

function scratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'omni-handoff-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

/** The tree a commit of everything git does not ignore in the checkout would have, read through an index of its own. */
const snapshotTree = (dir: string) =>
  scratch(async (tmp) => {
    const env = { GIT_INDEX_FILE: join(tmp, 'index') };
    await git(dir, ['read-tree', 'HEAD'], env);
    await git(dir, ['add', '-A'], env);
    return git(dir, ['write-tree'], env);
  });

const descends = async (dir: string, from: string, to: string) => from === to || succeeds(git(dir, ['merge-base', '--is-ancestor', from, to]));

const ownCommits = (branch: string) => new Error(`this Mac's copy of branch ${branch} has commits the other Mac's does not, so Omni left it alone`);

/** Pack the worktree at dir and upload the bundle. Changes nothing in the checkout. */
export async function packWorktree(dir: string, threadId: string, offerId: string, transport: SyncTransport): Promise<WorktreeBundle> {
  const base = await git(dir, ['rev-parse', 'HEAD']);
  const wip = await git(dir, ['commit-tree', await snapshotTree(dir), '-p', base, '-m', `Omni handoff ${offerId}: uncommitted changes`], IDENTITY);
  const ref = handoffRef(threadId, offerId);
  await git(dir, ['update-ref', ref, wip]);
  return scratch(async (tmp) => {
    const file = join(tmp, 'worktree.bundle');
    await git(dir, ['bundle', 'create', file, ref, '--not', '--remotes']);
    const size = statSync(file).size;
    if (size > MAX_FILE_BYTES) {
      throw new Error(`the worktree's commits and changes come to ${Math.ceil(size / 1024 / 1024)} MB, over the ${MAX_FILE_BYTES / 1024 / 1024} MB a handoff can carry`);
    }
    const path = `handoffs/${offerId}.bundle`;
    await transport.putObject(path, readFileSync(file), 'application/octet-stream');
    return { path, base, wip };
  });
}

export interface Unpack {
  /** The channel's repository on this Mac. */
  repo: string;
  /** Where the thread's worktree goes on this Mac. */
  dir: string;
  branch: string;
  threadId: string;
  offerId: string;
  bundle: WorktreeBundle;
  transport: SyncTransport;
}

/**
 * Lay a packed worktree out here: the branch at the giving Mac's HEAD, its changes uncommitted on top. A worktree that
 * is not here is made. One that is must hold nothing of this Mac's own: it is clean, or holds exactly what this Mac
 * handed away (or took) for the thread before. Throws, saying why, and changes nothing in it otherwise. Running it
 * again for the same offer ends the same way.
 */
export async function unpackWorktree(u: Unpack): Promise<void> {
  const { repo, dir, branch, bundle } = u;
  const body = await u.transport.getObject(bundle.path);
  if (!body) throw new Error("the worktree's bundle is not in sync storage");
  const ref = handoffRef(u.threadId, u.offerId);
  await scratch(async (tmp) => {
    const file = join(tmp, 'worktree.bundle');
    writeFileSync(file, body);
    const fetch = () => git(repo, ['fetch', '--quiet', '--no-tags', file, `+${ref}:${ref}`]);
    if (!(await succeeds(fetch()))) {
      // It builds on commits this Mac has not fetched yet: the other Mac fetched more of the remote.
      await succeeds(git(repo, ['fetch', '--quiet', 'origin']));
      await fetch();
    }
  });
  if ((await git(repo, ['rev-parse', ref])) !== bundle.wip || (await git(repo, ['rev-parse', `${bundle.wip}^`])) !== bundle.base) {
    throw new Error('the worktree bundle does not hold the commits its offer names');
  }
  if (!existsSync(dir)) {
    const here = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).catch(() => null);
    if (here && !(await descends(repo, here, bundle.base))) throw ownCommits(branch);
    // A worktree removed by hand is still registered until pruned, and holds its branch.
    await succeeds(git(repo, ['worktree', 'prune']));
    await git(repo, ['branch', '--force', branch, bundle.base]);
    await git(repo, ['worktree', 'add', '--quiet', dir, branch]);
  } else {
    const problem = await worktreeProblem(repo, dir, branch);
    if (problem) throw new Error(problem);
    const tree = await snapshotTree(dir);
    const clean = tree === (await git(dir, ['rev-parse', 'HEAD^{tree}']));
    if (!clean) {
      const handed = (await git(repo, ['for-each-ref', '--format=%(tree)', `refs/omni/handoff/${u.threadId}/`])).split('\n');
      if (!handed.includes(tree)) {
        throw new Error("this Mac's worktree for the thread has uncommitted changes of its own, so Omni left it alone. Commit or stash them there, then hand the thread over again");
      }
    }
    if (!(await descends(dir, await git(dir, ['rev-parse', 'HEAD']), bundle.base))) throw ownCommits(branch);
    await git(dir, ['reset', '--quiet', '--hard', bundle.base]);
    // What is left untracked is what this Mac handed away before, and that handoff's ref still holds it.
    if (!clean) await git(dir, ['clean', '--quiet', '-fd']);
  }
  await git(dir, ['read-tree', '-u', '--reset', bundle.wip]);
  // The index back at HEAD: the changes are uncommitted again, and new files untracked, as they were.
  await git(dir, ['reset', '--quiet']);
}
