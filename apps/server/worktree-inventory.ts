// Read-only inventory of data/worktrees: which folders Omni made, what each costs on disk, and why each one must stay
// or may go. Nothing here deletes anything. The scan runs in the background, a couple of folders at a time, and can be
// cancelled. `inspectWorktree` and `lastLook` are the checks the cleanup (worktree-cleanup.ts) runs right before it
// removes a folder, on top of the git checks in worktree-sweep.ts: busy threads, uncommitted, untracked and unpushed work.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { EligibleBecause, KeepReason, WorktreeItem, WorktreeScan } from '@omni/shared/worktree-inventory.ts';
import { config, paths } from './config.ts';
import { channels, db, messageRequests, THREAD_COLUMNS, threads, type Channel, type Thread } from './db.ts';
import { branchPRs } from './github.ts';
import { lives, waitingMsgs } from './runner/state.ts';
import { getTerminal } from './terminal.ts';
import { busy, candidate, currentSignal, git, localWork, owningRepo, real, withSignal } from './worktree-sweep.ts';

const run = promisify(execFile);

/** Folders inspected at once. Each runs a few git commands and a `du`, so two keep the scan out of the way of running threads. */
const CONCURRENCY = 2;

/** Ignored files that a build or install makes again. Anything else ignored (.env, local config) is kept as a reason. */
const REGENERABLE = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', '.vite',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.venv', '.build', 'DerivedData', '.gradle', 'target', '.DS_Store',
]);

const NAMES_SHOWN = 5;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** One line of what a failed command said (its stderr, not the command line), for an item's errors. */
export const text = (err: unknown) => {
  const stderr = (err as { stderr?: unknown })?.stderr;
  const said = typeof stderr === 'string' && stderr.trim() ? stderr : err instanceof Error ? err.message : String(err);
  return said.trim().split('\n')[0].slice(0, 200);
};

export interface InspectOptions {
  /** Fetch origin first, so "pushed" and "merged" are judged against its latest. A scan does not (that writes refs); the removal does. */
  fetch?: boolean;
  /** Runs after the checks and before the thread is read again. Tests change ownership here. */
  between?: (id: string) => void | Promise<void>;
  /** Measure the folder with `du`. A cleanup's check right before removal skips it: the scan measured it. */
  size?: boolean;
  now?: number;
}

/** What the scan knows once, so each folder's check does not repeat it. */
interface Known {
  /** Real paths of the repos channels use. */
  repos: Set<string>;
  /** Thread ids per working directory (real path), to find folders two threads share. */
  byCwd: Map<string, string[]>;
}

