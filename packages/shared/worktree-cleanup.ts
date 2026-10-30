// Worktree cleanup, as both clients show it under Settings > Machines: what a cleanup Ben starts or this Mac's
// retention policy would remove, and what a run removed, kept or failed to remove (apps/server/worktree-cleanup.ts).
// Pure: types, the shared labels and the filter that picks what a cleanup may remove from a scan.
import type { KeepReason, WorktreeItem } from './worktree-inventory.ts';

/**
 * This Mac's retention policy. Off by default, and never synced: each Mac decides for its own disk. When on, a
 * scheduled pass removes the worktrees of archived, merged or deleted threads idle for at least `idleDays`.
 */
export interface RetentionPolicy {
  enabled: boolean;
  idleDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { enabled: false, idleDays: 14 };
export const RETENTION_DAYS = { min: 1, max: 365 } as const;

/** manual: Ben pressed Remove after reviewing the list. retention: the scheduled pass of an enabled policy. */
export type CleanupTrigger = 'manual' | 'retention';

/** Why a cleanup may remove a worktree. A stale registration has no folder, so there is nothing to free. */
export type CleanupBecause = 'archived' | 'merged' | 'deleted';

/** A worktree a cleanup would remove, as its preview lists it. */
export interface CleanupCandidate {
  id: string;
  threadId: string | null;
  threadTitle: string | null;
  channelName: string | null;
  branch: string | null;
  bytes: number | null;
  because: CleanupBecause;
  /** When its thread last had a turn or message; null for a deleted thread. */
  lastActiveAt: string | null;
}

/**
 * removed: the folder is gone; its branch, transcript, uploads and artifacts stay.
 * kept: the check right before removal found a reason to keep it, or could not finish (`errors`).
 * failed: git refused to remove it or the removal broke off (`errors`).
 */
export type CleanupOutcome = 'removed' | 'kept' | 'failed';

export interface CleanupResult extends CleanupCandidate {
  outcome: CleanupOutcome;
  reasons: KeepReason[];
  errors: string[];
}

export interface CleanupRun {
  id: string;
  trigger: CleanupTrigger;
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  /** Worktrees this run checks, and how many it has finished. */
  total: number;
  done: number;
  /** In finishing order. */
  items: CleanupResult[];
  freedBytes: number;
  error: string | null;
}

/** What a cleanup would remove, from the last scan. Every one is checked again right before it goes. */
export interface CleanupPreview {
  trigger: CleanupTrigger;
  candidates: CleanupCandidate[];
  bytes: number;
}

/** What Settings > Machines shows of cleanup, beside the scan (GET /api/worktrees/scan). */
export interface CleanupState {
  policy: RetentionPolicy;
  /** What each kind of cleanup would remove now, from the last scan. Null before the first scan and while one runs. */
  preview: Record<CleanupTrigger, CleanupPreview> | null;
  /** The last run of each kind, or the one going. */
  runs: Record<CleanupTrigger, CleanupRun | null>;
}

const DAY = 24 * 3600 * 1000;

/**
 * The worktrees of a scan a cleanup may remove: managed folders the scan called eligible because their thread is
 * archived, merged and idle, or deleted. The retention pass also needs the thread idle for the policy's days.
 */
export function cleanupCandidates(items: WorktreeItem[], trigger: CleanupTrigger, policy: RetentionPolicy, now = Date.now()): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];
  for (const it of items) {
    if (it.kind !== 'managed' || it.verdict !== 'eligible' || !it.folder) continue;
    const because = it.eligibleBecause;
    if (because !== 'archived' && because !== 'merged' && because !== 'deleted') continue;
    if (trigger === 'retention' && it.lastActiveAt && now - Date.parse(it.lastActiveAt) < policy.idleDays * DAY) continue;
    out.push({
      id: it.id, threadId: it.threadId, threadTitle: it.threadTitle, channelName: it.channelName, branch: it.branch,
      bytes: it.bytes, because, lastActiveAt: it.lastActiveAt,
    });
  }
  return out;
}

export function cleanupPreview(items: WorktreeItem[], trigger: CleanupTrigger, policy: RetentionPolicy, now = Date.now()): CleanupPreview {
  const candidates = cleanupCandidates(items, trigger, policy, now);
  return { trigger, candidates, bytes: candidates.reduce((n, c) => n + (c.bytes ?? 0), 0) };
}

export const CLEANUP_BECAUSE_LABEL: Record<CleanupBecause, string> = {
  archived: 'Its thread is archived',
  merged: 'Its branch is merged and the thread is idle',
  deleted: 'Its thread was deleted',
};

/** Said wherever a cleanup is offered: what goes and what stays. */
export const CLEANUP_NOTE =
  'Only the checkout folder is removed. The branch, the transcript, uploads and artifacts stay, and the next turn in the thread checks the branch out again.';
