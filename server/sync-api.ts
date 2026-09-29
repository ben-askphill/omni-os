// /api/sync: the sync status and a manual sync. Its own app so tests can call it without starting the server.
import { Hono } from 'hono';
import { syncNow, syncStatus } from './sync/worker.ts';

export const syncApi = new Hono();

/** Whether sync is on, when it last ran, what is waiting either way, and the last error. */
syncApi.get('/status', (c) => c.json(syncStatus()));

/** Push and pull now. 409 while sync is off; 502 when the relay failed, with the error and the status. */
syncApi.post('/now', async (c) => {
  const result = await syncNow();
  if (!result) return c.json({ error: 'sync is not configured' }, 409);
  const body = { ...result, status: syncStatus() };
  return result.error ? c.json({ ...body, error: result.error }, 502) : c.json(body);
});
