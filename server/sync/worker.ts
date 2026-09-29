import { kv, outbox, type OutboxRow } from '../db.ts';
import { globalSecret, listSecrets, setSecret, SYNC_SECRETS } from '../secrets.ts';
import { applyBatch, deferredCount, getHandler, registeredEntities, retryDeferred, type ApplyContext } from './apply.ts';
import { createSupabaseTransport, isoTs, isSignedOut, type Change, type SyncTransport } from './transport.ts';
import { watchNetwork, type NetworkWatch } from './network.ts';
import { automationsOwner, claimIfUnowned, type AutomationsOwner } from './owner.ts';
import { hardwareId } from './hardware.ts';
import './handlers/index.ts';

// The sync loop: push the outbox in batches, then pull what other machines pushed since the cursor and apply it.
// On start, every 60s, soon after a local write, when Realtime says another machine pushed or its link comes
// back, when the network comes back, and on syncNow() (POST /api/sync/now, which the apps call on wake and focus).
// A failure backs off exponentially and keeps the outbox; the next success clears it.

export interface SyncWorkerOptions {
  transport: SyncTransport;
  /** Used only the first time sync is set up on this machine; the stored id wins after that. */
  machineId?: string;
  /** How often to sync once started. Default 60s. */
  intervalMs?: number;
  /** Sync this long after a local write. Unset: writes wait for the timer or a syncNow. */
  autoPushMs?: number;
  /** Changes per push and per pull. Default 200. */
  batchSize?: number;
  /** Sync soon when this says the network is back. startSync passes watchNetwork; tests pass a fake. */
  network?: NetworkWatch;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  applied: number;
  skipped: number;
  /** Remote changes waiting in sync_deferred after this sync. */
  deferred: number;
  error?: string;
}

export interface SyncStatus {
  /** Credentials are set (or, in tests, a transport was given). */
  configured: boolean;
  /** kv `sync.enabled` is not false. */
  enabled: boolean;
  /** A sync is in flight. */
  running: boolean;
  machineId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  /** The relay refused this machine's refresh token: it takes a new sign-in, not a retry. */
  signedOut: boolean;
  /** Failed syncs in a row. */
  failures: number;
  nextSyncAt: string | null;
  /** Outbox rows waiting to push. */
  pending: number;
  /** Outbox rows for an entity with no handler yet. They push once one is registered. */
  held: number;
  /** Remote changes that could not apply yet. */
  deferred: number;
  cursor: number;
  /** Which Mac runs the scheduled automations (server/sync/owner.ts). */
  automations: AutomationsOwner;
}

export interface SyncWorker {
  readonly machineId: string;
  /** The relay it syncs through. server/sync/files.ts moves thread and session files over it too. */
  readonly transport: SyncTransport;
  /** Sync now. Joins a sync in flight, then runs one more so the caller's writes are in it. Never rejects. */
  syncNow(): Promise<SyncResult>;
  /** Sync within ms, coalescing calls. */
  syncSoon(ms?: number): void;
  start(): void;
  /** Stop syncing. A sync in flight finishes its request but applies nothing more and leaves the cursor alone. */
  stop(): void;
  /** Resolves once no sync is in flight: after stop, before another worker takes over the cursor and the outbox. */
  settled(): Promise<void>;
  status(): SyncStatus;
}

/** Delay before the next try after `failures` failed syncs in a row: 5s, 10s, 20s … up to 15 min. */
export const backoffMs = (failures: number, base = 5_000, max = 15 * 60_000) =>
  Math.min(max, base * 2 ** Math.max(0, failures - 1));

/**
 * One change per row in the batch, in the order each first appears. Repeat writes to a row become one change
 * with the row as it is now, the latest ts and the last op. A row that is gone by now is dropped.
 */
