// Watch PR: the server polls a thread's pull request and wakes the thread when something new needs it
// (apps/server/pr-watch/). Server and web share these shapes; the Mac app mirrors them (OmniKit PRWatch.swift) and
// the fixtures in apps/server/tests/mac-fixtures.test.ts hold both to the same JSON.

/**
 * Why a watch stopped polling. `stopped`: Ben or the Conductor stopped it. `archived`: its thread was archived.
 * `merged`, `closed`: the PR was. `wake_limit`: it woke the thread as often as one watch may. `error_limit`: GitHub
 * failed too many times in a row.
 */
export type PRWatchStop = 'stopped' | 'archived' | 'merged' | 'closed' | 'wake_limit' | 'error_limit';

/** Check counts at the last observation, as the PR lists count them. */
export interface PRWatchChecks {
  passed: number;
  failed: number;
  pending: number;
}

/** GET/PUT/DELETE /api/threads/:id/pr-watch: a thread's watch, or null when it never had one. */
export interface PRWatchView {
  thread_id: string;
  repo: string;
  number: number;
  state: 'watching' | 'stopped';
  stop_reason: PRWatchStop | null;
  /** The PR head at the last observation. */
  head_sha: string | null;
  checks: PRWatchChecks | null;
  /** How often this watch woke its thread, of at most `max_wakes`. */
  wakes: number;
  max_wakes: number;
  last_wake_at: string | null;
  last_polled_at: string | null;
  next_poll_at: string | null;
  /** The last poll's failure, cleared by the next good one. */
  error: string | null;
  created_at: string;
  updated_at: string;
}

const STOPPED: Record<PRWatchStop, string> = {
  stopped: 'Watch stopped',
  archived: 'Watch stopped: thread archived',
  merged: 'Watch ended: PR merged',
  closed: 'Watch ended: PR closed',
  wake_limit: 'Watch stopped after its wake limit',
  error_limit: 'Watch stopped: GitHub kept failing',
};

/** The one line a client shows for a watch: what it sees now, or why it stopped. */
export function watchLine(w: PRWatchView): string {
  if (w.state === 'stopped') return STOPPED[w.stop_reason ?? 'stopped'];
  if (w.error) return 'Watching checks, retrying GitHub';
  const c = w.checks;
  if (!c) return 'Watching checks';
  if (c.failed) return `Watching checks: ${c.failed} failing`;
  if (c.pending) return `Watching checks: ${c.pending} running`;
  if (c.passed) return 'Watching checks: all passed';
  return 'Watching checks';
}
