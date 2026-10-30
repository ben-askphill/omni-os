// The worktree storage inventory both clients show (Settings > Machines), as the server's scan reports it
// (apps/server/worktree-inventory.ts). Pure: types, the labels the clients share and the totals.

/** managed: a thread's worktree. orphan: a folder in data/worktrees no thread's repo owns. stale-registration: git lists a worktree whose folder is gone. */
export type WorktreeKind = 'managed' | 'orphan' | 'stale-registration';

/**
 * eligible: nothing in it can be lost and its thread is done with it, so it can be cleaned up.
 * kept: at least one reason to keep it, listed on the item.
 * unknown: no reason to keep it was found, but a check failed or the thread changed mid-scan, so nothing is claimed.
 */
export type WorktreeVerdict = 'eligible' | 'kept' | 'unknown';

/** Why a worktree is kept. `message` says it for a person, with the counts. */
export type KeepCode =
  | 'running'
  | 'queued'
  | 'warm'
  | 'preparing'
  | 'terminal'
  | 'action'
  | 'shared'
  | 'changed'
  | 'untracked'
  | 'ignored'
  | 'unpushed'
  | 'pr-open'
  | 'branch-mismatch'
  | 'open-thread'
  | 'unowned'
  | 'unregistered'
  // Set by a cleanup's check right before removal (worktree-cleanup.ts), never by a scan.
  | 'retention'
  | 'changed-meanwhile';

export interface KeepReason {
  code: KeepCode;
  message: string;
}

/** Why an eligible worktree can go: its thread is archived or deleted, its branch merged and idle, or git lists a folder that is gone. */
export type EligibleBecause = 'archived' | 'deleted' | 'merged' | 'stale';

export interface WorktreeItem {
  /** The folder's name in data/worktrees, which is the owning thread's id. */
  id: string;
  kind: WorktreeKind;
  verdict: WorktreeVerdict;
  dir: string;
  /** The repo git lists it under, null for a folder no repo knows. */
  repo: string | null;
  branch: string | null;
  threadId: string | null;
  threadTitle: string | null;
  /** When its thread last had a turn or message. Null when no thread owns it. */
  lastActiveAt: string | null;
  channelId: string | null;
  channelName: string | null;
  /** Whether the folder is on disk. False only for a stale registration. */
  folder: boolean;
  /** Whether a repo lists it as a worktree. False for a leftover folder. */
  registered: boolean;
  /** Estimated disk use, null when it could not be measured. */
  bytes: number | null;
  /** Other threads that work in this folder. */
  sharedWith: string[];
  /** Why it stays. Empty for eligible and unknown. */
  reasons: KeepReason[];
  eligibleBecause: EligibleBecause | null;
  /** What could not be checked. A size error alone does not make a verdict unknown. */
  errors: string[];
}

export type ScanState = 'running' | 'done' | 'cancelled' | 'failed';

export interface WorktreeScan {
  id: string;
  state: ScanState;
  /** listing: finding the folders. inspecting: checking each. */
  phase: 'listing' | 'inspecting' | 'finished';
  startedAt: string;
  finishedAt: string | null;
  /** Items to check once listing is done (0 until then) and how many are checked. */
  total: number;
  done: number;
  /** Largest first once finished; in finishing order while running. */
  items: WorktreeItem[];
  error: string | null;
}

export interface VerdictTotals {
  count: number;
  bytes: number;
}

export interface InventorySummary {
  eligible: VerdictTotals;
  kept: VerdictTotals;
  unknown: VerdictTotals;
  /** Folders on disk, of any verdict. */
  folders: number;
  /** Stale registrations: git entries with no folder. Pruning them frees no space. */
  stale: number;
  /** Disk the folders use, all verdicts. */
  bytes: number;
}

export function summarize(items: WorktreeItem[]): InventorySummary {
  const empty = (): VerdictTotals => ({ count: 0, bytes: 0 });
  const s: InventorySummary = { eligible: empty(), kept: empty(), unknown: empty(), folders: 0, stale: 0, bytes: 0 };
  for (const it of items) {
    if (it.kind === 'stale-registration') {
      s.stale++;
      continue;
    }
    const t = s[it.verdict];
    t.count++;
    t.bytes += it.bytes ?? 0;
    s.folders++;
    s.bytes += it.bytes ?? 0;
  }
  return s;
}

export const KIND_LABEL: Record<WorktreeKind, string> = {
  managed: 'Thread worktree',
  orphan: 'Leftover folder',
  'stale-registration': 'Stale registration',
};

export const ELIGIBLE_LABEL: Record<EligibleBecause, string> = {
  archived: 'Its thread is archived',
  deleted: 'Its thread was deleted',
  merged: 'Its branch is merged and the thread is idle',
  stale: 'Git lists it but the folder is gone',
};

/** Said wherever the inventory is shown: pruning is not cleanup. */
export const PRUNE_NOTE =
  'Pruning stale registrations only drops git\'s record of a folder that is already gone. It never removes a folder that still exists, so it frees no space.';

/** Bytes as "1.2 GB", "340 MB", "12 KB". */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'unknown size';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}
