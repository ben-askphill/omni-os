// Strips caches from idle worktrees: deletes the build output and installs in them (what the inventory calls build
// output: node_modules, .build, dist and the like, all ignored by git) and keeps the worktree, its branch and every
// other file. For the worktrees Ben confirms after reviewing them in Settings > Worktrees and, when this Mac's policy
// is on, the ones a daily pass finds idle long enough. Each is checked again right before, with its folder held
// (workspace.ts) the way a turn, a terminal or a cleanup holds it, so a turn that starts meanwhile waits for it.
// Nothing here syncs: the policy is in this Mac's omni.config.json and the runs live in memory.
import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { IN_USE, slimCandidates, slimPreview, type SlimCandidate, type SlimPolicy, type SlimResult, type SlimRun, type SlimState, type SlimTrigger } from '@omni/shared/worktree-slim.ts';
import { paths } from './config.ts';
import { userConfig, writeUserConfig } from './user-config.ts';
import { cachesIn, currentWorktreeScan, inspectWorktree, lastLook, ownership, scanToEnd, text, updateScanItem, type InspectOptions } from './worktree-inventory.ts';
import { withWorkspace } from './workspace.ts';

export const slimPolicy = (): SlimPolicy => userConfig().worktrees.slim;

/** Saved in this Mac's omni.config.json, which never syncs. */
export function setSlimPolicy(patch: Partial<SlimPolicy>): SlimPolicy {
  const cur = userConfig();
  return writeUserConfig({ ...cur, worktrees: { ...cur.worktrees, slim: { ...cur.worktrees.slim, ...patch } } }).worktrees.slim;
}

const runs: Record<SlimTrigger, SlimRun | null> = { manual: null, scheduled: null };
/** The pass going, if any: one at a time. */
let going: Promise<SlimRun> | null = null;

const copy = (r: SlimRun | null): SlimRun | null => (r ? { ...r, items: [...r.items] } : null);

export const slimRunning = () => going !== null;

export function slimState(now = Date.now()): SlimState {
  const policy = slimPolicy();
  const scan = currentWorktreeScan();
  return {
    policy,
    preview: scan && scan.state !== 'running' ? slimPreview(scan.items, policy.idleDays, now) : null,
    runs: { manual: copy(runs.manual), scheduled: copy(runs.scheduled) },
  };
}

const refused = (message: string) => Object.assign(new Error(message), { status: 409 });

/**
 * Strip the worktrees with these ids, which Ben reviewed: each must still be in the last scan's list, and each is
 * checked again right before. Returns the run at once; it goes on in the background.
 */
export function startSlim(ids: string[], opts: InspectOptions = {}): SlimRun {
  if (going) throw refused('Caches are already being stripped.');
  const scan = currentWorktreeScan();
  if (!scan || scan.state === 'running') throw refused('Scan first, then review what stripping caches deletes.');
  const listed = new Map(slimCandidates(scan.items, slimPolicy().idleDays, opts.now).map((c) => [c.id, c]));
  const unlisted = ids.filter((id) => !listed.has(id));
  if (unlisted.length) throw refused(`${unlisted.length === 1 ? 'A worktree is' : 'Some worktrees are'} no longer in the list. Scan again and review it.`);
  void runSlim('manual', [...new Set(ids)].map((id) => listed.get(id)!), opts);
  return copy(runs.manual)!;
}

/** The scheduled pass: with the policy on, a scan to its end, then the stripping of what the policy covers. */
export async function slimPass(opts: InspectOptions = {}): Promise<SlimRun | null> {
  if (!slimPolicy().enabled || going) return null;
  const scan = await scanToEnd(opts);
  const policy = slimPolicy();
  if (scan.state !== 'done' || !policy.enabled || going) return null;
  return runSlim('scheduled', slimCandidates(scan.items, policy.idleDays, opts.now), opts);
}

function runSlim(trigger: SlimTrigger, candidates: SlimCandidate[], opts: InspectOptions): Promise<SlimRun> {
  const r: SlimRun = { id: randomUUID(), trigger, state: 'running', startedAt: new Date().toISOString(), finishedAt: null, total: candidates.length, done: 0, items: [], freedBytes: 0, error: null };
  runs[trigger] = r;
  const { idleDays } = slimPolicy();
  going = (async () => {
    for (const c of candidates) {
      const item = await slimOne(c, idleDays, opts);
      r.items.push(item);
      r.done++;
      if (item.outcome === 'slimmed') r.freedBytes += item.bytes ?? 0;
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

/** Whether rel, a path git listed from the top of dir, is a real folder or file inside it (never a link out of it). */
function inside(dir: string, rel: string): boolean {
  const abs = join(dir, rel);
  const back = relative(dir, abs);
  if (!back || back.startsWith('..')) return false;
  return !!lstatSync(abs, { throwIfNoEntry: false });
}

/** One worktree: checked again with its folder held, then its caches deleted, or skipped with the reason found. Never throws. */
async function slimOne(c: SlimCandidate, idleDays: number, opts: InspectOptions): Promise<SlimResult> {
  const dir = join(paths.worktrees, c.id);
  const out = (outcome: SlimResult['outcome'], reasons: SlimResult['reasons'] = [], errors: string[] = [], bytes = c.bytes): SlimResult => ({ ...c, bytes, outcome, reasons, errors });
  try {
    return await withWorkspace(dir, async () => {
      const before = ownership(c.id);
      const item = await inspectWorktree(c.id, opts);
      // Still idle, still unused: a turn since the scan makes it active again.
      const [still] = slimCandidates([item], idleDays, opts.now);
      if (!still) {
        updateScanItem(c.id, item);
        const busy = item.reasons.filter((x) => IN_USE.has(x.code));
        return out('skipped', busy, item.errors.length ? item.errors : busy.length ? [] : ['It changed since it was listed. Scan again and review it.']);
      }
      const caches = await cachesIn(dir);
      if (!caches) return out('skipped', [], ['could not list its ignored files']);
      // Nothing is awaited from here to the first delete, so whatever starts after this look waits for the folder.
      const late = lastLook(c.id, dir, before);
      if (late) return out('skipped', [late]);
      const errors: string[] = [];
      for (const rel of caches.filter((p) => inside(dir, p))) {
        await rm(join(dir, rel), { recursive: true, force: true, maxRetries: 2 }).catch((err) => errors.push(`${rel}: ${text(err)}`));
      }
      const freed = item.cacheBytes ?? 0;
      updateScanItem(c.id, { ...item, bytes: item.bytes === null ? null : Math.max(0, item.bytes - freed), cacheBytes: errors.length ? null : 0 });
      return errors.length ? out('failed', [], errors, freed) : out('slimmed', [], [], freed);
    });
  } catch (err) {
    return out('failed', [], [text(err)]);
  }
}

const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

function log(r: SlimRun) {
  for (const it of r.items) {
    if (it.outcome === 'slimmed') console.log(`[worktrees] stripped caches from ${it.id} (${size(it.bytes ?? 0)})`);
    else console.log(`[worktrees] ${it.outcome} stripping ${it.id}: ${[...it.reasons.map((x) => x.message), ...it.errors].join(' ')}`);
  }
  if (r.error) console.error(`[worktrees] ${r.trigger} cache strip failed: ${r.error}`);
  console.log(`[worktrees] ${r.trigger} cache strip: ${r.items.filter((i) => i.outcome === 'slimmed').length} of ${r.total} stripped, ${size(r.freedBytes)} freed`);
}
