import { Hono } from 'hono';
import { updater } from './update.ts';
import { fleetView, reportDesktop, requestFleet } from './update-fleet.ts';

// The Update button (update.ts): how far this server is behind main, and the one click that brings it level. And under
// /fleet, every synced machine's update at once (update-fleet.ts).
export const updateApi = new Hono();

updateApi.get('/', (c) => c.json(updater.view()));

/** Fetches origin's main now, instead of waiting for the next check. */
updateApi.post('/check', async (c) => c.json(await updater.check()));

/** Waits for running turns, updates to main, rebuilds the Web UI and restarts. 409 without an app to restart it. */
updateApi.post('/', (c) => {
  const started = updater.apply();
  if (!started.ok) return c.json({ error: started.error }, 409);
  return c.json(updater.view(), 202);
});

/** Ends the wait for running turns. */
updateApi.post('/cancel', (c) => c.json({ ok: updater.cancel() }));

updateApi.post('/dismiss', (c) => {
  updater.dismiss();
  return c.json(updater.view());
});

/** Every synced machine's update, as this one sees it. */
updateApi.get('/fleet', async (c) => c.json(await fleetView()));

/** Asks machines to check, download or update. 202 with the list as it stands and who was left out and why; 400 on a body that is not a FleetRequest. */
updateApi.post('/fleet', async (c) => c.json(await requestFleet(await c.req.json().catch(() => null)), 202));

/** The desktop app's main process reports its updater and gets the command to carry out next. */
updateApi.post('/desktop', async (c) => c.json(reportDesktop(await c.req.json().catch(() => null))));
