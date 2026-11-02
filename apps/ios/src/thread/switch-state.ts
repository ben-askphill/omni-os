import type { HarnessInfo, OmniApi, Thread } from '@omni/client-core';
import type { Run } from '@omni/shared/run-switch.ts';

import { runForPick, type RunThread } from './run-model';

/** The model sheet's request state. One switch is out at a time, as on the phone web. */
export type SwitchState = { status: 'idle' } | { status: 'switching' } | { status: 'failed'; error: string };

export const IDLE: SwitchState = { status: 'idle' };

export type SwitchEvent = { type: 'start' } | { type: 'done' } | { type: 'fail'; error: string } | { type: 'dismiss' };

export function switchReducer(state: SwitchState, event: SwitchEvent): SwitchState {
  switch (event.type) {
    case 'start':
      return state.status === 'switching' ? state : { status: 'switching' };
    case 'done':
      return IDLE;
    case 'fail':
      return { status: 'failed', error: event.error };
    case 'dismiss':
      return state.status === 'failed' ? IDLE : state;
  }
}

export type SwitchOutcome =
  /** The server took the run: applied now between turns, queued for the next turn during one. */
  | { kind: 'switched'; thread: Thread }
  | { kind: 'unchanged' }
  | { kind: 'failed'; error: string };

export type SwitchPick = { harness: string; model: string } | { effort: string };

/**
 * Switches the thread's run for a tap in the sheet. A pick that matches the run already shown sends nothing. A 409 (another
 * machine runs the thread) comes back as `failed` with the server's words.
 */
export async function switchThreadRun(
  api: Pick<OmniApi, 'switchRun'>,
  threadId: string,
  thread: RunThread,
  harnesses: HarnessInfo[],
  pick: SwitchPick,
): Promise<SwitchOutcome> {
  const run: Run | null = runForPick(thread, harnesses, pick);
  if (!run) return { kind: 'unchanged' };
  try {
    return { kind: 'switched', thread: await api.switchRun(threadId, run) };
  } catch (e) {
    return { kind: 'failed', error: e instanceof Error && e.message ? e.message : 'Something went wrong' };
  }
}
