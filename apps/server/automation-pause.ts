// Turns an automation off once FAILURE_LIMIT of its runs in a row failed, as Cloudroom pauses a loop after 3: one that
// fails every run would otherwise keep starting threads and spending on them. The pause writes `enabled: false` into
// its YAML like the toggle does (so it reaches the other machines) and adds a row to its run history saying why.
// Failures before that row no longer count, so turning it back on gives it a clean slate.
import { setAutomationEnabled } from './automation-files.ts';
import { loadAutomations } from './automations.ts';
import { bus, SYNC_BATCH, type FeedEvent } from './bus.ts';
import { automationRuns, db, syncMeta } from './db.ts';
import { applyingSync } from './sync/apply.ts';
import { runsHere } from './sync/owner.ts';
import type { RemoteChange } from './sync/transport.ts';

export const FAILURE_LIMIT = 3;
/** The trigger of the history row an automatic pause leaves. */
export const PAUSE_TRIGGER = 'pause';
export const PAUSE_REASON = `Turned off after ${FAILURE_LIMIT} failed runs in a row. Turn it back on once the cause is fixed.`;

/** The automation's latest failed runs in a row, counted up to FAILURE_LIMIT, and when the newest of them started. */
interface Streak {
  count: number;
  newest: string | null;
}

/**
 * How many of the automation's latest runs failed in a row, back to its last automatic pause, counted up to
 * FAILURE_LIMIT. A finished run breaks the streak; skipped, stopped and unfinished runs say nothing about whether it
 * works, so they neither count nor break it. The query reads only the rows that decide (failed, done, a pause), so any
 * number of skips between two failures cannot push the earlier one out of the count.
 */
function streak(id: string): Streak {
  const rows = db
    .prepare(
      `SELECT r.trigger, r.created_at, t.status FROM automation_runs r LEFT JOIN threads t ON t.id = r.thread_id
       WHERE r.automation = ? AND (r.trigger = ? OR t.status IN ('failed', 'done'))
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .all(id, PAUSE_TRIGGER, FAILURE_LIMIT) as { trigger: string; created_at: string; status: string | null }[];
  let count = 0;
  for (const r of rows) {
    if (r.trigger === PAUSE_TRIGGER || r.status === 'done') break;
    count++;
  }
  return { count, newest: count ? rows[0].created_at : null };
}

export const failuresInARow = (id: string) => streak(id).count;

/**
 * Turn the automation off when its last FAILURE_LIMIT runs failed. Only the machine that runs it does. True when it did.
 * `synced`: the runs came from another machine. That history can be older than this machine's last change to the
 * automation (a backfill, or the pause another machine made for those runs still on its way), so runs that started
 * before the automation was last turned on or edited never turn it off again.
 */
export function pauseIfFailing(id: string, opts: { synced?: boolean } = {}): boolean {
  const a = loadAutomations().find((x) => x.id === id);
  if (!a?.enabled || a.error || !runsHere(a)) return false;
  const s = streak(id);
  if (s.count < FAILURE_LIMIT) return false;
  const changed = syncMeta.get('automation_file', id)?.ts;
  if (opts.synced && changed && s.newest && changed > s.newest) return false;
  setAutomationEnabled(id, false);
  automationRuns.skip(id, PAUSE_TRIGGER, PAUSE_REASON);
  console.log(`[automations] ${id} turned off after ${FAILURE_LIMIT} failed runs in a row`);
  return true;
}

function check(automation: string, synced = false) {
  try {
    pauseIfFailing(automation, { synced });
  } catch (err) {
    console.error(`[automations] could not check ${automation} for failed runs:`, err);
  }
}

/** The automations a sync batch brought failed runs or run records for. */
function touched(changes: RemoteChange[]): Set<string> {
  const ids = new Set<string>();
  for (const c of changes) {
    if (c.op === 'delete') continue;
    const d = c.data as { automation?: string | null; status?: string };
    if (c.entity === 'automation_run' && d.automation) ids.add(d.automation);
    if (c.entity === 'thread' && d.automation && d.status === 'failed') ids.add(d.automation);
  }
  return ids;
}

/**
 * Check an automation each time one of its run threads fails here, and once at the end of each sync batch for the
 * automations it brought runs for. A batch can carry a run's failed thread before its record, and old failures before
 * the pause that already answered them, so the count waits for the whole batch.
 */
export function watchAutomationFailures() {
  bus.on('feed', (e: FeedEvent) => {
    if (e.type !== 'thread' || applyingSync()) return;
    const t = e.thread as { automation?: string | null; status?: string };
    if (t?.automation && t.status === 'failed') check(t.automation);
  });
  bus.on(SYNC_BATCH, (changes: RemoteChange[]) => {
    for (const id of touched(changes)) check(id, true);
  });
}
