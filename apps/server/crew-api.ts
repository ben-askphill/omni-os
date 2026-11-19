// /api/crew: the crew roles, and their edits from the clients (crew-store.ts).
// An agent thread is known by its own token (automation-guard.ts callerOf), and a role is a prompt every later thread of it runs
// with, so an agent's write goes through the crew guard (crew-guard.ts): only the Conductor saves or resets a role,
// never its powers, and only after Ben answered in its thread. Ben's own clients name no thread.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { callerOf } from './automation-guard.ts';
import { crewRefusal, type CrewWrite } from './crew-guard.ts';
import { listCrew } from './crew.ts';
import { crewDetail, crewRunProblem, crewSave, deleteCrew, draftCrew, duplicateCrew, resetCrew, saveCrew, setCrewHidden, type CrewSave, type CrewSaveContext } from './crew-store.ts';
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

/**
 * The file a save would write and the role it makes, nothing written: `{ id?, own?, save }`. Settings' Form and
 * Markdown tabs turn into each other through it, with `own` the Markdown tab's text.
 */
crewApi.post('/crew/draft', async (c) => {
  const parsed = z.object({ id: z.string().optional(), own: z.string().max(200_000).nullable().optional(), save: crewSave }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Send { id?, own?, save }.' }, 400);
  return run(c, () => draftCrew(parsed.data.id, parsed.data.save, parsed.data.own));
});

crewApi.put('/crew/:id', async (c) => write(c, (save) => saveCrew(c.req.param('id'), save, context()), await c.req.json().catch(() => null)));

crewApi.delete('/crew/:id', (c) =>
  guard(c, 'delete') ??
  run(c, () => {
    deleteCrew(c.req.param('id'));
    return { ok: true };
  }),
);

/** A new role of the user's own with everything this one has: `{ id, name? }`. */
crewApi.post('/crew/:id/duplicate', async (c) => {
  const refused = guard(c, 'duplicate');
  if (refused) return refused;
  const parsed = z.object({ id: z.string(), name: z.string().max(80).optional() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Give the copy an id.' }, 400);
  return run(c, () => duplicateCrew(c.req.param('id'), parsed.data.id, parsed.data.name, context()), 201);
});

crewApi.post('/crew/:id/reset', (c) => guard(c, 'reset', undefined, c.req.param('id')) ?? run(c, () => resetCrew(c.req.param('id'))));

crewApi.post('/crew/:id/hidden', async (c) => {
  const refused = guard(c, 'hide');
  if (refused) return refused;
  const parsed = z.object({ hidden: z.boolean() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Send { hidden: true } or { hidden: false }.' }, 400);
  return run(c, () => setCrewHidden(c.req.param('id'), parsed.data.hidden));
});

/** A 403 for an agent thread's write the crew guard refuses. Ben's own clients name no thread. */
function guard(c: Context, write: CrewWrite, save?: CrewSave, id?: string) {
  const refusal = crewRefusal(callerOf(c), write, save, id);
  return refusal ? c.json({ error: refusal }, 403) : null;
}

function write(c: Context, save: (body: CrewSave) => unknown, body: unknown, ok: 200 | 201 = 200) {
  const refused = guard(c, 'save');
  if (refused) return refused;
  const parsed = crewSave.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid crew role' }, 400);
  return guard(c, 'save', parsed.data) ?? run(c, () => save(parsed.data), ok);
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
