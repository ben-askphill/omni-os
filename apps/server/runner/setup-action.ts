// A channel's setup action (#211): run in a new worktree once per preparation attempt, after the checkout is made
// and verified. A blocking one must succeed before the agent starts; a background one runs alongside it. Ben's Stop
// on a thread being prepared ends the attempt here, whichever step it is on, and keeps the first prompt for Retry.
import { startRun, stopRun } from '../actions.ts';
import { channelActions, threadSetupRuns, threads, type Thread } from '../db.ts';
import { isProviderHarness } from '../harness/types.ts';

const STOPPED = 'Stopped by Ben before the agent started.';

/** Threads whose current preparation attempt Ben stopped. */
const stops = new Set<string>();

/** A preparation attempt starts: nothing stopped it yet, and an earlier attempt's setup run is no longer its run. */
export function beginAttempt(threadId: string) {
  stops.delete(threadId);
  threadSetupRuns.clear(threadId);
}

export const endAttempt = (threadId: string) => stops.delete(threadId);

/**
 * Ben's Stop on a thread whose worktree is being prepared: its setup run is stopped and the attempt ends before the
 * agent starts. False when the thread is not being prepared, so Stop goes to its agent as usual.
 */
export function stopPreparation(threadId: string): boolean {
  if (threads.get(threadId)?.setup !== 'preparing') return false;
  stops.add(threadId);
  const runId = threadSetupRuns.get(threadId);
  if (runId) void stopRun(runId, STOPPED);
  return true;
}

/** Why the agent must not start after the checkout: Ben stopped the attempt, or a blocking setup did not succeed. */
export interface SetupHold {
  stopped: boolean;
  reason: string;
}

/**
 * After the checkout is made and verified: run the channel's setup action in it, if it has one. Resolves once a
 * blocking one has ended, or once a background one has started, with why the agent must not start, or null. A
 * thread that runs off this Mac never gets one, and nor does a thread without a worktree, which never comes here.
 */
export async function runSetupAction(t: Thread): Promise<SetupHold | null> {
  const action = isProviderHarness(t.harness) ? undefined : channelActions.setupFor(t.channel_id);
  if (action && !stops.has(t.id)) {
    let started: Awaited<ReturnType<typeof startRun>>;
    try {
      started = await startRun(t, action);
    } catch (err) {
      return { stopped: false, reason: `The setup action "${action.name}" could not start: ${(err as Error).message}` };
    }
    threadSetupRuns.set(t.id, started.run.id);
    // Stop pressed while the run was starting had no run to stop yet.
    if (stops.has(t.id)) void stopRun(started.run.id, STOPPED);
    if (action.setup === 'blocking') {
      const end = await started.finished;
      if (end.state !== 'succeeded' && !stops.has(t.id)) {
        const how = end.exit_code !== null ? ` with exit code ${end.exit_code}` : end.error ? `: ${end.error}` : '';
        return { stopped: false, reason: `The setup action "${action.name}" failed${how}. Its output is in the Actions tab.` };
      }
    }
  }
  return stops.has(t.id) ? { stopped: true, reason: STOPPED } : null;
}
