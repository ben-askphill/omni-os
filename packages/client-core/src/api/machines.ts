import type { Device, HandoffView } from '@omni/shared/handoff.ts';
import { apiPath, type HttpClient } from '../http.ts';
import type { Thread } from './threads.ts';

/** GET /sync/status: whether this machine syncs, and what is waiting. `configured`, `enabled` and `signedOut` decide whether a handoff can be offered. */
export interface SyncStatus {
  /** Credentials are set. */
  configured: boolean;
  /** Not paused. */
  enabled: boolean;
  /** A sync is in flight. */
  running: boolean;
  machineId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  /** The relay refused this machine's token: it takes a new sign-in, not a retry. */
  signedOut: boolean;
  /** Failed syncs in a row. */
  failures: number;
  nextSyncAt: string | null;
  /** Outbox rows waiting to push. */
  pending: number;
  held: number;
  legacyRelay: boolean;
  deferred: number;
  cursor: number;
  /** Which machine runs the scheduled automations. */
  automations: { owner: string | null; isThisMac: boolean };
}

/** What POST /threads/:id/handoff, /takeover and /handoff/cancel answer: the thread, and its handoff as it stands. */
export interface HandoffAnswer {
  thread: Thread;
  handoff: HandoffView | null;
}

export function machinesApi(http: HttpClient) {
  return {
    syncStatus: () => http.request<SyncStatus>('GET', apiPath`/sync/status`),
    /** The other synced machines, never this one. Empty while sync is off. */
    devices: () => http.request<Device[]>('GET', apiPath`/devices`),
    /**
     * Hands the thread to a synced machine (`to` is its device id). A running turn stops and continues there; an idle
     * thread goes between turns. Answers once the offer is written, and the thread's `handoff` follows. A 409 says why not.
     */
    handOff: (threadId: string, to: string) => http.request<HandoffAnswer>('POST', apiPath`/threads/${threadId}/handoff`, { body: { to } }),
    /** Asks the machine that holds the thread to hand it to this one. Answers like a handoff, with the request as the handoff. A 409 says why not. */
    takeOver: (threadId: string) => http.request<HandoffAnswer>('POST', apiPath`/threads/${threadId}/takeover`, { body: {} }),
    /** Cancels this machine's Take over before it has the thread, or a handoff from it before the other machine picks the thread up. */
    cancelHandoff: (threadId: string) => http.request<HandoffAnswer>('POST', apiPath`/threads/${threadId}/handoff/cancel`, { body: {} }),
  };
}
