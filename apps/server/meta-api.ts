// /api/crew, /harnesses, /secrets, /automations.
import { Hono } from 'hono';
import { z } from 'zod';
import { lastRuns, loadAutomations, runAutomation, setEnabled } from './automations.ts';
import { listCrew } from './crew.ts';
import { freshCatalog, getCatalog } from './harness/catalog-service.ts';
import { validateDefaults } from './harness/resolve.ts';
import { runningByHarness } from './runner.ts';
import { deleteSecret, listSecrets, setSecret } from './secrets.ts';

export const metaApi = new Hono();

metaApi.get('/crew', (c) => {
  const cat = getCatalog();
  return c.json(
    listCrew().map((r) => ({
      ...r,
      error: r.error ?? validateDefaults({ harness: r.harness, model: r.model, effort: r.effort }, cat),
    })),
  );
});

// The harnesses with their availability, fix command, models, efforts, cap and running count.
// A harness that is down is probed again first, so a login shows up when the picker opens.
metaApi.get('/harnesses', async (c) => {
  const cat = await freshCatalog();
  const running = runningByHarness();
  return c.json(cat.harnesses.map((h) => ({ ...h, running: running[h.id] ?? 0 })));
});

metaApi.get('/secrets', (c) => c.json(listSecrets()));
metaApi.post('/secrets', async (c) => {
  const { scope, name, value } = z.object({ scope: z.string(), name: z.string(), value: z.string() }).parse(await c.req.json());
  await setSecret(scope, name, value);
  return c.json({ ok: true });
});
metaApi.delete('/secrets', async (c) => {
  const { scope, name } = z.object({ scope: z.string(), name: z.string() }).parse(await c.req.json());
  await deleteSecret(scope, name);
  return c.json({ ok: true });
});

metaApi.get('/automations', (c) => {
  const cat = getCatalog();
  return c.json(
    loadAutomations().map((a) => ({
      ...a,
      error: a.error ?? validateDefaults({ harness: a.harness, model: a.model, effort: a.effort }, cat),
      runs: lastRuns(a.id, 5),
    })),
  );
});
metaApi.post('/automations/:id/run', async (c) => {
  const a = loadAutomations().find((x) => x.id === c.req.param('id'));
  if (!a) return c.json({ error: 'not found' }, 404);
  if (a.error) return c.json({ error: a.error }, 400);
  return c.json(await runAutomation(a, 'manual'));
});
metaApi.post('/automations/:id/enabled', async (c) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
  setEnabled(c.req.param('id'), enabled);
  return c.json({ ok: true });
});
