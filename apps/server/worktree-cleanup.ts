// Removes worktrees from data/worktrees: the ones Ben confirms after reviewing them in Settings > Machines and, when
// this Mac's retention policy is on, the ones a daily pass finds idle long enough. Each is checked again right before
// it goes, with its folder held (workspace.ts) the way a turn, a terminal or a checkout holds it, so whichever starts
// first wins. Removal is a `git worktree move` aside, then `git worktree remove` without --force: the branch stays, and
// its last commit is kept as refs/omni/removed/<thread>, so the next turn checks it out again. Nothing here syncs: the
// policy is in this Mac's omni.config.json and the runs live in memory.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { KeepReason } from '@omni/shared/worktree-inventory.ts';
import {
  cleanupCandidates,
  cleanupPreview,
  type CleanupCandidate,
  type CleanupOutcome,
  type CleanupResult,
  type CleanupRun,
  type CleanupState,
  type CleanupTrigger,
  type RetentionPolicy,
} from '@omni/shared/worktree-cleanup.ts';
import { config, paths } from './config.ts';
import { userConfig, writeUserConfig } from './user-config.ts';
import { currentWorktreeScan, inspectWorktree, lastLook, ownership, scanToEnd, text, updateScanItem, type InspectOptions } from './worktree-inventory.ts';
import { git, owningRepo } from './worktree-sweep.ts';
import { keptRef, trashOf, withWorkspace } from './workspace.ts';

const run = promisify(execFile);
const DAY = 24 * 3600 * 1000;

export const retentionPolicy = (): RetentionPolicy => userConfig().worktrees.retention;

/** Saved in this Mac's omni.config.json, which never syncs: the other Mac keeps its own. */
export function setRetentionPolicy(patch: Partial<RetentionPolicy>): RetentionPolicy {
  const cur = userConfig();
  return writeUserConfig({ ...cur, worktrees: { retention: { ...cur.worktrees.retention, ...patch } } }).worktrees.retention;
}

const runs: Record<CleanupTrigger, CleanupRun | null> = { manual: null, retention: null };
/** The run going, if any: one at a time, so two never remove the same folder. */
let going: Promise<CleanupRun> | null = null;

const copy = (r: CleanupRun | null): CleanupRun | null => (r ? { ...r, items: [...r.items] } : null);

export const cleanupRunning = () => going !== null;

export function cleanupState(now = Date.now()): CleanupState {
  const policy = retentionPolicy();
  const scan = currentWorktreeScan();
  return {
    policy,
    preview:
      scan && scan.state !== 'running'
        ? { manual: cleanupPreview(scan.items, 'manual', policy, now), retention: cleanupPreview(scan.items, 'retention', policy, now) }
        : null,
    runs: { manual: copy(runs.manual), retention: copy(runs.retention) },
  };
}

/** A refusal app.ts answers as a 409 with the message. */
const refused = (message: string) => Object.assign(new Error(message), { status: 409 });

/**
 * Remove the worktrees with these ids, which Ben reviewed: each must still be in the last scan's cleanup list, and
 * each is checked again right before it goes. Returns the run at once; it goes on in the background.
 */
export function startCleanup(ids: string[], opts: InspectOptions = {}): CleanupRun {
  if (going) throw refused('A cleanup is already running.');
  const scan = currentWorktreeScan();
  if (!scan || scan.state === 'running') throw refused('Scan first, then review what the cleanup removes.');
  const listed = new Map(cleanupCandidates(scan.items, 'manual', retentionPolicy(), opts.now).map((c) => [c.id, c]));
  const unlisted = ids.filter((id) => !listed.has(id));
  if (unlisted.length) throw refused(`${unlisted.length === 1 ? 'A worktree is' : 'Some worktrees are'} no longer in the cleanup list. Scan again and review it.`);
  void runCleanup('manual', [...new Set(ids)].map((id) => listed.get(id)!), opts);
  return copy(runs.manual)!;
}

/**
 * The scheduled pass: with the policy on, a scan to its end, then the removal of what the policy covers. Null when
 * the policy is off, a cleanup is already running, or the scan was cancelled or failed.
 */
export async function retentionPass(opts: InspectOptions = {}): Promise<CleanupRun | null> {
  if (!retentionPolicy().enabled || going) return null;
  const scan = await scanToEnd(opts);
  // Read again: Ben may have turned it off, or started a cleanup, while the scan ran.
  const policy = retentionPolicy();
  if (scan.state !== 'done' || !policy.enabled || going) return null;
  return runCleanup('retention', cleanupCandidates(scan.items, 'retention', policy, opts.now), opts);
}

/** A minute after startup, then daily. Each pass reads the policy, so turning it on or off needs no restart. */
export function startWorktreeRetention() {
  const pass = () => retentionPass().catch((err) => console.error('[worktrees] retention pass failed:', text(err)));
  setTimeout(pass, config.retentionFirstPassMs).unref();
  setInterval(pass, DAY).unref();
}

