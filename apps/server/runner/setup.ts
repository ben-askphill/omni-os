// A thread's preparation before any harness runs: the sign-in check for the connectors its brief or role needs
// (connectors.ts), then, for a worktree thread, its worktree made and checked. A failure waits for Retry with the
// first prompt and its files saved; a signed-out connector waits as `signin` for Try again or Start anyway. Nothing
// runs in the channel's own checkout instead.
import { channelActions, channels, continuations, kv, messageRequests, outbox, requestFingerprint, threads, type Thread } from '../db.ts';
import { isProviderHarness } from '../harness/types.ts';
import { profileOf } from '../harness/profile.ts';
import { SHELL_REFUSAL } from '../request-trust.ts';
import { ensureRepo } from '../repo-clone.ts';
import { prepareWorktree } from '../sandbox.ts';
import { followBranch } from '../branch-follow.ts';
import { withWorkspace } from '../workspace.ts';
import { recordStartBase } from '../changes.ts';
import { baseFor } from '../worktree-base.ts';
import { channelExtras } from '../worktree-include.ts';
import { userName } from '../user-config.ts';
import { carryInto } from '../continue-carry.ts';
import { notifyEnded } from '../push-sender.ts';
import { about } from '../about.ts';
import { doesOwnWork, getCrew } from '../crew.ts';
import { neededConnectors, signInMessage, withoutTokenAccounts } from '../connectors.ts';
import { threadSecretSet } from '../secrets.ts';
import { checkSignIn } from '../sign-in-check.ts';
import type { MessageContext } from '@omni/shared/message-context.ts';
import type { Attachment } from '../uploads.ts';
import { reportToParent, settleTeam } from './queue.ts';
import { attemptSignal, beginAttempt, endAttempt, runSetupAction, STOPPED, stopRequested } from './setup-action.ts';
import { emitThread, refusal, runsHere } from './state.ts';

/** The request id a worktree thread's first prompt is saved under. One per thread, so it is saved once. */
export const START_REQUEST = 'thread-start';


/**
 * Save a new worktree thread's first prompt and files as its first request before the worktree is made, so a
 * failure or a restart keeps them for Retry (db/repos/requests.ts). It runs once the worktree is ready.
 */
export function saveStart(thread: Thread, prompt: string, attachments: Attachment[] | undefined, context?: MessageContext[]) {
  const source = thread.source === 'conductor' ? 'conductor' : 'ben';
  messageRequests.accept({
    thread_id: thread.id,
    request_id: START_REQUEST,
    prompt,
    mode: 'steer',
    source,
    attachments: attachments ?? null,
    context: context ?? null,
    fingerprint: requestFingerprint({ prompt, mode: 'steer', source, files: (attachments ?? []).map((a) => ({ name: a.name, size: a.size, sha256: '' })), context }),
    machine_id: outbox.machineId(),
  });
}

/**
 * The connectors a thread's start needs: its role's `connectors:` and the ones its first prompt names. Only Claude
 * Code reports their sign-ins, so a thread on another harness needs none here. An account its role reaches through a
 * token (`tokens:`) needs no connector while that secret reaches the thread and the thread does its own work, as only
 * then is it told to use the token (runner/prompts.ts).
 */
export function connectorsFor(
  t: Pick<Thread, 'id' | 'harness' | 'role' | 'channel_id' | 'quick' | 'workspace'>,
  prompt = messageRequests.byRequestId(t.id, START_REQUEST)?.prompt ?? '',
  declared = kv.get<string[] | null>(declaredKey(t.id)) ?? undefined,
): string[] {
  if (!profileOf(t.harness).claudeAi) return [];
  const role = getCrew(t.role);
  const needs = neededConnectors(prompt, declared, role?.connectors);
  return doesOwnWork(t, role) ? withoutTokenAccounts(needs, role?.tokens, (name) => threadSecretSet(t.channel_id, name)) : needs;
}

/** A thread's own `connectors:` (its automation's), kept for Try again. Per machine, as the check is. */
const declaredKey = (id: string) => `sync.thread-connectors.${id}`;
export const declareConnectors = (id: string, ids: string[]) => kv.set(declaredKey(id), ids);

/** Threads the user told to start without the sign-in check (Start anyway), until their next preparation. */
const signInWaived = new Set<string>();

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
 * failure to its parent. Never runs twice at once for one thread. `retry` is Ben's Retry setup and who pressed it:
 * the setup step is looked up again after the checkout, so a caller without a shell is held there too.
 */
export function setUpThread(threadId: string, retry?: SetupRetryBy): Promise<Thread | undefined> {
  const running = preparing.get(threadId);
  if (running) return running;
  const t = threads.get(threadId);
  if (!t) return Promise.resolve(undefined);
  const status = t.status === 'failed' || t.status === 'stopped' ? (waitingLead(t) ? 'running' : 'queued') : t.status;
  threads.update(threadId, { setup: 'preparing', setup_error: null, status, updated_at: t.updated_at });
  beginAttempt(threadId);
  emitThread(threadId);
  const job = prepare(t, !retry || !!retry.shell)
    .catch((err) => {
      console.error(`[setup] ${threadId}:`, err);
      return threads.get(threadId);
    })
    .finally(() => {
      endAttempt(threadId);
      preparing.delete(threadId);
    });
  preparing.set(threadId, job);
  return job;
}

