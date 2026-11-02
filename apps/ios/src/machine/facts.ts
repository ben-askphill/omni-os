import type { OmniApi, SyncStatus } from '@omni/client-core';
import type { Device } from '@omni/shared/handoff.ts';
import { handoffTargets, syncCarries, threadMachine, type Holding, type ThreadMachine } from '@omni/shared/thread-machine.ts';

export type FactsApi = Pick<OmniApi, 'syncStatus' | 'devices' | 'status'>;

/** What the picker needs from the server besides the thread: whether sync carries a handoff, who the other machines are, and this one's name. */
export interface MachineFacts {
  sync: SyncStatus;
  /** Null while sync does not carry, so there is nobody to ask. */
  devices: Device[] | null;
  hereName: string | null;
}

/**
 * Asks only for what the answer before it allows: the machine list when sync carries, this machine's name alongside.
 * Never rejects. A server that cannot answer (an older one without these routes, or no network) gives null, which
 * the picker reads as nothing to pick.
 */
export async function loadMachineFacts(api: FactsApi): Promise<MachineFacts | null> {
  try {
    const sync = await api.syncStatus();
    if (!syncCarries(sync)) return { sync, devices: null, hereName: null };
    const [devices, status] = await Promise.all([api.devices(), api.status().catch(() => null)]);
    return { sync, devices, hereName: status?.device?.name ?? null };
  } catch {
    return null;
  }
}

/** The thread's picker: null until the facts are in, and whenever there is nothing to pick. */
export function machineOf(facts: MachineFacts | null, held: Holding, now?: number): ThreadMachine | null {
  const targets = handoffTargets({ ...held, sync: facts?.sync, devices: facts?.devices });
  const running = held.status === 'running' || held.status === 'queued';
  return threadMachine({ targets, takeover: held.takeover, handoff: held.handoff, running, hereName: facts?.hereName }, now);
}
