// /api/crew: the crew roles, and their edits from the clients (crew-store.ts).
// An agent thread names itself on every call (CALLER_HEADER), and a role is a prompt every later thread of it runs
// with, so an agent's write goes through the crew guard (crew-guard.ts): only the Conductor saves or resets a role, and
// only after Ben agreed in its thread. Ben's own clients name no thread.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { CALLER_HEADER } from './automation-guard.ts';
import { crewRefusal, type CrewWrite } from './crew-guard.ts';
import { listCrew } from './crew.ts';
import { crewDetail, crewRunProblem, crewSave, deleteCrew, resetCrew, saveCrew, setCrewHidden, type CrewSaveContext } from './crew-store.ts';
import { channels } from './db.ts';
import { getCatalog } from './harness/catalog-service.ts';

export const crewApi = new Hono();

// Hidden roles only with ?all=1 (Settings): pickers and the Conductor offer only the rest.
crewApi.get('/crew', (c) => {
  const cat = getCatalog();
  const all = c.req.query('all') === '1';
  return c.json(
    listCrew()
      .filter((r) => all || !r.hidden)
      .map((r) => ({ ...r, error: r.error ?? crewRunProblem(r, cat) })),
  );
});

crewApi.get('/crew/:id', (c) => {
  const detail = crewDetail(c.req.param('id'));
  return detail ? c.json(detail) : c.json({ error: 'No crew role with this id.' }, 404);
});

const context = (): CrewSaveContext => ({ catalog: getCatalog(), channelExists: (id) => !!channels.get(id) });

crewApi.post('/crew', async (c) => {
  const refused = guard(c, 'save');
  if (refused) return refused;
  const body = await c.req.json().catch(() => null);
  const id = z.object({ id: z.string() }).safeParse(body);
  if (!id.success) return c.json({ error: 'Give the role an id.' }, 400);
  const { id: _, ...rest } = body as { id: string };
  return write(c, (save) => saveCrew(id.data.id, save, context(), { create: true }), rest, 201);
});

crewApi.put('/crew/:id', async (c) => write(c, (save) => saveCrew(c.req.param('id'), save, context()), await c.req.json().catch(() => null)));

crewApi.delete('/crew/:id', (c) =>
  guard(c, 'delete') ??
  run(c, () => {
    deleteCrew(c.req.param('id'));
    return { ok: true };
  }),
);

crewApi.post('/crew/:id/reset', (c) => guard(c, 'reset') ?? run(c, () => resetCrew(c.req.param('id'))));

crewApi.post('/crew/:id/hidden', async (c) => {
  const refused = guard(c, 'hide');
  if (refused) return refused;
  const parsed = z.object({ hidden: z.boolean() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Send { hidden: true } or { hidden: false }.' }, 400);
  return run(c, () => setCrewHidden(c.req.param('id'), parsed.data.hidden));
});

/** A 403 for an agent thread's write the crew guard refuses. Ben's own clients name no thread. */
function guard(c: Context, write: CrewWrite) {
  const refusal = crewRefusal(c.req.header(CALLER_HEADER), write);
  return refusal ? c.json({ error: refusal }, 403) : null;
}

function write(c: Context, save: (body: z.infer<typeof crewSave>) => unknown, body: unknown, ok: 200 | 201 = 200) {
  const refused = guard(c, 'save');
  if (refused) return refused;
  const parsed = crewSave.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid crew role' }, 400);
  return run(c, () => save(parsed.data), ok);
}

/** A refused write's message and status (crew-store.ts sets one), else a 500. */
function run(c: Context, fn: () => unknown, ok: 200 | 201 = 200) {
  try {
    return c.json(fn() as object, ok);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 404 || status === 409) return c.json({ error: (err as Error).message }, status);
    throw err;
  }
}
