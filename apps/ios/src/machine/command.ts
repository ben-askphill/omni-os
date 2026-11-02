import type { OmniApi, Thread } from '@omni/client-core';
import type { HandoffView } from '@omni/shared/handoff.ts';

import { failureOf, type Failure } from '../failure';

export type MachineApi = Pick<OmniApi, 'handOff' | 'takeOver' | 'cancelHandoff'>;

/** The three calls that move a thread between machines. */
export type MachineCommand = { type: 'handOff'; to: string } | { type: 'takeOver' } | { type: 'cancel' };

export type MachineOutcome =
  /** The server took it. Both fields go into the open thread (`hub.applyHandoff`). */
  | { ok: true; thread: Thread; handoff: HandoffView | null }
  | ({ ok: false } & Failure);

/** Sends one command. Never rejects: a refusal comes back as `ok: false` with the server's words. */
export async function runMachineCommand(api: MachineApi, threadId: string, command: MachineCommand): Promise<MachineOutcome> {
  try {
    const { thread, handoff } = await send(api, threadId, command);
    return { ok: true, thread, handoff };
  } catch (e) {
    return { ok: false, ...failureOf(e) };
  }
}

function send(api: MachineApi, threadId: string, command: MachineCommand) {
  switch (command.type) {
    case 'handOff':
      return api.handOff(threadId, command.to);
    case 'takeOver':
      return api.takeOver(threadId);
    case 'cancel':
      return api.cancelHandoff(threadId);
  }
}
