import type { Thread } from '@omni/client-core';
import type { HandoffView } from '@omni/shared/handoff.ts';

import { runMachineCommand, type MachineApi, type MachineCommand, type MachineOutcome } from './command';
import type { MachineEvent } from './state';

export interface PerformDeps {
  api: MachineApi;
  /** Puts the answer into the open thread (`hub.applyHandoff`) before the stream repeats it. */
  apply: (thread: Thread, handoff: HandoffView | null) => void;
  dispatch: (event: MachineEvent) => void;
}

/** One command from tap to answer: the request state, the call, and the open thread taking the result. */
export async function performMachineCommand(deps: PerformDeps, threadId: string, command: MachineCommand): Promise<MachineOutcome> {
  deps.dispatch({ type: 'send', command: command.type });
  const outcome = await runMachineCommand(deps.api, threadId, command);
  if (outcome.ok) {
    deps.apply(outcome.thread, outcome.handoff);
    deps.dispatch({ type: 'settle' });
  } else {
    deps.dispatch({ type: 'fail', error: { command: command.type, message: outcome.error, kind: outcome.kind } });
  }
  return outcome;
}
