// Stripping caches from idle worktrees, as Settings > Worktrees shows it (apps/server/worktree-slim.ts): the build
// output and installs in a worktree (node_modules, .build, dist and the like) are deleted, and the worktree, its
// branch and all its work stay. Pure: types, the shared labels and the filter that picks what a pass may strip.
import type { KeepCode, KeepReason, WorktreeItem } from './worktree-inventory.ts';

/** This Mac's schedule for stripping caches. Off by default, and never synced, like worktree retention. */
export interface SlimPolicy {
  enabled: boolean;
  idleDays: number;
}

export const DEFAULT_SLIM: SlimPolicy = { enabled: false, idleDays: 7 };
export const SLIM_DAYS = { min: 1, max: 365 } as const;

/** manual: Ben pressed Strip after reviewing the list. scheduled: the daily pass of an enabled policy. */
export type SlimTrigger = 'manual' | 'scheduled';

/** A worktree a pass would strip, as its preview lists it. */
export interface SlimCandidate {
  id: string;
  threadId: string | null;
  threadTitle: string | null;
  channelName: string | null;
  branch: string | null;
  /** The caches' size at the scan. */
  bytes: number | null;
  /** When its thread last had a turn or message; null for a deleted thread. */
  lastActiveAt: string | null;
}

/** slimmed: its caches are gone and the folder stays. skipped: the check right before found it in use. failed: a delete broke off. */
export type SlimOutcome = 'slimmed' | 'skipped' | 'failed';

export interface SlimResult extends SlimCandidate {
  outcome: SlimOutcome;
  reasons: KeepReason[];
  errors: string[];
}

export interface SlimRun {
  id: string;
  trigger: SlimTrigger;
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  /** In finishing order. */
  items: SlimResult[];
  freedBytes: number;
  error: string | null;
}

export interface SlimPreview {
  candidates: SlimCandidate[];
  bytes: number;
}

/** What Settings > Worktrees shows of stripping caches, beside the scan (GET /api/worktrees/scan). */
export interface SlimState {
  policy: SlimPolicy;
  /** What a pass would strip now, from the last scan, for the policy's idle days. Null before the first scan and while one runs. */
  preview: SlimPreview | null;
  runs: Record<SlimTrigger, SlimRun | null>;
}

/** Something is using the folder now: a pass leaves it alone. Every other reason to keep a worktree is work, which stripping never touches. */
export const IN_USE: ReadonlySet<KeepCode> = new Set(['running', 'queued', 'warm', 'preparing', 'terminal', 'action', 'shared']);

const DAY = 24 * 3600 * 1000;

/**
 * The worktrees of a scan a pass may strip: thread worktrees on disk with caches in them, nothing using them, and a
 * thread idle at least `idleDays` (or deleted). Open threads count: stripping keeps the folder and its work.
 */
export function slimCandidates(items: WorktreeItem[], idleDays: number, now = Date.now()): SlimCandidate[] {
  const out: SlimCandidate[] = [];
  for (const it of items) {
    if (it.kind !== 'managed' || it.verdict === 'unknown' || !it.folder || !it.cacheBytes) continue;
    if (it.reasons.some((r) => IN_USE.has(r.code))) continue;
    if (it.lastActiveAt && now - Date.parse(it.lastActiveAt) < idleDays * DAY) continue;
    out.push({ id: it.id, threadId: it.threadId, threadTitle: it.threadTitle, channelName: it.channelName, branch: it.branch, bytes: it.cacheBytes, lastActiveAt: it.lastActiveAt });
  }
  return out;
}

export function slimPreview(items: WorktreeItem[], idleDays: number, now = Date.now()): SlimPreview {
  const candidates = slimCandidates(items, idleDays, now);
  return { candidates, bytes: candidates.reduce((n, c) => n + (c.bytes ?? 0), 0) };
}

/** Said wherever stripping is offered: what goes and what stays. */
export const SLIM_NOTE =
  'Deletes only build output and installs Git ignores (node_modules, .build, dist and the like). The worktree, its branch, its changes and every other file stay. The next build or npm ci makes them again.';
