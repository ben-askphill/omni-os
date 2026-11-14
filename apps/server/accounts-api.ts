// GET /api/accounts: which account each harness is signed in to, on this machine and on every synced one, with the
// switches not acknowledged yet. `?refresh=1` reads this machine again. POST /api/accounts/seen acknowledges a
// switch. GET /api/accounts/threads/:id is the account a thread last ran as. No route returns more than an account's
// label, org and plan (harness-accounts.ts).
import { Hono } from 'hono';
import { acknowledgeSwitch, accountsView, threadAccount } from './harness-accounts.ts';
import { threads } from './db.ts';

export const accountsApi = new Hono();

const fail = (e: unknown) => ({ error: (e as Error).message, status: ((e as { status?: number }).status ?? 500) as 400 | 404 | 500 });

accountsApi.get('/', async (c) => c.json(await accountsView({ refresh: c.req.query('refresh') === '1' })));

accountsApi.post('/seen', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { machine?: unknown; harness?: unknown } | null;
  if (typeof body?.machine !== 'string' || typeof body.harness !== 'string') return c.json({ error: 'machine and harness are required' }, 400);
  try {
    return c.json(await acknowledgeSwitch(body.machine, body.harness));
  } catch (e) {
    const f = fail(e);
    return c.json({ error: f.error }, f.status);
  }
});

accountsApi.get('/threads/:id', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'Not found' }, 404);
  return c.json({ account: threadAccount(id) });
});
