// The git checks behind the worktree inventory (worktree-inventory.ts) and its cleanup (worktree-cleanup.ts): whether
// a folder is a registered worktree of a repo, what in it no remote has, whether its branch is merged, and whether its
// thread is busy. Nothing here removes anything.
import { execFile } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.ts';
import { channels, type Thread } from './db.ts';
import { mergedBranchPRs } from './github.ts';
import { runsHere } from './runner/state.ts';

const run = promisify(execFile);
const DAY = 24 * 3600 * 1000;

/** The signal that stops every git call made inside `withSignal`, so a cancelled storage scan does not wait on them. */
const cancel = new AsyncLocalStorage<AbortSignal>();
export const currentSignal = () => cancel.getStore();
export const withSignal = <T>(signal: AbortSignal, fn: () => T): T => cancel.run(signal, fn);

/** git in dir, never prompting and never taking the index lock; null when it fails. */
export const git = (dir: string, ...args: string[]) =>
  run('git', ['-C', dir, ...args], {
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    signal: cancel.getStore(),
  }).then(
    (r) => r.stdout.trim(),
    () => null,
  );

export const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

export type SweepReason = 'archived' | 'deleted' | 'merged';

/** What a worktree holds that no remote has, counted. `statusFailed` and `pushUnknown` are checks that could not run. */
export interface LocalWork {
  /** Modified, staged or deleted tracked files. */
  changed: number;
  untracked: number;
  /** Commits on HEAD no remote has. */
  unpushed: number;
  noCommits: boolean;
  statusFailed: boolean;
  pushUnknown: boolean;
}

/**
 * What the worktree at dir would lose if it went: changes and untracked files, and commits on HEAD that are on no
 * remote (a head that is the merged PR's head, for a squash merge whose branch was deleted, counts as pushed).
 * Ignored files (node_modules, build output) are not counted.
 */
export async function localWork(dir: string, pushedHead?: string | null): Promise<LocalWork> {
  const w: LocalWork = { changed: 0, untracked: 0, unpushed: 0, noCommits: false, statusFailed: false, pushUnknown: false };
  const status = await git(dir, 'status', '--porcelain', '--untracked-files=all');
  if (status === null) w.statusFailed = true;
  else if (status) for (const line of status.split('\n')) line.startsWith('??') ? w.untracked++ : w.changed++;
  const head = await git(dir, 'rev-parse', 'HEAD');
  if (!head) {
    w.noCommits = true;
    return w;
  }
  if (pushedHead && head === pushedHead) return w;
  const ahead = await git(dir, 'rev-list', '--count', 'HEAD', '--not', '--remotes');
  if (ahead === null) w.pushUnknown = true;
  else w.unpushed = Number(ahead);
  return w;
}

/** origin's default branch as a remote ref (origin/main), or null. */
async function defaultRef(repo: string): Promise<string | null> {
  const head = await git(repo, 'rev-parse', '--abbrev-ref', 'origin/HEAD');
  if (head && head !== 'origin/HEAD') return head;
  for (const ref of ['origin/main', 'origin/master']) if (await git(repo, 'rev-parse', '--verify', '--quiet', ref)) return ref;
  return null;
}

/**
 * Whether the worktree's HEAD is accounted for on origin's default branch: it is in it, or (a squash merge leaves it
 * outside) the branch's PR into that branch is merged with HEAD as its head and its merge commit is in it. `prHead`
 * is that head.
 */
export async function branchMerged(repo: string, dir: string, branch: string, githubRepo: string | null): Promise<{ merged: boolean; prHead?: string }> {
  const ref = await defaultRef(repo);
  if (!ref) return { merged: false };
  if ((await git(dir, 'merge-base', '--is-ancestor', 'HEAD', ref)) !== null) return { merged: true };
  if (!githubRepo) return { merged: false };
  const head = await git(dir, 'rev-parse', 'HEAD');
  const base = ref.slice(ref.indexOf('/') + 1);
  for (const pr of await mergedBranchPRs(githubRepo, branch).catch(() => [])) {
    if (pr.baseRefName !== base || pr.headRefOid !== head || !pr.mergeCommit?.oid) continue;
    if ((await git(dir, 'merge-base', '--is-ancestor', pr.mergeCommit.oid, ref)) !== null) return { merged: true, prHead: head };
  }
  return { merged: false };
}

/** The repo a worktree folder belongs to, when it is a registered worktree of one, else null. */
export async function owningRepo(dir: string): Promise<string | null> {
  const top = await git(dir, 'rev-parse', '--show-toplevel');
  if (!top || real(top) !== real(dir)) return null;
  const common = await git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  if (!common) return null;
  const repo = basename(common) === '.git' ? dirname(common) : common;
  const list = await git(repo, 'worktree', 'list', '--porcelain');
  const registered = (list ?? '').split('\n').some((l) => l.startsWith('worktree ') && real(l.slice(9)) === real(dir));
  return registered ? repo : null;
}

/** Why the thread's worktree is in use (running, queued, its process still open, or being made), or null. */
export function busy(t: Thread): string | null {
  if (t.status === 'running' || t.status === 'queued') return 'the thread is running';
  if (t.setup === 'preparing') return 'its worktree is being made';
  if (runsHere(t.id)) return 'its process is still open';
  return null;
}

/** Why a thread's worktree is up for removal, or null when it is not. */
export async function candidate(t: Thread, repo: string, dir: string, now: number): Promise<{ reason: SweepReason; prHead?: string } | null> {
  if (t.archived) return { reason: 'archived' };
  if (!t.branch || now - Date.parse(t.updated_at) < config.worktreeIdleDays * DAY) return null;
  const m = await branchMerged(repo, dir, t.branch, channels.get(t.channel_id)?.github_repo ?? null);
  return m.merged ? { reason: 'merged', prHead: m.prHead } : null;
}
