// /api/sync: the sync status, a manual sync, and sign-in from Settings. Its own app so tests can call it without starting the server.
import { Hono, type Context } from 'hono';
import { kv, outbox } from './db.ts';
import { claimAutomations, OWNER_KEY } from './sync/owner.ts';
import { currentRecords, deviceRecord, deviceRecords } from './sync/devices.ts';
import { fingerprintOf, keyring } from './sync/keyring.ts';
import { signPublicKey } from './sync/sign-key.ts';
import { clearHeld, heldActions, refusedChanges } from './sync/verify.ts';
import { pathMap } from './sync/paths.ts';
import { checkPathMap, checkRelayUrl, defaultSetupDeps, disableSync, enableSync, pollRelaySignIn, SetupError, startRelaySignIn, type SetupDeps } from './sync/setup.ts';
import { activeWorker, syncNow, syncStatus } from './sync/worker.ts';

const body = async (c: Context): Promise<unknown> => c.req.json().catch(() => ({}));

/** The routes, with the secret store, the relay, Clerk and the worker start swappable for tests. */
export function createSyncApi(deps: SetupDeps = defaultSetupDeps) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof SetupError) return c.json({ error: err.message }, err.status);
    console.error('[sync]', err.message);
    return c.json({ error: err.message }, 500);
  });

  /** Whether sync is on, when it last ran, what is waiting either way, and the last error. */
  app.get('/status', (c) => c.json(syncStatus()));

  /** Push and pull now. 409 while sync is off; 502 when the relay failed, with the error and the status. */
  app.post('/now', async (c) => {
    const result = await syncNow();
    if (!result) return c.json({ error: 'sync is not configured' }, 409);
    const out = { ...result, status: syncStatus() };
    return result.error ? c.json({ ...out, error: result.error }, 502) : c.json(out);
  });

  /**
   * Start signing in to the relay at {url} with Google: checks the relay trusts this install's Clerk app, then
   * answers the code to show and the page to approve it on, like /api/auth/google/start.
   */
  app.post('/setup', async (c) => c.json(await startRelaySignIn(checkRelayUrl(await body(c)), deps)));

  /**
   * One poll of that sign-in, {flow, secret}. Once Clerk approves, this machine gets its relay token and sync turns
   * on: {state: 'signed_in', email, relayChanged, status}. Else pending, refused (with why), denied or expired.
   */
  app.post('/setup/poll', async (c) => {
    const b = (await body(c)) as { flow?: unknown; secret?: unknown };
    if (typeof b?.flow !== 'string' || typeof b.secret !== 'string') return c.json({ error: 'Send {flow, secret}' }, 400);
    const r = await pollRelaySignIn(b.flow, b.secret, deps);
    if (r.state === 'relay_signed_in') return c.json({ state: 'signed_in', email: r.email, relayChanged: r.relayChanged, status: syncStatus() });
    if (r.state === 'signed_in' || r.state === 'linked') return c.json({ error: 'Not a relay sign-in' }, 400);
    return c.json(r);
  });

  /** Pause syncing. {forget: true} also removes the credentials from the secret store. */
  app.post('/disable', async (c) => {
    const b = (await body(c)) as { forget?: unknown };
    await disableSync({ forget: b?.forget === true }, deps);
    return c.json({ ok: true, status: syncStatus() });
  });

  /** Resume with the stored credentials. 409 before a sign-in. */
  app.post('/enable', async (c) => {
    await enableSync(deps);
    return c.json({ ok: true, status: syncStatus() });
  });

  /** Choose the synced execution owner. An empty body keeps the legacy claim-this-machine action. */
  app.post('/automations-owner', async (c) => {
    const raw = await body(c);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return c.json({ error: 'Expected an object' }, 400);
    const b = raw as { device?: unknown };
    if (b.device !== undefined && (typeof b.device !== 'string' || !b.device.trim()))
      return c.json({ error: 'device must be a machine id or here' }, 400);
    const target = b.device;
    if (target && target !== 'here' && target !== outbox.machineId()) {
      if (!outbox.machineId()) return c.json({ error: 'Sync is not set up on this machine' }, 409);
      if (!deviceRecord(target)) return c.json({ error: 'Unknown synced machine' }, 400);
      kv.set(OWNER_KEY, target);
      return c.json({ ok: true, status: syncStatus() });
    }
    if (!claimAutomations()) return c.json({ error: 'Sync is not set up on this machine' }, 409);
    return c.json({ ok: true, status: syncStatus() });
  });

  /** This Mac's path map (kv sync.path_map): where another Mac's folders live here. */
  app.get('/path-map', (c) => c.json({ map: pathMap() }));

  /**
   * The synced machines with their signing keys (sync/keyring.ts), this one first. `fingerprint`: the key the machine
   * announces now; `pinnedFingerprint`: the one this machine checks its changes with. `keyChanged`: they differ (or
   * its seal key does). `trusted`: it may make this machine act, which a paired machine is from its first pinned key.
   * `held`: its actions waiting here for a confirm. A changed key, or a machine whose only key came unsigned, shows a
   * button that calls POST /devices/:id/confirm-key.
   */
  app.get('/devices', async (c) => c.json(await syncDevices()));

  /**
   * Confirm a machine's new key, or trust one that is not trusted yet: pin the keys it announces now and let its commands, assignments, update asks, owner claims and
   * secrets apply, the held ones with the sync this starts. 404 for a machine this one has not seen, or one already
   * trusted with no new key waiting; 409 for one that has not sent a signed key yet.
   */
  app.post('/devices/:id/confirm-key', (c) => {
    const id = c.req.param('id');
    if (id === outbox.machineId() || (!deviceRecord(id) && !keyring.get(id))) return c.json({ error: 'Nothing waits for confirmation for that machine' }, 404);
    const confirmed = keyring.confirm(id);
    if (!keyring.get(id)?.signKey) return c.json({ error: `${deviceRecord(id)?.name ?? id} has not sent a signed key yet. Update Omni there and let it sync once.` }, 409);
    const trusted = keyring.trust(id);
    if (!confirmed && !trusted) return c.json({ error: 'Nothing waits for confirmation for that machine' }, 404);
    clearHeld(id);
    void activeWorker()?.syncNow();
    return c.json({ ok: true });
  });

  /** Synced changes refused for their signature or a path, ones applied without a valid signature, and actions waiting for Trust, newest first. */
  app.get('/refused', (c) => {
    const limit = Number(c.req.query('limit') ?? 50);
    return c.json(refusedChanges(Number.isFinite(limit) ? limit : 50));
  });
  app.put('/path-map', async (c) => {
    const map = checkPathMap(await body(c));
    kv.set('sync.path_map', map);
    return c.json({ map });
  });

  return app;
}