function known(): Known {
  const repos = new Set<string>();
  for (const c of channels.list(true)) if (c.repo_path && existsSync(c.repo_path)) repos.add(real(c.repo_path));
  const byCwd = new Map<string, string[]>();
  for (const t of db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE cwd != ''`).all() as unknown as Thread[]) {
    const k = real(t.cwd);
    byCwd.set(k, [...(byCwd.get(k) ?? []), t.id]);
  }
  return { repos, byCwd };
}

/** What makes a thread's ownership of its folder: if any of it changes during a check, the verdict cannot be trusted. */
export const ownership = (id: string) => {
  const t = threads.get(id);
  return t ? JSON.stringify([t.channel_id, t.archived, t.status, t.setup, t.cwd, t.branch]) : 'gone';
};

const sizeOf = (dir: string) =>
  // Lowest priority: a `du` over node_modules must not slow a running thread.
  run('nice', ['-n', '19', 'du', '-sk', dir], { timeout: 180_000, signal: currentSignal() }).then((r) => Number(r.stdout.split('\t')[0]) * 1024);

/** Messages and turns this thread still has to run: held for after the turn, waiting for a slot, parked after a restart or scheduled. */
function pendingWork(t: Thread): number {
  const queued = (lives.get(t.id)?.held.length ?? 0) + (waitingMsgs.get(t.id)?.length ?? 0);
  return queued + messageRequests.parked(t.id).length + messageRequests.unstarted(t.id).length + (t.limit_state === 'scheduled' ? 1 : 0);
}

/** Top-level ignored files that are not build output, as they are named in the checkout. */
async function ignoredFiles(dir: string): Promise<string[] | null> {
  const out = await git(dir, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory');
  if (out === null) return null;
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !REGENERABLE.has(basename(p.replace(/\/$/, ''))));
}

function blank(id: string, dir: string, over: Partial<WorktreeItem>): WorktreeItem {
  return {
    id, kind: 'orphan', verdict: 'kept', dir, repo: null, branch: null, threadId: null, threadTitle: null, lastActiveAt: null, channelId: null, channelName: null,
    folder: true, registered: false, bytes: null, sharedWith: [], reasons: [], eligibleBecause: null, errors: [], ...over,
  };
}

/**
 * One folder of data/worktrees, checked. Never throws: what could not be checked is in `errors`. A checkout is
 * managed only when a thread (or its folder's branch name, when the thread row is gone) ties it to a repo that a
 * channel uses; any other folder is an orphan, listed and left alone.
 */
export async function inspectWorktree(id: string, opts: InspectOptions = {}, ctx: Known = known()): Promise<WorktreeItem> {
  const dir = join(paths.worktrees, id);
  try {
    return await inspect(id, dir, opts, ctx);
  } catch (err) {
    return blank(id, dir, { verdict: 'unknown', errors: [`inspection failed: ${text(err)}`] });
  }
}

async function inspect(id: string, dir: string, opts: InspectOptions, ctx: Known): Promise<WorktreeItem> {
  const reasons: KeepReason[] = [];
  const errors: string[] = [];
  const keep = (code: KeepReason['code'], message: string) => reasons.push({ code, message });

  const lst = lstatSync(dir, { throwIfNoEntry: false });
  if (!lst) return blank(id, dir, { verdict: 'unknown', folder: false, errors: ['the folder disappeared'] });
  // Never followed: a link in here could point at any repository.
  if (lst.isSymbolicLink() || !lst.isDirectory()) {
    return blank(id, dir, { reasons: [{ code: 'unowned', message: lst.isSymbolicLink() ? 'It is a symlink, which Omni never follows.' : 'It is not a folder.' }], bytes: 0 });
  }

  const before = ownership(id);
  const t = threads.get(id) ?? null;
  const channel: Channel | null = t ? (channels.get(t.channel_id) ?? null) : null;
  const sizing =
    opts.size === false
      ? Promise.resolve(null)
      : sizeOf(dir).then(
          (b) => b,
          (err) => (errors.push(`size unavailable: ${text(err)}`), null),
        );
  const done = async (over: Partial<WorktreeItem>) =>
    blank(id, dir, {
      bytes: await sizing, errors, reasons, threadId: t?.id ?? null, threadTitle: t?.title ?? null, lastActiveAt: t?.updated_at ?? null,
      channelId: channel?.id ?? null, channelName: channel?.name ?? null, ...over,
    });

  if (id.startsWith('.removing-')) {
    keep('unowned', 'A cleanup was cut short while removing this folder, after checking it held nothing unsaved. Look in it, then delete it by hand.');
    return done({ registered: !!(await owningRepo(dir)) });
  }
  const repo = await owningRepo(dir);
  if (!repo) {
    keep('unregistered', 'No repository lists it as a worktree, so Omni cannot tell what is in it. Look before deleting by hand.');
    return done({});
  }
  const branch = (await git(dir, 'branch', '--show-current')) || null;
  const planned = `omni/${id.slice(0, 8)}`;
  const channelRepo = channel?.repo_path ? real(channel.repo_path) : null;
  const owned = t ? channelRepo === real(repo) : ctx.repos.has(real(repo)) && branch === planned;
  if (!owned) {
    keep('unowned', t ? "Its thread's channel uses a different repository than the one this folder belongs to." : `No thread owns it, and it is not on ${planned} in a channel's repo.`);
    return done({ repo, branch, registered: true });
  }

  // Everything below reads git and the runner. A failure here is an error, never a reason to keep or to remove.
  const sharers = (ctx.byCwd.get(real(dir)) ?? []).filter((other) => other !== id);
  const liveSharers = sharers.filter((o) => {
    const ot = threads.get(o);
    return ot && (!ot.archived || busy(ot));
  });
  if (liveSharers.length) keep('shared', liveSharers.length === 1 ? '1 other thread also works in this folder.' : `${liveSharers.length} other threads also work in this folder.`);

  const owners = [t, ...liveSharers.map((o) => threads.get(o) ?? null)].filter((o): o is Thread => !!o);
  for (const o of owners) {
    const why = busy(o);
    if (why && o.status === 'running') keep('running', `${o.id === id ? 'Its thread is' : `Thread ${o.id.slice(0, 8)} is`} running.`);
    else if (why && o.setup === 'preparing') keep('preparing', 'Its worktree is being made.');
    else if (why) keep('warm', `${o.id === id ? 'Its' : `Thread ${o.id.slice(0, 8)}'s`} process is still open.`);
    if (o.status === 'queued') keep('queued', `${o.id === id ? 'Its thread is' : `Thread ${o.id.slice(0, 8)} is`} queued.`);
    const pending = pendingWork(o);
    if (pending) keep('queued', `${plural(pending, 'message or turn')} for ${o.id === id ? 'its thread' : `thread ${o.id.slice(0, 8)}`} ${pending === 1 ? 'waits' : 'wait'} to run.`);
    if (getTerminal(o.id)?.running) keep('terminal', `A terminal is open in it${o.id === id ? '' : ` (thread ${o.id.slice(0, 8)})`}.`);
  }

  if (t?.branch && branch !== t.branch) keep('branch-mismatch', `It is on ${branch ? `branch ${branch}` : 'a detached HEAD'}, not the thread's ${t.branch}.`);

  let safety = 0;
  let because: EligibleBecause | null = null;
  let prHead: string | undefined;
  if (opts.fetch) await git(repo, 'fetch', '--quiet', 'origin');
  const why = t ? await candidate(t, repo, dir, opts.now ?? Date.now()) : { reason: 'deleted' as const };
  if (why) {
    because = why.reason;
    prHead = 'prHead' in why ? why.prHead : undefined;
  } else {
    const days = t ? Math.floor(((opts.now ?? Date.now()) - Date.parse(t.updated_at)) / 86_400_000) : 0;
    keep('open-thread', `Its thread is open (last active ${days < 1 ? 'today' : `${plural(days, 'day')} ago`}), and it is not a merged branch idle for ${config.worktreeIdleDays} days.`);
  }

  const w = await localWork(dir, prHead);
  if (w.statusFailed) (errors.push('git status failed'), safety++);
  if (w.pushUnknown) (errors.push('could not tell which commits are pushed'), safety++);
  if (w.noCommits) keep('unpushed', 'It has no commits.');
  if (w.changed) keep('changed', `${plural(w.changed, 'file')} with uncommitted changes.`);
  if (w.untracked) keep('untracked', `${plural(w.untracked, 'untracked file')}.`);
  if (w.unpushed > 0) keep('unpushed', `${plural(w.unpushed, 'commit')} no remote has.`);
  const ignored = await ignoredFiles(dir);
  if (ignored === null) (errors.push('could not list ignored files'), safety++);
  else if (ignored.length) {
    const shown = ignored.slice(0, NAMES_SHOWN).join(', ');
    keep('ignored', `Ignored files that are not build output: ${shown}${ignored.length > NAMES_SHOWN ? `, and ${ignored.length - NAMES_SHOWN} more` : ''}.`);
  }

  if (channel?.github_repo && t?.branch) {
    try {
      const { prs } = await branchPRs(channel.github_repo, t.branch);
      const open = prs.find((p: { state?: string }) => p.state === 'OPEN');
      if (open) keep('pr-open', `Pull request #${open.number} is ${open.isDraft ? 'an open draft' : 'open'}.`);
    } catch (err) {
      errors.push(`could not read pull requests: ${text(err)}`);
      safety++;
    }
  }

  await opts.between?.(id);
  // Ben may have archived, deleted or messaged the thread while the checks ran.
  const again = threads.get(id);
  if (ownership(id) !== before) {
    errors.push('the thread changed while it was being checked, so scan again before acting on this');
    safety++;
  } else if (again && busy(again) && !reasons.some((r) => ['running', 'warm', 'preparing'].includes(r.code))) {
    keep('warm', 'Its thread started running while it was checked.');
  }
  if (!existsSync(dir)) {
    errors.push('the folder disappeared while it was being checked');
    safety++;
  }

  const verdict = reasons.length ? 'kept' : safety ? 'unknown' : 'eligible';
  return done({
    kind: 'managed',
    verdict,
    repo,
    branch,
    registered: true,
    sharedWith: sharers,
    eligibleBecause: verdict === 'eligible' ? because : null,
  });
}

/**
 * The last look before a cleanup removes dir, synchronous so that nothing can start between it and the removal: the
 * thread is as it was when the checks began (`before`, from ownership), and neither it nor another thread working
 * in the folder is busy, has messages waiting or has a terminal open. The reason to keep it, or null.
 */
export function lastLook(id: string, dir: string, before: string): KeepReason | null {
  if (ownership(id) !== before) return { code: 'changed-meanwhile', message: 'Its thread changed while it was checked.' };
  for (const uid of new Set([id, ...(known().byCwd.get(real(dir)) ?? [])])) {
    const t = threads.get(uid);
    if (!t) continue;
    const whose = uid === id ? 'its thread' : `thread ${uid.slice(0, 8)}`;
    if (uid !== id && !t.archived) return { code: 'shared', message: 'Another thread works in this folder.' };
    if (busy(t)) return { code: 'running', message: `A turn started in ${whose} while it was checked.` };
    if (pendingWork(t)) return { code: 'queued', message: `A message for ${whose} came in while it was checked.` };
    if (getTerminal(uid)?.running) return { code: 'terminal', message: 'A terminal was opened in it while it was checked.' };
  }
  return null;
}

/** Git's registrations under data/worktrees whose folder is gone, in the repos channels use. */
async function staleRegistrations(repos: Set<string>): Promise<WorktreeItem[]> {
  const root = real(paths.worktrees);
  const out: WorktreeItem[] = [];
  for (const repo of repos) {
    const list = await git(repo, 'worktree', 'list', '--porcelain');
    for (const line of (list ?? '').split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      const dir = line.slice(9);
      if (real(dirname(dir)) !== root || existsSync(dir)) continue;
      const id = basename(dir);
      const t = threads.get(id) ?? null;
      const ch = t ? channels.get(t.channel_id) : null;
      out.push(
        blank(id, dir, {
          kind: 'stale-registration', verdict: 'eligible', eligibleBecause: 'stale', repo, branch: t?.branch ?? null, threadId: t?.id ?? null,
          threadTitle: t?.title ?? null, lastActiveAt: t?.updated_at ?? null, channelId: ch?.id ?? null, channelName: ch?.name ?? null, folder: false, registered: true, bytes: 0,
        }),
      );
    }
  }
  return out;
}

// ---------- the background scan ----------

let current: WorktreeScan | null = null;
let abort: AbortController | null = null;
/** Settles when the running scan does. */
let settled: Promise<void> = Promise.resolve();

/** The running scan, or the last one finished, with a copy of its items. Null before the first. */
export const currentWorktreeScan = (): WorktreeScan | null => (current ? { ...current, items: [...current.items] } : null);

/**
 * Start a scan unless one is running, and return it. It lists data/worktrees, then inspects the folders two at a
 * time, adding each to `items` as it finishes so a client can show progress.
 */
export function startWorktreeScan(opts: InspectOptions = {}): WorktreeScan {
  if (current?.state === 'running') return currentWorktreeScan()!;
  const ctl = new AbortController();
  const scan: WorktreeScan = { id: randomUUID(), state: 'running', phase: 'listing', startedAt: new Date().toISOString(), finishedAt: null, total: 0, done: 0, items: [], error: null };
  current = scan;
  abort = ctl;
  settled = withSignal(ctl.signal, () => scanAll(scan, ctl.signal, opts)).catch((err) => {
    if (scan.state === 'running') Object.assign(scan, { state: 'failed', error: text(err) });
  }).finally(() => {
    if (scan.state === 'running') scan.state = 'done';
    scan.phase = 'finished';
    scan.finishedAt ??= new Date().toISOString();
    if (abort === ctl) abort = null;
  });
  return currentWorktreeScan()!;
}

/** A scan to its end: the running one, or a new one. Its state says whether it finished, was cancelled or failed. */
export async function scanToEnd(opts: InspectOptions = {}): Promise<WorktreeScan> {
  startWorktreeScan(opts);
  await settled;
  return currentWorktreeScan()!;
}

/** A cleanup checked one of the last scan's folders again: the fresh item replaces it, or null drops a removed one. */
export function updateScanItem(id: string, item: WorktreeItem | null) {
  if (!current || current.state === 'running') return;
  const i = current.items.findIndex((it) => it.kind !== 'stale-registration' && it.id === id);
  if (i < 0) return;
  if (item) current.items[i] = { ...item, bytes: item.bytes ?? current.items[i].bytes };
  else current.items.splice(i, 1);
}

/** Stop the running scan: no more folders start, and the git and du calls in flight are killed. Returns whether one was running. */
export function cancelWorktreeScan(): boolean {
  if (!abort || current?.state !== 'running') return false;
  current.state = 'cancelled';
  current.phase = 'finished';
  current.finishedAt = new Date().toISOString();
  abort.abort();
  return true;
}

async function scanAll(scan: WorktreeScan, signal: AbortSignal, opts: InspectOptions) {
  const ctx = known();
  // Hidden folders are left out, except what a cleanup cut short left behind (worktree-cleanup.ts).
  const ids = existsSync(paths.worktrees) ? readdirSync(paths.worktrees).filter((n) => !n.startsWith('.') || n.startsWith('.removing-')) : [];
  const stale = await staleRegistrations(ctx.repos);
  if (signal.aborted) return;
  scan.total = ids.length + stale.length;
  scan.phase = 'inspecting';
  scan.items.push(...stale);
  scan.done += stale.length;

  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < ids.length) {
      const id = ids[next++];
      const item = await inspectWorktree(id, opts, ctx);
      // A cancelled scan drops what was in flight: its checks were cut short.
      if (signal.aborted) return;
      scan.items.push(item);
      scan.done++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (signal.aborted) return;
  scan.items.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || a.id.localeCompare(b.id));
}
