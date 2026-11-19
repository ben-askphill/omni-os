// /harnesses/custom: list, add, change and remove custom harnesses (harness/custom.ts). Reads are open to every client.
// A write decides where briefs go and which secret travels to which server, so it is Ben's only (decision F9 of
// docs/plans/2026-11-18-connect-an-agent.md):
// - an agent thread, known by its own token (automation-guard.ts callerOf), never writes one;
// - and only the install's token or a session paired with it may (request-guard.ts shellAllowed), as for a shell: a
//   stolen Google or Connect session could otherwise point a harness at its own server and name any secret as its key.
import { Hono, type Context } from 'hono';
import { callerOf } from './automation-guard.ts';
import { checkCustomHarness, getCatalog } from './harness/catalog-service.ts';
import { customHarnesses } from './harness/custom.ts';
import { customHarnessSave, deleteCustomHarness, saveCustomHarness } from './harness/custom-store.ts';
import { userName } from './profile.ts';
import { shellAllowed } from './request-guard.ts';

export const customHarnessApi = new Hono();

/** Every custom harness here, as its file says, with what the catalog last found. Never a key. */
customHarnessApi.get('/harnesses/custom', (c) => {
  const cat = getCatalog();
  return c.json(customHarnesses().map((h) => ({ ...h, catalog: cat.harnesses.find((x) => x.id === h.id) ?? null })));
});

customHarnessApi.post('/harnesses/custom/:slug', (c) => write(c, true));
customHarnessApi.put('/harnesses/custom/:slug', (c) => write(c, false));

customHarnessApi.delete('/harnesses/custom/:slug', (c) => {
  const refusal = guard(c);
  if (refusal) return refusal;
  try {
    deleteCustomHarness(c.req.param('slug'));
    return c.json({ deleted: true });
  } catch (err) {
    return failed(c, err);
  }
});

/** A 403 for a write that is not Ben's own. */
function guard(c: Context) {
  if (callerOf(c)) return c.json({ error: `Only ${userName()} adds, changes or removes custom harnesses.` }, 403);
  if (!shellAllowed(c))
    return c.json({ error: "A custom harness sends a secret from this machine to its server, so changing one needs the install's token or a browser paired with it." }, 403);
  return null;
}

/** Save, then probe the harness at once, so the answer says whether it is ready. */
async function write(c: Context, create: boolean) {
  const refusal = guard(c);
  if (refusal) return refusal;
  const parsed = customHarnessSave.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid custom harness' }, 400);
  try {
    const harness = saveCustomHarness(c.req.param('slug') ?? '', parsed.data, { create });
    return c.json({ ...harness, catalog: await checkCustomHarness(harness.id) }, create ? 201 : 200);
  } catch (err) {
    return failed(c, err);
  }
}

function failed(c: Context, err: unknown) {
  const status = (err as { status?: number }).status;
  if (status === 400 || status === 404 || status === 409) return c.json({ error: (err as Error).message }, status);
  throw err;
}
