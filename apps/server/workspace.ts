// One thing at a time in a thread's folder: a turn starting there, a terminal opening, its worktree being made or
// checked out again, a handoff laying it out, or a cleanup removing it (worktree-cleanup.ts). Keyed by the folder, so
// threads that share one share its turn. A cleanup holds the folder from its last checks to the removal, so whatever
// starts first wins: a start that came first keeps the folder, and one that comes during the removal waits and checks
// the branch out again.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { paths } from './config.ts';
import { channels, threads, type Thread } from './db.ts';
import { restoreWorktree } from './sandbox.ts';

const run = promisify(execFile);

const chains = new Map<string, Promise<unknown>>();

/** Run fn once everything queued on dir before it has settled, and hold dir until fn settles. Not re-entrant. */
export function withWorkspace<T>(dir: string, fn: () => T | Promise<T>): Promise<T> {
  const key = resolve(dir);
  const next = (chains.get(key) ?? Promise.resolve()).then(fn, fn);
  chains.set(key, next);
  const clear = () => {
    if (chains.get(key) === next) chains.delete(key);
  };
  next.then(clear, clear);
  return next;
}

/** Where a cleanup keeps the last commit of the worktree it removed, so the branch can be made again from it. */
export const keptRef = (threadId: string) => `refs/omni/removed/${threadId}`;

/**
 * Where a cleanup moves a worktree before deleting it: the thread's path goes in one rename, so a removal cut short
 * (a restart, a timeout) never leaves a half-deleted checkout there for the next turn to run in.
 */
export const trashOf = (dir: string) => join(dirname(dir), `.removing-${basename(dir)}`);

const git = (cwd: string, ...args: string[]) =>
  run('git', ['-C', cwd, ...args], { timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
const succeeds = (p: Promise<unknown>) => p.then(() => true, () => false);

/**
 * Check the branch out at dir again: the repo's copy, else origin's when it has the commit the cleanup kept, else
 * the branch made again at that commit. Throws, saying what to do, when there is none.
 */
async function restore(repo: string, dir: string, branch: string) {
  const local = `refs/heads/${branch}`;
  const kept = keptRef(basename(dir));
  // A removal cut short after its move still has the branch checked out in the leftover: let go of it, files untouched.
  if (existsSync(trashOf(dir))) await succeeds(git(trashOf(dir), 'checkout', '--quiet', '--detach'));
  if (!(await succeeds(git(repo, 'rev-parse', '--verify', '--quiet', local))) && (await succeeds(git(repo, 'rev-parse', '--verify', '--quiet', kept)))) {
    await succeeds(git(repo, 'fetch', '--quiet', 'origin', `${local}:${local}`));
    // Never resume behind where the thread was: origin's copy only when it already has the kept commit.
    if (!(await succeeds(git(repo, 'merge-base', '--is-ancestor', kept, local)))) await git(repo, 'branch', '--force', branch, kept);
  }
  try {
    await restoreWorktree(repo, dir, branch);
  } catch (err) {
    if (await succeeds(git(repo, 'rev-parse', '--verify', '--quiet', local))) throw err;
    throw new Error(
      `its branch ${branch} is gone from ${repo} and its origin. Make it again at the commit the thread was on (git -C ${repo} branch ${branch} <commit>), then try again.`,
    );
  }
  // The branch has the commit again.
  await succeeds(git(repo, 'update-ref', '-d', kept));
}

/** For a turn about to start: the worktree at dir, checked out again from its branch unless it is already there. */
export const restoreCheckout = (repo: string, dir: string, branch: string): Promise<void> =>
  withWorkspace(dir, async () => {
    if (!existsSync(dir)) await restore(repo, dir, branch);
  });

/**
 * Run fn with the thread's folder held, so no cleanup removes it meanwhile. A worktree a cleanup removed is checked
 * out again first, on the branch of the thread it belongs to (a thread working in another's folder gets that one's);
 * fn hears why when that failed. Any other missing folder is fn's to report.
 */
export function inWorkspace<T>(t: Thread, fn: (problem: string | null) => T | Promise<T>): Promise<T> {
  return withWorkspace(t.cwd, async () => {
    const id = basename(t.cwd);
    const owner = id === t.id ? t : threads.get(id);
    const repo = owner ? channels.get(owner.channel_id)?.repo_path : null;
    const managed = resolve(dirname(t.cwd)) === resolve(paths.worktrees);
    if (existsSync(t.cwd) || !managed || !owner?.branch || !repo || !existsSync(repo)) return fn(null);
    try {
      await restore(repo, t.cwd, owner.branch);
      return fn(null);
    } catch (err) {
      return fn(`Omni could not check this thread's worktree out again: ${(err as Error).message}`);
    }
  });
}
