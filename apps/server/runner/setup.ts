// A worktree thread's preparation: its worktree is made and checked before any harness runs, and a failure waits
// for Retry with the first prompt and its files saved. Nothing runs in the channel's own checkout instead.
import { channels, messageRequests, outbox, requestFingerprint, threads, type Thread } from '../db.ts';
import { prepareWorktree } from '../sandbox.ts';
import { recordStartBase } from '../changes.ts';
import { baseFor } from '../worktree-base.ts';
import type { Attachment } from '../uploads.ts';
import { reportToParent, settleTeam } from './queue.ts';
import { emitThread, refusal, runsHere } from './state.ts';

/** The request id a worktree thread's first prompt is saved under. One per thread, so it is saved once. */
export const START_REQUEST = 'thread-start';


/**
 * Save a new worktree thread's first prompt and files as its first request before the worktree is made, so a
 * failure or a restart keeps them for Retry (db/repos/requests.ts). It runs once the worktree is ready.
 */
export function saveStart(thread: Thread, prompt: string, attachments: Attachment[] | undefined) {
  const source = thread.source === 'conductor' ? 'conductor' : 'ben';
  messageRequests.accept({
    thread_id: thread.id,
    request_id: START_REQUEST,
    prompt,
    mode: 'steer',
    source,
    attachments: attachments ?? null,
    fingerprint: requestFingerprint({ prompt, mode: 'steer', source, files: (attachments ?? []).map((a) => ({ name: a.name, size: a.size, sha256: '' })) }),
    machine_id: outbox.machineId(),
  });
}

/** A lead that has not run waits for its team, shown as running. */
const waitingLead = (t: Thread) => !t.has_run && threads.team(t.id).length > 0;

/** Each thread's preparation while it runs, so a second Retry joins the first instead of starting another. */
const preparing = new Map<string, Promise<Thread | undefined>>();

/** Resume, bound by api.ts: sends a thread's recovered requests through the runner, in their saved order. */
let resumeImpl: (threadId: string) => Promise<unknown> = async () => {
  throw new Error('runner setup is not ready');
};
export const bindResume = (fn: (threadId: string) => Promise<unknown>) => {
  resumeImpl = fn;
};

/**
 * Make the thread's worktree and check it, then send what waited for it. Marks the thread preparing before it
 * returns. On failure the thread shows why and its first prompt waits, recovered, for Retry; a child reports the
 * failure to its parent. Never runs twice at once for one thread.
 */
export function setUpThread(threadId: string): Promise<Thread | undefined> {
  const running = preparing.get(threadId);
  if (running) return running;
  const t = threads.get(threadId);
  if (!t) return Promise.resolve(undefined);
  const status = t.status === 'failed' || t.status === 'stopped' ? (waitingLead(t) ? 'running' : 'queued') : t.status;
  threads.update(threadId, { setup: 'preparing', setup_error: null, status, updated_at: t.updated_at });
  emitThread(threadId);
  const job = prepare(t)
    .catch((err) => {
      console.error(`[setup] ${threadId}:`, err);
      return threads.get(threadId);
    })
    .finally(() => preparing.delete(threadId));
  preparing.set(threadId, job);
  return job;
}

async function prepare(t: Thread): Promise<Thread | undefined> {
  const repo = channels.get(t.channel_id)?.repo_path ?? null;
  try {
    if (!t.branch) throw new Error('The thread has no branch to check out.');
    await prepareWorktree(repo, t.cwd, t.branch, () => baseFor(t.id, repo!));
    // The commit the branch starts from, for the Changes panel. Recorded before anything runs there.
    await recordStartBase(t.id, repo!, t.cwd).catch((err) => console.error(`[setup] ${t.id}: could not record the base commit:`, (err as Error).message));
  } catch (err) {
    failSetup(t.id, (err as Error).message);
    return threads.get(t.id);
  }
  threads.update(t.id, { setup: null, setup_error: null, updated_at: t.updated_at });
  emitThread(t.id);
  const now = threads.get(t.id)!;
  if (waitingLead(now)) {
    threads.update(t.id, { status: 'running', updated_at: now.updated_at });
    settleTeam(t.id);
    emitThread(t.id);
    return threads.get(t.id);
  }
  // The first prompt, and anything parked while it failed, go as a Resume would: in order, through the slots.
  for (const r of messageRequests.unstarted(t.id)) messageRequests.park(r.id);
  try {
    await resumeImpl(t.id);
  } catch (err) {
    console.error(`[setup] ${t.id}: could not send after preparing:`, (err as Error).message);
  }
  // Nothing was left to send (Ben discarded it): the thread stops here rather than looking queued.
  const after = threads.get(t.id);
  if (after?.status === 'queued' && !runsHere(t.id)) threads.update(t.id, { status: 'stopped', updated_at: after.updated_at });
  emitThread(t.id);
  return threads.get(t.id);
}

/** The thread could not be prepared: why, on the thread, with its first prompt kept for Retry. */
export function failSetup(threadId: string, reason: string) {
  threads.update(threadId, { setup: 'failed', setup_error: reason, status: 'failed' });
  for (const r of messageRequests.unstarted(threadId)) messageRequests.park(r.id);
  emitThread(threadId);
  const t = threads.get(threadId);
  if (t?.parent_id) reportToParent(threadId, 'failed', `Omni could not prepare this thread's worktree, so it has not run: ${reason}`);
}

/**
 * Ben's Retry. Idempotent: a thread that is ready is left as it is, one being prepared keeps that preparation, and
 * the same thread, branch and session are used again, so a retry never makes a second of either.
 */
export function retrySetup(threadId: string): Thread {
  const t = threads.get(threadId);
  if (!t) throw refusal('thread not found', 404);
  if (t.setup === 'failed') void setUpThread(threadId);
  return threads.get(threadId)!;
}
