// A channel's teardown action (#678): run in a thread's worktree right before a cleanup removes it (worktree-cleanup.ts,
// for both a reviewed cleanup and the retention pass), to stop a preview or delete a preview theme. It gets the same
// environment as any action run (actions.ts runEnv), and its run is recorded on the thread like any other, so the
// thread's Actions tab shows its output. A teardown that fails, cannot start or runs past the limit never holds the
// removal up: the cleanup notes why and removes the worktree anyway.
import { startRunHeld, stopRun } from '../actions.ts';
import { config } from '../config.ts';
import { channelActions, type Thread } from '../db.ts';
import { isProviderHarness } from '../harness/types.ts';

const limit = (ms: number) => (ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} minute${ms === 60_000 ? '' : 's'}` : `${Math.round(ms / 1000)} seconds`);

/**
 * Run the channel's teardown action in dir, the thread's worktree, which the caller holds. Resolves once it has ended
 * or been stopped at the time limit: null when it succeeded or the channel has none, else what went wrong. Never throws.
 */
export async function runTeardownAction(t: Thread, dir: string, timeoutMs = config.teardownTimeoutMs): Promise<string | null> {
  if (isProviderHarness(t.harness)) return null;
  const action = channelActions.teardownFor(t.channel_id);
  if (!action) return null;
  const name = `The teardown action "${action.name}"`;
  let started: Awaited<ReturnType<typeof startRunHeld>>;
  try {
    started = await startRunHeld(t, action, dir);
  } catch (err) {
    return `${name} could not start: ${(err as Error).message}`;
  }
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), timeoutMs)));
  const end = await Promise.race([started.finished, late]);
  clearTimeout(timer);
  if (!end) {
    await stopRun(started.run.id, `It ran past ${limit(timeoutMs)}, so Omni stopped it before removing the worktree.`);
    return `${name} ran past ${limit(timeoutMs)} and was stopped. Its output is in the thread's Actions tab.`;
  }
  if (end.state === 'succeeded') return null;
  const how = end.exit_code !== null ? ` with exit code ${end.exit_code}` : end.error ? `: ${end.error}` : '';
  return `${name} failed${how}. Its output is in the thread's Actions tab.`;
}
