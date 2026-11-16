// Turns an automation off once FAILURE_LIMIT of its runs in a row failed, as Cloudroom pauses a loop after 3: one that
// fails every run would otherwise keep starting threads and spending on them. The pause writes `enabled: false` into
// its YAML like the toggle does (so it reaches the other machines) and adds a row to its run history saying why.
// Failures before that row no longer count, so turning it back on gives it a clean slate.
import { setAutomationEnabled } from './automation-files.ts';
import { loadAutomations } from './automations.ts';
import { bus, type FeedEvent } from './bus.ts';
import { automationRuns, db } from './db.ts';
import { runsHere } from './sync/owner.ts';

export const FAILURE_LIMIT = 3;
/** The trigger of the history row an automatic pause leaves. */
export const PAUSE_TRIGGER = 'pause';
export const PAUSE_REASON = `Turned off after ${FAILURE_LIMIT} failed runs in a row. Turn it back on once the cause is fixed.`;

/** How far back the count looks: a run of skips and stops this long ends it. */
const LOOK_BACK = 100;

/**
 * How many of the automation's latest runs failed in a row, back to its last automatic pause. A finished run breaks
 * the streak; skipped, stopped and unfinished runs say nothing about whether it works, so they neither count nor break it.
 */
export function failuresInARow(id: string): number {
  const rows = db
    .prepare(
      `SELECT r.trigger, t.status FROM automation_runs r LEFT JOIN threads t ON t.id = r.thread_id
       WHERE r.automation = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    )
    .all(id, LOOK_BACK) as { trigger: string; status: string | null }[];
  let n = 0;
  for (const r of rows) {
    if (r.trigger === PAUSE_TRIGGER || r.status === 'done') break;
    if (r.status === 'failed') n++;
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

/** Check an automation each time one of its run threads fails, here or on another machine (sync emits those too). */
export function watchAutomationFailures() {
  bus.on('feed', (e: FeedEvent) => {
    if (e.type !== 'thread') return;
    const t = e.thread as { automation?: string | null; status?: string };
    if (!t?.automation || t.status !== 'failed') return;
    try {
      pauseIfFailing(t.automation);
    } catch (err) {
      console.error(`[automations] could not check ${t.automation} for failed runs:`, err);
    }
  });
}