function runCleanup(trigger: CleanupTrigger, candidates: CleanupCandidate[], opts: InspectOptions): Promise<CleanupRun> {
  const r: CleanupRun = {
    id: randomUUID(), trigger, state: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    total: candidates.length, done: 0, items: [], freedBytes: 0, error: null,
  };
  runs[trigger] = r;
  const policy = retentionPolicy();
  going = (async () => {
    await finishLeftovers();
    const fetched = new Set<string>();
    for (const c of candidates) {
      const item = await removeOne(c, trigger, policy, fetched, opts);
      r.items.push(item);
      r.done++;
      if (item.outcome === 'removed') r.freedBytes += c.bytes ?? 0;
    }
    r.state = 'done';
  })()
    .catch((err) => Object.assign(r, { state: 'failed', error: text(err) }))
    .then(() => {
      r.finishedAt = new Date().toISOString();
      going = null;
      log(r);
      return r;
    });
  return going;
}

/** git in repo, given minutes (a removal deletes node_modules). What git said when it failed, or null. */
const gitRun = (repo: string, ...args: string[]) =>
  run('git', ['-C', repo, ...args], { timeout: 600_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).then(
    () => null,
    (err) => text(err),
  );

/**
 * What removals cut short left in data/worktrees (`.removing-<thread>`), removed now when git agrees: it does when the
 * cut came before anything was deleted. The scan lists any that stay.
 */
async function finishLeftovers() {
  const names = existsSync(paths.worktrees) ? readdirSync(paths.worktrees).filter((n) => n.startsWith('.removing-')) : [];
  for (const name of names) {
    const trash = join(paths.worktrees, name);
    const repo = await owningRepo(trash);
    if (!repo) continue;
    await withWorkspace(join(paths.worktrees, name.slice('.removing-'.length)), async () => {
      if ((await gitRun(repo, 'worktree', 'remove', trash)) === null) console.log(`[worktrees] finished removing ${trash}`);
    });
  }
}

/** One worktree: checked again with its folder held, then removed, kept with the reason found, or failed. Never throws. */
async function removeOne(c: CleanupCandidate, trigger: CleanupTrigger, policy: RetentionPolicy, fetched: Set<string>, opts: InspectOptions): Promise<CleanupResult> {
  const dir = join(paths.worktrees, c.id);
  const out = (outcome: CleanupOutcome, reasons: KeepReason[] = [], errors: string[] = []): CleanupResult => ({ ...c, outcome, reasons, errors });
  try {
    // origin's latest, once per repo and before the folder is held: "pushed" and "merged" are judged against it.
    const owner = await owningRepo(dir);
    if (owner && !fetched.has(owner)) {
      fetched.add(owner);
      await git(owner, 'fetch', '--quiet', 'origin');
    }
    return await withWorkspace(dir, async () => {
      const before = ownership(c.id);
      const item = await inspectWorktree(c.id, { ...opts, size: false });
      const [still] = cleanupCandidates([item], trigger, policy, opts.now);
      if (!still || !item.repo) {
        updateScanItem(c.id, item);
        if (item.verdict !== 'eligible') return out('kept', item.reasons, item.errors);
        const days = item.lastActiveAt ? Math.floor(((opts.now ?? Date.now()) - Date.parse(item.lastActiveAt)) / DAY) : 0;
        return out('kept', [{ code: 'retention', message: `Its thread was active ${days < 1 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}; this Mac keeps worktrees for ${policy.idleDays} days.` }]);
      }
      const keptBy = (reason: KeepReason) => {
        updateScanItem(c.id, { ...item, verdict: 'kept', reasons: [reason], eligibleBecause: null });
        return out('kept', [reason]);
      };
      if (still.because !== c.because || still.threadId !== c.threadId) {
        return keptBy({ code: 'changed-meanwhile', message: 'It changed since it was listed. Scan again and review it.' });
      }
      const head = await git(dir, 'rev-parse', 'HEAD');
      if (!head || (await git(item.repo, 'update-ref', keptRef(c.id), head)) === null) return out('kept', [], ['could not keep its last commit, so it was left in place']);
      // Nothing is awaited from here to the move, so whatever starts after this look waits for the folder.
      const late = lastLook(c.id, dir, before);
      if (late) return keptBy(late);
      const trash = trashOf(dir);
      const unmoved = await gitRun(item.repo, 'worktree', 'move', dir, trash);
      if (unmoved) return out('failed', [], [unmoved]);
      updateScanItem(c.id, null);
      const refusal = await gitRun(item.repo, 'worktree', 'remove', trash);
      if (refusal) return out('failed', [], [`It was moved to ${trash} to be removed, and git would not remove it there: ${refusal}`]);
      return out('removed');
    });
  } catch (err) {
    return out('failed', [], [text(err)]);
  }
}

const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

function log(r: CleanupRun) {
  for (const it of r.items) {
    if (it.outcome === 'removed') console.log(`[worktrees] removed ${it.id} (${it.because}, ${size(it.bytes ?? 0)})`);
    else console.log(`[worktrees] ${it.outcome} ${it.id}: ${[...it.reasons.map((x) => x.message), ...it.errors].join(' ')}`);
  }
  if (r.error) console.error(`[worktrees] ${r.trigger} cleanup failed: ${r.error}`);
  console.log(`[worktrees] ${r.trigger} cleanup: ${r.items.filter((i) => i.outcome === 'removed').length} of ${r.total} removed, ${size(r.freedBytes)} freed`);
}