async function prepare(t: Thread, shell: boolean): Promise<Thread | undefined> {
  // First, as it is the cheapest: a job whose connector is signed out never makes a worktree or starts a harness.
  const waived = signInWaived.delete(t.id);
  const needs = waived ? [] : connectorsFor(t);
  if (needs.length) {
    const check = await checkSignIn(needs, t.cwd);
    if (stopRequested(t.id)) {
      failSetup(t.id, STOPPED, true);
      return threads.get(t.id);
    }
    if (check.signedOut.length) {
      holdForSignIn(t.id, signInMessage(check.signedOut, about.name));
      return threads.get(t.id);
    }
  }
  // A thread with a branch has a worktree to make: a worktree channel's, or a continued thread's off a shared
  // checkout (continue.ts). One held only for its sign-in check has none.
  if (t.branch) {
    const failed = await prepareWorktreeOf(t, shell);
    if (failed) return threads.get(t.id);
    t = threads.get(t.id) ?? t;
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

/** Make and check a worktree thread's worktree, then run the channel's setup action. True when it failed or stopped. */
async function prepareWorktreeOf(t: Thread, shell: boolean): Promise<boolean> {
  // A worktree its agent moved to another branch keeps that branch: only a detached HEAD or the default branch is
  // switched back (sandbox.ts prepareWorktree).
  if (await followBranch(t.id).catch(() => false)) t = threads.get(t.id) ?? t;
  try {
    if (!t.branch) throw new Error('The thread has no branch to check out.');
    const branch = t.branch;
    // A channel repo that is not on this machine is cloned first, and may land at a new path here (repo-clone.ts).
    // Stop ends the wait at once; the clone itself finishes for the next try.
    await ensureRepo(t.channel_id, attemptSignal(t.id));
    if (stopRequested(t.id)) throw new Error(STOPPED);
    const repo = channels.get(t.channel_id)?.repo_path ?? null;
    // A continued thread's branch starts at its source's HEAD, with the source's changes laid in (continue-carry.ts),
    // so only a new thread's branch is cut from the base Ben picked.
    const base = continuations.get(t.id) ? undefined : () => baseFor(t.id, repo!);
    await withWorkspace(t.cwd, async () => {
      await carryInto(t);
      await prepareWorktree(repo, t.cwd, branch, base, channelExtras(channels.get(t.channel_id)));
    });
    // The commit the branch starts from, for the Changes panel. Recorded before anything runs there.
    await recordStartBase(t.id, repo!, t.cwd).catch((err) => console.error(`[setup] ${t.id}: could not record the base commit:`, (err as Error).message));
  } catch (err) {
    if (stopRequested(t.id)) failSetup(t.id, STOPPED, true);
    else failSetup(t.id, (err as Error).message);
    return true;
  }
  // The channel's setup action, in the verified checkout: a blocking one holds the agent until it succeeds.
  const held = await runSetupAction(t, shell);
  if (held) {
    failSetup(t.id, held.reason, held.stopped);
    return true;
  }
  return false;
}

/**
 * A connector the job needs is signed out: the thread stops before any harness runs, says which one and how to sign
 * in, and keeps its first prompt for Try again. Not a failure, so an automation's run never counts towards turning it
 * off. A delegated thread tells its parent, and one Ben did not start by hand alerts, since nobody is watching it.
 */
export function holdForSignIn(threadId: string, message: string) {
  threads.update(threadId, { setup: 'signin', setup_error: message, status: 'stopped' });
  for (const r of messageRequests.unstarted(threadId)) messageRequests.park(r.id);
  emitThread(threadId);
  const t = threads.get(threadId);
  if (t && t.source !== 'manual') notifyEnded(threadId, 'failed', message);
  if (t?.parent_id) reportToParent(threadId, 'stopped', message);
}

/** The thread could not be prepared, or Ben stopped it first: why, on the thread, with its first prompt kept for Retry. */
export function failSetup(threadId: string, reason: string, stopped = false) {
  threads.update(threadId, { setup: 'failed', setup_error: reason, status: stopped ? 'stopped' : 'failed' });
  if (!stopped) notifyEnded(threadId, 'failed', `Omni could not prepare this thread's worktree: ${reason}`);
  for (const r of messageRequests.unstarted(threadId)) messageRequests.park(r.id);
  emitThread(threadId);
  const t = threads.get(threadId);
  if (!t?.parent_id) return;
  if (stopped) reportToParent(threadId, 'stopped', `${userName().replace(/^the user/, 'The user')} stopped this thread while its worktree was being prepared, so it has not run.`);
  else reportToParent(threadId, 'failed', `Omni could not prepare this thread's worktree, so it has not run: ${reason}`);
}

/**
 * What the caller of Retry setup may do: `shell` when its request may reach a shell (request-guard.ts shellAllowed).
 * `skipSignIn` is Start anyway on a thread held for a sign-in: it starts without the check this once.
 */
export interface SetupRetryBy {
  shell?: boolean;
  skipSignIn?: boolean;
}

/**
 * Ben's Retry. Idempotent: a thread that is ready is left as it is, one being prepared keeps that preparation, and
 * the same thread, branch and session are used again, so a retry never makes a second of either. A failed thread
 * whose channel has a setup step reruns that command in a login shell, so only a caller that may reach a shell
 * retries it (request-trust.ts); without one the retry only checks the branch out again, which anyone may.
 */
export function retrySetup(threadId: string, by: SetupRetryBy = {}): Thread {
  const t = threads.get(threadId);
  if (!t) throw refusal('thread not found', 404);
  if (t.setup !== 'failed' && t.setup !== 'signin') return t;
  // Only a preparation that makes a worktree runs the setup step (prepareWorktreeOf): a failed one, or a sign-in hold
  // on a thread with a branch.
  const runsSetupStep = t.setup === 'failed' || !!t.branch;
  if (runsSetupStep && !by.shell && !isProviderHarness(t.harness) && channelActions.setupFor(t.channel_id)) throw refusal(`Forbidden: ${SHELL_REFUSAL}`, 403);
  if (t.setup === 'signin' && by.skipSignIn) signInWaived.add(threadId);
  void setUpThread(threadId, by);
  return threads.get(threadId)!;
}
