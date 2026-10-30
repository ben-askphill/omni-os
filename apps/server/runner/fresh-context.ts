// A thread whose session could not be resumed here (runner/spawn.ts blockResume): Ben tries the download again, or
// starts with fresh context. Fresh context is a handover on the same run: the next turn gets a new native session that
// reads the thread from Omni's own transcript, which syncs, so it holds the turns another machine ran.
import { messageRequests, threads, type Thread } from '../db.ts';
import { isProviderHarness } from '../harness/types.ts';
import { turnBlocked } from '../sync/guard.ts';
import { resumeRequests } from './api.ts';
import { closeLive } from './session.ts';
import { runName } from './switch.ts';
import { emitThread, lives, refusal, runsHere } from './state.ts';

/** The thread can start a turn here now: it exists, is quiet, and nothing else holds it. */
function quiet(threadId: string): Thread {
  const t = threads.get(threadId);
  if (!t) throw refusal('thread not found', 404);
  if (lives.get(threadId)?.turn || t.status === 'running') throw refusal('The thread is running. Try again once it stops.', 409);
  const why = turnBlocked(t, runsHere(threadId));
  if (why) throw refusal(why, 409);
  return t;
}

/** Send what waits for Resume, if anything does: the next spawn downloads the session again first. */
async function sendParked(threadId: string): Promise<Thread> {
  if (messageRequests.parked(threadId).some((r) => r.state === 'recovered')) await resumeRequests(threadId);
  emitThread(threadId);
  return threads.get(threadId)!;
}

/** Try the session download again with the messages that wait. Nothing waiting: the next message tries it. */
export async function retryResume(threadId: string): Promise<Thread> {
  const t = quiet(threadId);
  if (t.resume_blocked) threads.update(threadId, { resume_blocked: null, updated_at: t.updated_at });
  return sendParked(threadId);
}

/**
 * Start the thread's next turn in a new session that reads the thread so far, instead of resuming the session here.
 * Sends what waits for Resume; with nothing waiting, Ben's next message starts it. Twice is the same as once.
 */
export async function startFresh(threadId: string): Promise<Thread> {
  const t = quiet(threadId);
  if (isProviderHarness(t.harness)) throw refusal('This harness keeps its session with its provider, so there is no copy here to start over from.', 400);
  if (!t.has_run) throw refusal('This thread has not run yet, so its first turn already starts with fresh context.', 400);
  const { handover } = threads.sessionState(threadId);
  const from = handover?.from ?? runName({ harness: t.harness, model: t.model ?? '', effort: t.effort });
  threads.update(threadId, { handover: { from, since: 0, fresh: true }, resume_blocked: null, updated_at: t.updated_at });
  // A warm process holds the old session: the next turn starts a new one.
  const live = lives.get(threadId);
  if (live) closeLive(live);
  return sendParked(threadId);
}
