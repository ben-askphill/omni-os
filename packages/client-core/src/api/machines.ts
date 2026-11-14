import type { Device, HandoffView } from '@omni/shared/handoff.ts';
import type { FleetRequest, FleetResult, FleetView } from '@omni/shared/update-fleet.ts';
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

/** A synced machine and its signing key, as this machine pinned it. `keyChanged`: it now signs with a key other than the pinned one. */
export interface SyncDeviceKey {
  id: string;
  name: string;
  /** The machine the server runs on. */
  current: boolean;
  /** The key it signs with now. Null until it has sent one. */
  fingerprint: string | null;
  /** The key this machine pinned at pairing. Null until one was pinned. */
  pinnedFingerprint: string | null;
  keyChanged: boolean;
  /** Ben trusts it to make this machine act. Missing on a server from before machines needed trusting. */
  trusted?: boolean;
}

/** A synced change this machine refused to apply, and why. */
export interface RefusedChange {
  id: string | number;
  at: string;
  /** The machine the change said it came from. */
  machine: string;
  entity: string;
  entityId: string;
  reason: string;
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
    /** Update all machines: every synced machine with where its update stands (apps/server/update-fleet.ts). */
    updateFleet: () => http.request<FleetView>('GET', apiPath`/update/fleet`),
    /** Asks machines to check, download or update. Every machine when `machines` is left out; `force` asks offline ones too. */
    askFleet: (request: FleetRequest) => http.request<FleetResult>('POST', apiPath`/update/fleet`, { body: request }),
    /** Every synced machine with its signing-key fingerprint. A 404 means the server predates signed sync. */
    syncDevices: () => http.request<SyncDeviceKey[]>('GET', apiPath`/sync/devices`),
    /** Pins the key a machine signs with now, after it was reinstalled or paired again. */
    confirmSyncKey: (id: string) => http.request<{ ok: true }>('POST', apiPath`/sync/devices/${id}/confirm-key`, { body: {} }),
    /** Synced changes this machine refused, newest first. A 404 means the server predates signed sync. */
    refusedChanges: (limit = 50) => http.request<RefusedChange[]>('GET', apiPath`/sync/refused`, { query: { limit } }),
    cancelHandoff: (threadId: string) => http.request<HandoffAnswer>('POST', apiPath`/threads/${threadId}/handoff/cancel`, { body: {} }),
  };
}
