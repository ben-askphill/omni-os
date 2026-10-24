// Watch PR: the server polls a thread's pull request and wakes the thread when something new needs it
// (apps/server/pr-watch/). Server and web share these shapes; the Mac app mirrors them (OmniKit PRWatch.swift) and
// the fixtures in apps/server/tests/mac-fixtures.test.ts hold both to the same JSON.

/**
 * Why a watch stopped polling. `stopped`: Ben or the Conductor stopped it. `archived`: its thread was archived.
 * `merged`, `closed`: the PR was. `wake_limit`: it woke the thread as often as one watch may. `comment_limit`: it woke
 * the thread that often for review comments alone, with no failing check behind the wake. `error_limit`: GitHub failed
 * too many times in a row.
 */
export type PRWatchStop = 'stopped' | 'archived' | 'merged' | 'closed' | 'wake_limit' | 'comment_limit' | 'error_limit';

/**
 * One thing a wake is about, as the transcript's PR watch message lists it (`items` on its payload, at most
 * `MAX_WAKE_ITEMS`): a failing check, or a review comment with who wrote it and a bounded excerpt of it.
 */
export interface PRWakeItem {
  source: 'checks' | 'feedback';
  /** A check's name, or the author of the comment. */
  label: string;
  /** Where to read it on GitHub. */
  url: string | null;
  /** Review feedback only: the comment cut to `WAKE_EXCERPT` characters. */
  excerpt?: string;
  /** Review feedback only: what it is, e.g. "changes requested", "comment on src/a.ts:12". */
  kind?: string;
}

export const MAX_WAKE_ITEMS = 8;
export const WAKE_EXCERPT = 200;

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

const WATCHING = 'Watching checks and reviews';

const STOPPED: Record<PRWatchStop, string> = {
  stopped: 'Watch stopped',
  archived: 'Watch stopped: thread archived',
  merged: 'Watch ended: PR merged',
  closed: 'Watch ended: PR closed',
  wake_limit: 'Watch stopped after its wake limit',
  comment_limit: 'Watch stopped after its review wake limit',
  error_limit: 'Watch stopped: GitHub kept failing',
};

/** The one line a client shows for a watch: what it sees now, or why it stopped. */
export function watchLine(w: PRWatchView): string {
  if (w.state === 'stopped') return STOPPED[w.stop_reason ?? 'stopped'];
  if (w.error) return `${WATCHING}, retrying GitHub`;
  const c = w.checks;
  if (!c) return WATCHING;
  if (c.failed) return `${WATCHING}: ${c.failed} failing`;
  if (c.pending) return `${WATCHING}: ${c.pending} running`;
  if (c.passed) return `${WATCHING}: all passed`;
  return WATCHING;
}

/** The PR menu's start row: what pressing it does, and what a watch does before there is one. */
export const WATCH_ACTION = 'Watch PR';
export const WATCH_HINT = 'Wakes this thread when a check fails or a review comes in';
