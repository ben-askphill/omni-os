// /api/crew, /harnesses, /secrets, /automations, /profile, /devices.
import { Hono } from 'hono';
import { z } from 'zod';
import { lastRuns, loadAutomations, runAutomation, setEnabled } from './automations.ts';
import { pollErrors, watchedRepo } from './automation-watch.ts';
import { listCrew } from './crew.ts';
import { channelCatalog, freshCatalog, getCatalog } from './harness/catalog-service.ts';
import { validateDefaults } from './harness/resolve.ts';
import { HARNESS_INSTALL } from './harness/types.ts';
import { runningByHarness } from './runner.ts';
import { getProfile, profileInput, setProfile } from './profile.ts';
import { deleteSecret, listSecrets, setSecret } from './secrets.ts';
import { listDevices } from './sync/devices.ts';

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
// With ?channel=, as that channel sees them: Cursor Cloud needs its GitHub repo and can use its own key.
metaApi.get('/harnesses', async (c) => {
  const cat = channelCatalog(await freshCatalog(), c.req.query('channel'));
  const running = runningByHarness();
  return c.json(cat.harnesses.map((h) => ({ ...h, running: running[h.id] ?? 0, ...(!h.available && HARNESS_INSTALL[h.id] && { install: HARNESS_INSTALL[h.id] }) })));
});

/** The other synced Macs a thread can be handed to, with whether Tailscale sees each up. Empty while sync is off. */
metaApi.get('/devices', async (c) => c.json(await listDevices()));

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

// Who uses this Omni. The name is in GET /api/status too, so a client learns it with the rest of the workspace.
metaApi.get('/profile', (c) => c.json(getProfile()));
metaApi.put('/profile', async (c) => {
  if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return c.json({ error: 'send JSON' }, 415);
  // The first issue's text, so a client can show "Enter a name." as it is.
  const parsed = profileInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid profile' }, 400);
  return c.json(setProfile(parsed.data));
});

metaApi.get('/automations', (c) => {
  const cat = getCatalog();
  return c.json(
    loadAutomations().map((a) => ({
      ...a,
      error: a.error ?? validateDefaults({ harness: a.harness, model: a.model, effort: a.effort }, cat),
      // Event automations: the repo they watch and why the last poll failed, if it did.
      ...(a.on && { repo: watchedRepo(a), poll_error: pollErrors.get(a.id) ?? null }),
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