function toChanges(rows: OutboxRow[], machineId: string): Change[] {
  const groups = new Map<string, { entity: OutboxRow['entity']; entity_id: string; op: OutboxRow['op']; ts: string }>();
  for (const r of rows) {
    const key = `${r.entity}\u0000${r.entity_id}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { entity: r.entity, entity_id: r.entity_id, op: r.op, ts: r.ts });
    else (g.op = r.op), (g.ts = r.ts > g.ts ? r.ts : g.ts);
  }
  const out: Change[] = [];
  for (const g of groups.values()) {
    const data = g.op === 'delete' ? null : (getHandler(g.entity)!.serialize(g.entity_id) ?? null);
    if (g.op === 'upsert' && data === null) continue;
    out.push({ machine_id: machineId, entity: g.entity, entity_id: g.entity_id, op: g.op, data, ts: g.ts });
  }
  return out;
}

const syncedListeners = new Set<(worker: SyncWorker) => void>();
/** Called after each sync that went through, with the worker that ran it. Returns a function that removes it. */
export function onSynced(fn: (worker: SyncWorker) => void): () => void {
  syncedListeners.add(fn);
  return () => syncedListeners.delete(fn);
}

export function createSyncWorker(opts: SyncWorkerOptions): SyncWorker {
  const { transport } = opts;
  const copiedFrom = outbox.machineId();
  const machineId = outbox.arm(opts.machineId, hardwareId());
  if (copiedFrom && copiedFrom !== machineId)
    console.warn(`[sync] this data folder was copied from another Mac (sync id ${copiedFrom}): this Mac is now ${machineId} and pulls the history again`);
  const ctx: ApplyContext = { machineId };
  const batch = opts.batchSize ?? 200;
  const interval = opts.intervalMs ?? 60_000;

  let started = false;
  /** Set by stop, cleared by start. A sync in flight checks it after each request it waits on. */
  let stopped = false;
  let failures = 0;
  let lastError: string | null = null;
  let signedOut = false;
  let lastSyncAt: string | null = null;
  let nextAt: number | null = null;
  let timer: NodeJS.Timeout | undefined;
  let soon: NodeJS.Timeout | undefined;
  let unsubscribe: (() => void) | undefined;
  let offNetwork: (() => void) | undefined;
  let inflight: Promise<SyncResult> | null = null;
  let queued: Promise<SyncResult> | null = null;

  async function push(): Promise<number> {
    let pushed = 0;
    for (;;) {
      if (stopped) return pushed;
      const rows = outbox.pending(batch, registeredEntities());
      if (!rows.length) return pushed;
      const changes = toChanges(rows, machineId);
      if (changes.length) await transport.push(changes);
      outbox.ack(rows.map((r) => r.id));
      pushed += changes.length;
      if (rows.length < batch) return pushed;
    }
  }

  async function pull(result: SyncResult) {
    for (;;) {
      const after = kv.get<number>('sync.cursor') ?? 0;
      const changes = await transport.pull({ after, excludeMachine: machineId, limit: batch });
      // Stopped while this pull was out (a sign-out, or a move to another relay that reset the cursor): these
      // changes and this cursor belong to the sync that is over.
      if (stopped) return;
      if (!changes.length) break;
      const stats = applyBatch(changes.map((c) => ({ ...c, ts: isoTs(c.ts) })), ctx);
      result.pulled += changes.length;
      result.applied += stats.applied;
      result.skipped += stats.skipped;
      const last = Math.max(...changes.map((c) => c.seq));
      if (last <= after) break;
      kv.set('sync.cursor', last);
      if (changes.length < batch) break;
    }
    const retried = retryDeferred(ctx);
    result.applied += retried.applied;
    result.skipped += retried.skipped;
  }

  async function cycle(): Promise<SyncResult> {
    const result: SyncResult = { pushed: 0, pulled: 0, applied: 0, skipped: 0, deferred: 0 };
    try {
      result.pushed = await push();
      await pull(result);
      // Everything the relay had is in: an owner another Mac set would be here by now. A claim goes out at once.
      if (!stopped && claimIfUnowned()) result.pushed += await push();
      failures = 0;
      lastError = null;
      signedOut = false;
      lastSyncAt = new Date().toISOString();
      if (!stopped) for (const fn of syncedListeners) fn(worker);
    } catch (err) {
      failures++;
      lastError = (err as Error)?.message ?? String(err);
      signedOut = isSignedOut(err);
      result.error = lastError;
      console.error(`[sync] ${lastError} (try ${failures}, next in ${Math.round(backoffMs(failures) / 1000)}s)`);
    }
    result.deferred = deferredCount();
    schedule();
    return result;
  }

  function schedule() {
    clearTimeout(timer);
    nextAt = null;
    if (!started) return;
    const delay = failures ? backoffMs(failures) : interval;
    nextAt = Date.now() + delay;
    timer = setTimeout(() => void worker.syncNow(), delay);
    timer.unref();
  }

  const worker: SyncWorker = {
    machineId,
    transport,
    syncNow() {
      if (!inflight) return (inflight = cycle().finally(() => (inflight = null)));
      return (queued ??= inflight.then(() => {
        queued = null;
        return worker.syncNow();
      }));
    },
    syncSoon(ms = 1_000) {
      if (soon) return;
      soon = setTimeout(() => {
        soon = undefined;
        void worker.syncNow();
      }, ms);
      soon.unref();
    },
    start() {
      if (started) return;
      started = true;
      stopped = false;
      unsubscribe = transport.subscribe?.(machineId, () => worker.syncSoon(300));
      // A second or so, so the Wi-Fi's DNS and routes settle first. A failure still backs off as usual.
      offNetwork = opts.network?.(() => worker.syncSoon(1_000));
      if (opts.autoPushMs !== undefined) outbox.onRecord(() => worker.syncSoon(opts.autoPushMs));
      void worker.syncNow();
    },
    stop() {
      started = false;
      stopped = true;
      clearTimeout(timer);
      clearTimeout(soon);
      soon = undefined;
      nextAt = null;
      unsubscribe?.();
      unsubscribe = undefined;
      offNetwork?.();
      offNetwork = undefined;
      outbox.onRecord(null);
    },
    async settled() {
      while (inflight || queued) await (queued ?? inflight)!.catch(() => {});
    },
    status() {
      return {
        ...baseStatus(),
        configured: true,
        running: !!inflight,
        machineId,
        lastSyncAt,
        lastError,
        signedOut,
        failures,
        nextSyncAt: nextAt ? new Date(nextAt).toISOString() : null,
      };
    },
  };
  return worker;
}

// ---------- the server's worker ----------

let active: SyncWorker | null = null;

/** The worker the server runs, or null while sync is off. startSync sets it; tests can too. */
export const activeWorker = () => active;
/**
 * Make w the server's worker, stopping the one before. Resolves once that one's sync in flight is over, so two
 * workers never push the same outbox rows or write the cursor at once: start w only after it resolves.
 */
export function setActiveWorker(w: SyncWorker | null): Promise<void> {
  const prev = active;
  active = w;
  if (!prev || prev === w) return Promise.resolve();
  prev.stop();
  return prev.settled();
}

/** Sync now, for anything that wants its change on the other Mac sooner. Null when sync is off. */
export async function syncNow(): Promise<SyncResult | null> {
  return active ? active.syncNow() : null;
}

/** True when all three sync credentials are named in the secrets table. Reads names only, never the Keychain. */
export function syncConfigured(): boolean {
  const names = new Set(listSecrets().filter((s) => s.scope === 'global').map((s) => s.name));
  return Object.values(SYNC_SECRETS).every((n) => names.has(n));
}

function baseStatus(): SyncStatus {
  const counts = outbox.counts(registeredEntities());
  return {
    configured: syncConfigured(),
    enabled: kv.get<boolean>('sync.enabled') !== false,
    running: false,
    machineId: outbox.machineId(),
    lastSyncAt: null,
    lastError: null,
    signedOut: false,
    failures: 0,
    nextSyncAt: null,
    pending: counts.pending,
    held: counts.held,
    deferred: deferredCount(),
    cursor: kv.get<number>('sync.cursor') ?? 0,
    automations: automationsOwner(),
  };
}

export const syncStatus = (): SyncStatus => (active ? active.status() : baseStatus());

/**
 * Boot: start syncing when the credentials are in the Keychain and kv `sync.enabled` is not false.
 * With no credentials this reads nothing from the Keychain, arms nothing, and the server runs as it did before sync.
 */
export async function startSync(): Promise<SyncWorker | null> {
  if (!syncConfigured() || kv.get<boolean>('sync.enabled') === false) return null;
  const [url, anonKey, refreshToken] = await Promise.all([
    globalSecret(SYNC_SECRETS.url),
    globalSecret(SYNC_SECRETS.anonKey),
    globalSecret(SYNC_SECRETS.refreshToken),
  ]);
  if (!url || !anonKey || !refreshToken) return null;
  const transport = createSupabaseTransport({
    url,
    anonKey,
    refreshToken,
    onRefreshToken: (token) => setSecret('global', SYNC_SECRETS.refreshToken, token),
  });
  const w = createSyncWorker({ transport, autoPushMs: 2_000, network: watchNetwork });
  await setActiveWorker(w);
  // Replaced again while the last one finished (a second sign-in): that one starts instead.
  if (activeWorker() !== w) return null;
  w.start();
  console.log(`[sync] on, machine ${w.machineId}`);
  return w;
}