export const syncApi = createSyncApi();

/** GET /api/sync/devices: one synced machine and its signing key. */
export interface SyncDevice {
  id: string;
  name: string;
  /** This machine. */
  current: boolean;
  fingerprint: string | null;
  pinnedFingerprint: string | null;
  keyChanged: boolean;
  /** It may make this machine act: trusted with its first pinned key, or a key Ben confirmed. Always true for this machine. */
  trusted: boolean;
  /** Its commands, assignments, update asks, owner claims and secrets this machine holds until Ben confirms. */
  held: number;
}

export async function syncDevices(): Promise<SyncDevice[]> {
  const self = outbox.machineId();
  if (!self) return [];
  const own = await signPublicKey().catch(() => null);
  const records = currentRecords(deviceRecords());
  const pins = keyring.list();
  const held = new Map<string, number>();
  for (const h of heldActions()) held.set(h.machine, (held.get(h.machine) ?? 0) + h.count);
  const ids = [...new Set([self, ...records.map((r) => r.id), ...pins.filter((p) => p.seenSignKey || p.seenSealKey || !keyring.trusted(p.machine)).map((p) => p.machine)])];
  return ids.map((id) => {
    const rec = records.find((r) => r.id === id) ?? deviceRecord(id);
    if (id === self) {
      const fp = fingerprintOf(own ?? rec?.signKey);
      return { id, name: rec?.name ?? id, current: true, fingerprint: fp, pinnedFingerprint: fp, keyChanged: false, trusted: true, held: 0 };
    }
    const pin = pins.find((p) => p.machine === id);
    return {
      id,
      name: rec?.name ?? id,
      current: false,
      fingerprint: fingerprintOf(pin?.seenSignKey ?? rec?.signKey ?? pin?.signKey),
      pinnedFingerprint: fingerprintOf(pin?.signKey),
      keyChanged: !!(pin?.seenSignKey || pin?.seenSealKey),
      trusted: keyring.trusted(id),
      held: held.get(id) ?? 0,
    };
  });
}
