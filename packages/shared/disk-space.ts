// Free disk space, as the server checks it (apps/server/disk-space.ts) and the clients warn about it: the disk with
// Omni's data (worktrees, the database) and the temp folder the agent CLIs write their command output to. When either
// fills, every shell command in every thread fails (ENOSPC on a Mac, EDQUOT under a Linux /tmp quota) and even the
// rm that would free space cannot run, so the warning comes well before. Pure: types, thresholds and the words.

export type DiskLevel = 'ok' | 'low' | 'critical';

export interface DiskVolume {
  /** data: the disk Omni's data folder is on. tmp: the temp folder, shown only when it is on another disk or has a quota. */
  kind: 'data' | 'tmp';
  path: string;
  freeBytes: number;
  totalBytes: number;
  /** Linux /tmp with a per-user quota: free and total are this user's share, estimated from what the user's files use. */
  quota: boolean;
  level: DiskLevel;
}

export interface DiskView {
  /** The worst level of the volumes. */
  level: DiskLevel;
  volumes: DiskVolume[];
  /** When the server last checked; null before the first check. */
  checkedAt: string | null;
  /** What made the last check fail, if it did. */
  error: string | null;
}

const GB = 1024 ** 3;

/**
 * Low below 20 GB free, critical below 5 GB, each capped at a share of the disk (15% and 5%) so a small volume such
 * as a 26 GB /tmp quota warns at a few GB, not as soon as it is a quarter used.
 */
export const DISK_LOW = { bytes: 20 * GB, share: 0.15 } as const;
export const DISK_CRITICAL = { bytes: 5 * GB, share: 0.05 } as const;

export function diskLevel(freeBytes: number, totalBytes: number): DiskLevel {
  const under = (t: { bytes: number; share: number }) => freeBytes < Math.min(t.bytes, totalBytes * t.share);
  return under(DISK_CRITICAL) ? 'critical' : under(DISK_LOW) ? 'low' : 'ok';
}

const RANK: Record<DiskLevel, number> = { ok: 0, low: 1, critical: 2 };
export const worstLevel = (levels: DiskLevel[]): DiskLevel => levels.reduce<DiskLevel>((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');

/** "12 GB", "850 MB". */
export function freeSize(bytes: number): string {
  if (bytes >= 10 * GB) return `${Math.round(bytes / GB)} GB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`;
}

const where = (v: DiskVolume) => (v.kind === 'data' ? "the disk with Omni's data" : v.quota ? 'your /tmp quota' : 'the temp folder disk');

/** One line per volume that is not ok, for the server log and the Conductor. */
export function diskLine(v: DiskVolume): string {
  return `${freeSize(v.freeBytes)} free of ${freeSize(v.totalBytes)} on ${where(v)} (${v.path})${v.quota ? ', estimated' : ''}`;
}

export interface DiskNotice {
  level: Exclude<DiskLevel, 'ok'>;
  text: string;
  detail: string;
}

/** What the clients show, or null when every volume is ok. The tightest volume speaks. */
export function diskNotice(view: DiskView | null | undefined): DiskNotice | null {
  if (!view || view.level === 'ok') return null;
  const bad = view.volumes.filter((v) => v.level !== 'ok').sort((a, b) => RANK[b.level] - RANK[a.level] || a.freeBytes - b.freeBytes);
  const v = bad[0];
  if (!v) return null;
  const free = `${freeSize(v.freeBytes)} left on ${where(v)}`;
  const text = v.level === 'critical' ? `Almost out of space: ${free}. Threads stop working when it fills.` : `Space is running low: ${free}.`;
  const detail = v.kind === 'tmp' ? 'Delete old temp folders, or free space in Settings > Worktrees.' : 'Free space in Settings > Worktrees, or remove old repo copies, simulators and build caches.';
  return { level: v.level === 'critical' ? 'critical' : 'low', text, detail };
}
