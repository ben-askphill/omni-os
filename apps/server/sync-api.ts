// /api/sync: the sync status, a manual sync, and sign-in from Settings. Its own app so tests can call it without starting the server.
import { Hono, type Context } from 'hono';
import { kv } from './db.ts';
import { claimAutomations } from './sync/owner.ts';
import { pathMap } from './sync/paths.ts';
import { checkPathMap, checkSetup, defaultSetupDeps, disableSync, enableSync, SetupError, setupSync, type SetupDeps } from './sync/setup.ts';
import { syncNow, syncStatus } from './sync/worker.ts';

const body = async (c: Context): Promise<unknown> => c.req.json().catch(() => ({}));

/** The routes, with the Keychain, Supabase Auth and the worker start swappable for tests. */
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
   * Sign in and turn sync on: {url, anonKey, email} plus a password, or a code from the email that a first call
   * with neither sends. The password and code are never stored or logged. 401 for a refused sign-in.
   */
  app.post('/setup', async (c) => {
    const result = await setupSync(checkSetup(await body(c)), deps);
    return c.json(result.state === 'signed_in' ? { ...result, status: syncStatus() } : result);
  });

  /** Pause syncing. {forget: true} also removes the credentials from the Keychain. */
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

  /** Run the scheduled automations on this Mac from now on, and not on the other. 409 before sync is set up here. */
  app.post('/automations-owner', (c) => {
    if (!claimAutomations()) return c.json({ error: 'Sync is not set up on this Mac' }, 409);
    return c.json({ ok: true, status: syncStatus() });
  });

  /** This Mac's path map (kv sync.path_map): where another Mac's folders live here. */
  app.get('/path-map', (c) => c.json({ map: pathMap() }));
  app.put('/path-map', async (c) => {
    const map = checkPathMap(await body(c));
    kv.set('sync.path_map', map);
    return c.json({ map });
  });

  return app;
}

export const syncApi = createSyncApi();
