// Post nothing when empty: a run of a `quiet: true` automation that replied with QUIET_REPLY (automation-rules.ts) ends
// marked done, so it never reaches Needs you, raises no alert on any client and sends no push. The thread stays in its
// channel's list, so the run can still be read. The runner calls it through the reporting.quietRun port (compose.ts).
import { db, threads } from './db.ts';
import { loadAutomations } from './automations.ts';
import { isQuietReply } from './automation-rules.ts';

/**
 * Called as a turn ends, before its alert. True when this was a quiet run with nothing to report: the thread is marked
 * done and the caller sends no alert. Only the run's own first turn is filed away: never a delegated thread, one the
 * user wrote in after the run, or one that asked a question (an approval card means there was something to act on),
 * so text the run read cannot talk it into hiding a turn that did more than report.
 */
export function fileQuietRun(threadId: string, reply: string | null): boolean {
  const t = threads.get(threadId);
  if (!t?.automation || t.source !== 'automation' || t.parent_id || !isQuietReply(reply)) return false;
  const a = loadAutomations().find((x) => x.id === t.automation);
  if (!a?.quiet) return false;
  const seen = db.prepare(`SELECT kind, COUNT(*) AS n FROM events WHERE thread_id = ? AND kind IN ('user', 'question') GROUP BY kind`).all(threadId) as { kind: string; n: number }[];
  const count = (kind: string) => seen.find((r) => r.kind === kind)?.n ?? 0;
  if (count('user') > 1 || count('question') > 0) return false;
  threads.setDone(threadId, true);
  console.log(`[automations] ${a.id}: nothing to report, ${threadId} filed as done`);
  return true;
}
