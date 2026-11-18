// Post nothing when empty: a run of a `quiet: true` automation that replied with QUIET_REPLY (automation-rules.ts) ends
// marked done, so it never reaches Needs you, raises no alert on any client and sends no push. The thread stays in its
// channel's list, so the run can still be read.
import { threads } from './db.ts';
import { loadAutomations } from './automations.ts';
import { isQuietReply } from './automation-rules.ts';

/**
 * Called as a turn ends, before its alert. True when this was a quiet run with nothing to report: the thread is marked
 * done and the caller sends no alert. A delegated thread, or one the user wrote in after the run, is never filed away.
 */
export function fileQuietRun(threadId: string, reply: string | null): boolean {
  const t = threads.get(threadId);
  if (!t?.automation || t.source !== 'automation' || t.parent_id || !isQuietReply(reply)) return false;
  const a = loadAutomations().find((x) => x.id === t.automation);
  if (!a?.quiet) return false;
  threads.setDone(threadId, true);
  console.log(`[automations] ${a.id}: nothing to report, ${threadId} filed as done`);
  return true;
}
