// Turns an automation off once FAILURE_LIMIT of its runs in a row failed, as Cloudroom pauses a loop after 3: one that
// fails every run would otherwise keep starting threads and spending on them. The pause writes `enabled: false` into
// its YAML like the toggle does (so it reaches the other machines) and adds a row to its run history saying why.
// Failures before that row no longer count, so turning it back on gives it a clean slate.
import { setAutomationEnabled } from './automation-files.ts';
import { loadAutomations } from './automations.ts';
import { bus, SYNCED_AUTOMATION_RUN, type FeedEvent } from './bus.ts';
import { automationRuns, db } from './db.ts';
import { runsHere } from './sync/owner.ts';

export const FAILURE_LIMIT = 3;
/** The trigger of the history row an automatic pause leaves. */
export const PAUSE_TRIGGER = 'pause';
export const PAUSE_REASON = `Turned off after ${FAILURE_LIMIT} failed runs in a row. Turn it back on once the cause is fixed.`;

/**
 * How many of the automation's latest runs failed in a row, back to its last automatic pause, counted up to
 * FAILURE_LIMIT. A finished run breaks the streak; skipped, stopped and unfinished runs say nothing about whether it
 * works, so they neither count nor break it. The query reads only the rows that decide (failed, done, a pause), so any
 * number of skips between two failures cannot push the earlier one out of the count.
 */
export function failuresInARow(id: string): number {
  const rows = db
    .prepare(
      `SELECT r.trigger, t.status FROM automation_runs r LEFT JOIN threads t ON t.id = r.thread_id
       WHERE r.automation = ? AND (r.trigger = ? OR t.status IN ('failed', 'done'))
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .all(id, PAUSE_TRIGGER, FAILURE_LIMIT) as { trigger: string; status: string | null }[];
  let n = 0;
  for (const r of rows) {
    if (r.trigger === PAUSE_TRIGGER || r.status === 'done') break;
    n++;
  }
  return n;
}

/** Turn the automation off when its last FAILURE_LIMIT runs failed. Only the machine that runs it does. True when it did. */
export function pauseIfFailing(id: string): boolean {
  const a = loadAutomations().find((x) => x.id === id);
  if (!a?.enabled || a.error || !runsHere(a) || failuresInARow(id) < FAILURE_LIMIT) return false;
  setAutomationEnabled(id, false);
  automationRuns.skip(id, PAUSE_TRIGGER, PAUSE_REASON);
  console.log(`[automations] ${id} turned off after ${FAILURE_LIMIT} failed runs in a row`);
  return true;
}

function check(automation: string) {
  try {
    pauseIfFailing(automation);
  } catch (err) {
    console.error(`[automations] could not check ${automation} for failed runs:`, err);
  }
}

/**
 * Check an automation each time one of its run threads fails, here or on another machine, and each time a run record
 * arrives from another machine: sync can bring a run's failed thread before its record, and the count needs both.
 */
export function watchAutomationFailures() {
  bus.on('feed', (e: FeedEvent) => {
    if (e.type !== 'thread') return;
    const t = e.thread as { automation?: string | null; status?: string };
    if (t?.automation && t.status === 'failed') check(t.automation);
  });
  bus.on(SYNCED_AUTOMATION_RUN, check);
}
