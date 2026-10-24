// Takes thread worktrees out once nothing in them can be lost: the thread is archived or deleted, or its branch is
// merged and it has sat idle for a week. Each goes through `git worktree remove` in its own repo; the branch stays,
// so reopening the thread checks it out again (apps/server/sync/guard.ts). Runs on startup, once a day, and when Ben
// archives a thread.
import { execFile } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { config, paths } from './config.ts';
import { channels, threads, type Thread } from './db.ts';
import { mergedBranchPR } from './github.ts';
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

export interface SweepEntry {
  threadId: string;
  dir: string;
  repo: string | null;
  branch: string | null;
  /** Why it was a candidate (removed), or why it stays (skipped). */
  reason: string;
  bytes?: number;
}

export interface SweepResult {
  removed: SweepEntry[];
  skipped: SweepEntry[];
  freedBytes: number;
}

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

/** Why the worktree at dir must stay, or null when nothing in it can be lost (see localWork). */
export async function unsafeToRemove(dir: string, pushedHead?: string | null): Promise<string | null> {
  const w = await localWork(dir, pushedHead);
  if (w.statusFailed) return 'git status failed';
  if (w.changed + w.untracked) return `uncommitted or untracked changes (${w.changed + w.untracked} files)`;
  if (w.noCommits) return 'it has no commits';
  if (w.pushUnknown) return 'could not tell which commits are pushed';
  if (w.unpushed > 0) return `${w.unpushed} commit(s) not pushed`;
  return null;
}

/** origin's default branch as a remote ref (origin/main), or null. */
async function defaultRef(repo: string): Promise<string | null> {
  const head = await git(repo, 'rev-parse', '--abbrev-ref', 'origin/HEAD');
  if (head && head !== 'origin/HEAD') return head;
  for (const ref of ['origin/main', 'origin/master']) if (await git(repo, 'rev-parse', '--verify', '--quiet', ref)) return ref;
  return null;
}

/**
 * Whether the worktree's branch is merged: HEAD is in origin's default branch, or the branch's PR on GitHub is
 * merged (a squash merge leaves HEAD outside it). `prHead` is that PR's head commit.
 */
export async function branchMerged(repo: string, dir: string, branch: string, githubRepo: string | null): Promise<{ merged: boolean; prHead?: string }> {
  const ref = await defaultRef(repo);
  if (ref && (await git(dir, 'merge-base', '--is-ancestor', 'HEAD', ref)) !== null) return { merged: true };
  if (!githubRepo) return { merged: false };
  const pr = await mergedBranchPR(githubRepo, branch).catch(() => null);
  return pr ? { merged: true, prHead: pr.headRefOid } : { merged: false };
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

const sizeOf = (dir: string) =>
  run('du', ['-sk', dir], { timeout: 120_000 }).then(
    (r) => Number(r.stdout.split('\t')[0]) * 1024,
    () => 0,
  );

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

/** One sweep at a time: the daily pass and an archive never remove the same worktree twice at once. */
let sweeping: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = sweeping.catch(() => {}).then(fn);
  sweeping = next;
  return next;
};

/**
 * Remove the worktrees in data/worktrees that are safe to remove, then `git worktree prune` in each repo touched.
 * `only` limits it to one thread (Ben just archived it). Never throws; what it skipped says why.
 */
export function sweepWorktrees(opts: { only?: string; now?: number; fetch?: boolean } = {}): Promise<SweepResult> {
  return serial(() => sweep(opts));
}

async function sweep({ only, now = Date.now(), fetch = true }: { only?: string; now?: number; fetch?: boolean }): Promise<SweepResult> {
  const result: SweepResult = { removed: [], skipped: [], freedBytes: 0 };
  if (!existsSync(paths.worktrees)) return result;
  const ids = only ? [only] : readdirSync(paths.worktrees);
  const fetched = new Set<string>();
  for (const id of ids) {
    const dir = join(paths.worktrees, id);
    if (!existsSync(dir)) continue;
    const t = threads.get(id);
    const skip = (repo: string | null, reason: string) => result.skipped.push({ threadId: id, dir, repo, branch: t?.branch ?? null, reason });
    const inUse = t && busy(t);
    if (inUse) {
      if (only || t.archived) skip(null, inUse);
      continue;
    }
    const repo = await owningRepo(dir);
    if (!repo) {
      // Not a worktree any repo knows (a leftover folder): left for Ben, never deleted by hand.
      if (!t || t.archived) skip(null, 'not a registered git worktree');
      continue;
    }
    if (fetch && !fetched.has(repo)) {
      fetched.add(repo);
      await git(repo, 'fetch', '--quiet', 'origin');
    }
    const why = t ? await candidate(t, repo, dir, now) : { reason: 'deleted' as const };
    if (!why) continue;
    const branch = await git(dir, 'branch', '--show-current');
    if (t?.branch && branch !== t.branch) {
      skip(repo, `it is on ${branch ? `branch ${branch}` : 'a detached HEAD'}, not the thread's ${t.branch}`);
      continue;
    }
    const unsafe = await unsafeToRemove(dir, why.prHead);
    if (unsafe) {
      skip(repo, unsafe);
      continue;
    }
    // Checked again just before: Ben may have sent it a message while the checks ran.
    const again = threads.get(id);
    const nowInUse = again && busy(again);
    if (nowInUse) {
      skip(repo, nowInUse);
      continue;
    }
    const bytes = await sizeOf(dir);
    // No --force: git refuses a worktree with changes, a last guard behind the checks above.
    if ((await git(repo, 'worktree', 'remove', dir)) === null) {
      skip(repo, 'git worktree remove refused it');
      continue;
    }
    result.removed.push({ threadId: id, dir, repo, branch: branch || null, reason: why.reason, bytes });
    result.freedBytes += bytes;
  }
  for (const repo of new Set(result.removed.map((r) => r.repo!))) await git(repo, 'worktree', 'prune');
  return result;
}

const gb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

function log(result: SweepResult) {
  for (const r of result.removed) console.log(`[worktrees] removed ${r.threadId} (${r.reason}, ${gb(r.bytes ?? 0)}) from ${r.repo}`);
  for (const s of result.skipped) console.log(`[worktrees] kept ${s.threadId}: ${s.reason}`);
  if (result.removed.length) console.log(`[worktrees] freed ${gb(result.freedBytes)} from ${result.removed.length} worktree(s)`);
}

/**
 * Ben archived the thread: its worktree goes now when it is safe to. A thread whose process is still warm gets one
 * more try once the keep-alive has closed it, rather than waiting for the daily pass.
 */
export function sweepArchived(threadId: string) {
  if (!config.worktreeSweep) return;
  sweepWorktrees({ only: threadId })
    .then((result) => {
      log(result);
      if (!result.skipped.some((s) => s.reason === 'its process is still open')) return;
      setTimeout(() => {
        if (threads.get(threadId)?.archived) sweepWorktrees({ only: threadId }).then(log, () => {});
      }, config.keepAliveSeconds * 1000 + 60_000).unref();
    })
    .catch((err) => console.error(`[worktrees] ${threadId}:`, (err as Error).message));
}

/** The daily pass: a minute after startup, then every 24 hours. */
export function startWorktreeSweep() {
  if (!config.worktreeSweep) return;
  const pass = () =>
    sweepWorktrees()
      .then(log)
      .catch((err) => console.error('[worktrees] sweep failed:', (err as Error).message));
  setTimeout(pass, 60_000).unref();
  setInterval(pass, DAY).unref();
}
