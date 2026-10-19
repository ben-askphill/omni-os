// Limit stops: a turn the harness ended at its plan's usage limit (records.ts keeps it on the thread, with the reset
// time the harness gave), and the one continuation Ben can send for it, now or at that reset. Scheduling is his
// choice per stopped turn, never automatic. The stop syncs to every Mac (apps/server/sync/handlers/limit-stop.ts), so
// each lists it, but only the Mac that ran the turn schedules or sends its continuation, saved as a Request before
// it is woken (queue.ts), so it goes through the slots like any message and a restart can never send it twice. Anything that moves the thread on clears the stop: a message (queue.ts deliver),
// Stop (session.ts) or archiving it.
import { config } from '../config.ts';
import { outbox, threads, tx, type Thread } from '../db.ts';
import { HARNESS_META, isHarnessId } from '../harness/types.ts';
import { turnBlocked } from '../sync/guard.ts';
import { saveOwn, wake } from './queue.ts';
import { emitThread, isShuttingDown, runsHere } from './state.ts';

/** What the harness gets. */
export const CONTINUE_PROMPT = 'Your usage limit has reset. Continue where you left off.';
/** What the transcript shows, as Omni's. */
const CONTINUE_TEXT = 'Continue where you left off.';

/** The clock scheduled continuations are checked against. Tests move it. */
export const limitClock = { now: () => Date.now() };

/** How often scheduled continuations are checked besides their own timer: a Mac asleep at the reset catches up. */
const SWEEP_MS = 30_000;

const refusal = (message: string, status: number) => Object.assign(new Error(message), { status });

function thread(threadId: string): Thread {
  const t = threads.get(threadId);
  if (!t) throw refusal('thread not found', 404);
  return t;
}

const harnessName = (t: Thread) => (isHarnessId(t.harness) ? HARNESS_META[t.harness].name : t.harness);

/** The thread's limit stop, when Ben can act on it on this Mac; a refusal saying why not otherwise. */
function ownStop(t: Thread) {
  const l = threads.limit(t.id);
  if (!l) throw refusal('This thread is not waiting on a usage limit.', 409);
  if (l.limit_machine && l.limit_machine !== outbox.machineId()) throw refusal('This thread stopped on your other Mac. Resume it there.', 409);
  return l;
}

/**
 * Send the continuation, once. The stop is taken off the thread and the request saved in one write, keyed by the
 * stop, before anything is woken: a second caller finds nothing to take. False when there was nothing to send.
 */
function sendContinuation(threadId: string, from: readonly ('limited' | 'scheduled')[]): boolean {
  const row = tx(() => {
    const key = threads.takeLimit(threadId, from);
    if (!key) return null;
    return saveOwn(threadId, `limit-resume:${key}`, { prompt: CONTINUE_PROMPT, kind: 'user', payload: { text: CONTINUE_TEXT, source: 'limit' }, source: 'limit' });
  });
  if (!row) return false;
  wake(row);
  return true;
}

/**
 * Ben's Resume at reset: the continuation runs once the reported reset has passed (plus a grace for it to land).
 * Only with a reset time; without one he resumes by hand. Scheduling again changes nothing. One that is already due
 * runs now.
 */
export function scheduleLimitResume(threadId: string): Thread {
  const t = thread(threadId);
  const l = ownStop(t);
  if (!l.limit_resets_at) throw refusal(`${harnessName(t)} did not say when its limit resets, so this thread can only be resumed by hand.`, 409);
  if (l.limit_state === 'limited' && threads.moveLimit(threadId, 'limited', 'scheduled')) emitThread(threadId);
  fireDue();
  return threads.get(threadId)!;
}

/** Ben no longer wants it resumed at the reset: back to limited, for him to schedule again or resume by hand. */
export function cancelLimitResume(threadId: string): Thread {
  const t = thread(threadId);
  if (threads.limit(threadId)) ownStop(t);
  if (threads.moveLimit(threadId, 'scheduled', 'limited')) emitThread(threadId);
  armLimits();
  return threads.get(threadId)!;
}

/** Ben's Resume now, scheduled or not, with or without a reset time. */
export function resumeLimitNow(threadId: string): Thread {
  const t = thread(threadId);
  ownStop(t);
  const blocked = turnBlocked(t, runsHere(threadId));
  if (blocked) throw refusal(blocked, 409);
  if (!sendContinuation(threadId, ['limited', 'scheduled'])) throw refusal('This thread is no longer waiting on a usage limit.', 409);
  armLimits();
  return threads.get(threadId)!;
}

/** Stop or archive: the thread is not to be resumed by itself any more. */
export function clearLimit(threadId: string) {
  if (!threads.get(threadId)?.limit_state) return;
  threads.setLimit(threadId, null);
  armLimits();
  emitThread(threadId);
}

/**
 * Send every scheduled continuation whose reset has passed, overdue ones included (a restart, a Mac that slept).
 * One for a thread that cannot run here now (the other Mac took it over) is dropped. The ids it sent.
 */
export function fireDue(now = limitClock.now()): string[] {
  if (isShuttingDown()) return [];
  const sent: string[] = [];
  for (const r of threads.scheduledLimits()) {
    if (Date.parse(r.limit_resets_at) + config.limitGraceMs > now) break;
    try {
      const t = threads.get(r.id)!;
      const blocked = turnBlocked(t, runsHere(r.id));
      if (blocked) {
        console.log(`[limits] ${r.id}: not resuming at the reset: ${blocked}`);
        clearLimit(r.id);
        continue;
      }
      if (sendContinuation(r.id, ['scheduled'])) sent.push(r.id);
    } catch (err) {
      console.error(`[limits] ${r.id}: could not resume:`, (err as Error).message);
    }
  }
  armLimits(now);
  return sent;
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Wake for the soonest scheduled continuation. */
export function armLimits(now = limitClock.now()) {
  clearTimeout(timer);
  timer = undefined;
  const next = threads.scheduledLimits()[0];
  if (!next) return;
  const wait = Math.min(Math.max(Date.parse(next.limit_resets_at) + config.limitGraceMs - now, 0), 2 ** 31 - 1);
  timer = setTimeout(() => fireDue(), wait);
  timer.unref?.();
}

/** At boot: what came due while Omni was down runs now, then on time from here. */
export function startLimits() {
  fireDue();
  setInterval(() => fireDue(), SWEEP_MS).unref();
}
