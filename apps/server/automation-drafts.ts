// Drafts that expire: an automation with `approve: true` and `expires: 8h` asks on the question card before it acts
// (automation-rules.ts). A card nobody answered within that time is answered for them, as expired, so the run ends
// without acting and the thread is marked done. Only the machine that runs the automation does it, so two synced
// machines never both answer; the answer and the done mark sync like the user's own.
import { questionsIn } from '@omni/shared/question.ts';
import { spanWords } from '@omni/shared/cron.ts';
import { db, events, threads } from './db.ts';
import { loadAutomations } from './automations.ts';
import { answerQuestion } from './runner/questions.ts';
import { ownerOf } from './sync/owner.ts';

/** How often to look for expired drafts. */
const SWEEP_MS = 60_000;

/** The answer an expired draft gets, as the "Other" text of each question. */
export const expiredAnswer = (sec: number) => `Expired: nobody approved this within ${spanWords(sec)}. Do nothing, and end the run in one line saying it expired.`;

/**
 * Answer every approval question that has waited past its automation's `expires`, and mark its thread done. Returns
 * the threads it expired. A question the user answered meanwhile is a conflict and left alone.
 */
export async function expireDrafts(now = Date.now()): Promise<string[]> {
  const limits = new Map(loadAutomations().flatMap((a) => (a.approve && a.expiresAfter && ownerOf(a).isThisMac ? [[a.id, a.expiresAfter] as const] : [])));
  if (!limits.size) return [];
  const open = db
    .prepare(`SELECT id, automation FROM threads WHERE automation IS NOT NULL AND source = 'automation' AND done_at IS NULL AND archived = 0`)
    .all() as { id: string; automation: string }[];
  const expired: string[] = [];
  for (const t of open) {
    const sec = limits.get(t.automation);
    if (!sec) continue;
    const rows = events.questions(t.id);
    const asked = new Map(rows.map((r) => [r.id, Date.parse(r.created_at)]));
    for (const q of questionsIn(rows)) {
      if (q.state !== 'pending' || now - (asked.get(q.event_id) ?? now) < sec * 1000) continue;
      const answered = await answerQuestion(
        t.id,
        q.id,
        q.questions.map(() => ({ selected: [], other: expiredAnswer(sec) })),
      ).catch((err: Error) => (console.error(`[automations] could not expire ${t.id}:`, err.message), null));
      if (!answered || 'conflict' in answered) continue;
      threads.setDone(t.id, true);
      expired.push(t.id);
      console.log(`[automations] ${t.automation}: draft in ${t.id} expired after ${spanWords(sec)}`);
    }
  }
  return expired;
}

export function startDraftExpiry() {
  const tick = () => void expireDrafts().catch((err) => console.error('[automations] draft expiry:', err));
  setInterval(tick, SWEEP_MS).unref();
  tick();
}
