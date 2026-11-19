// /harnesses, /secrets, /automations, /profile, /devices.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { deleteAutomation, lastRuns, loadAutomations, runAutomation } from './automations.ts';
import { automationRefusal, callerOf, lineage, threadCredential, type AutomationWrite } from './automation-guard.ts';
import { placeholderFieldsIn, placeholderRefusal } from './user-config.ts';
import { automationFields, createAutomation, definitionOf, resetAutomation, saveAutomation, setAutomationEnabled, sourceKind } from './automation-files.ts';
import { ownerOf } from './sync/owner.ts';
import { shellAllowed } from './request-guard.ts';
import { pollErrors, watchedRepo } from './automation-watch.ts';
import { isPrTrigger } from './automation-events.ts';
import { recentDeliveries } from './automation-deliveries.ts';
import { webhookInfo } from './github-webhook-api.ts';
import { webhookSecretName } from './github-webhook.ts';
import { channelCatalog, freshCatalog, getCatalog, loadCatalog, refreshStale } from './harness/catalog-service.ts';
import { markHidden, modelVisibility, setHarnessModelPrefs } from './harness/model-visibility.ts';
import { parseHarnessPrefs } from '@omni/shared/model-visibility.ts';
import { parseDisplayPatch } from '@omni/shared/display.ts';
import { displayPrefs, setDisplayPrefs } from './display.ts';
import { validateDefaults } from './harness/resolve.ts';
import { HARNESS_INSTALL, isHarnessId, type HarnessInfo } from './harness/types.ts';
import { runningByHarness } from './runner.ts';
import { getProfile, profileInput, setProfile } from './profile.ts';
import { deleteSecret, hasSecret, listSecrets, setSecret } from './secrets.ts';
import { listDevices } from './sync/devices.ts';
import { checkSecret, secretDrop, secretDrops, sendSecret } from './secret-drop.ts';

export const metaApi = new Hono();

// The harnesses with their availability, fix command, models, efforts, cap and running count, and the install
// command for a CLI Omni found no binary for (a signed-out one gets only its sign-in `fix`).
// A harness that is down is probed again first, so a login shows up when the picker opens, and a catalog older than
// a few minutes is asked again in the background, so a newly released model shows up too (refreshStale).
// A model Ben's picker settings leave out carries `hidden: true` (harness/model-visibility.ts). It is still listed:
// the clients name and run it wherever it is already picked.
// With ?channel=, as that channel sees them: Cursor Cloud needs its GitHub repo and can use its own key.
metaApi.get('/harnesses', async (c) => {
  const cat = channelCatalog(await freshCatalog(), c.req.query('channel'));
  refreshStale();
  return c.json(harnessRows(cat.harnesses));
});

/** Ask every harness for its models now, as Settings' Check for new models does, and answer with the result. */
metaApi.post('/harnesses/refresh', async (c) => {
  const cat = channelCatalog(await loadCatalog(), c.req.query('channel'));
  return c.json(harnessRows(cat.harnesses));
});

const harnessRows = (list: HarnessInfo[]) => {
  const running = runningByHarness();
  const prefs = modelVisibility();
  return list.map((h) => harnessRow(markHidden(h, prefs), running[h.id] ?? 0));
};

/** One row of GET /api/harnesses. */
export function harnessRow(h: HarnessInfo, running: number) {
  const install = !h.available && h.missing && isHarnessId(h.id) ? HARNESS_INSTALL[h.id] : undefined;
  return { ...h, running, ...(install && { install }) };
}

// Which models the pickers list, per harness: the rule for untoggled models and the toggles (shared/model-visibility.ts).
metaApi.get('/model-visibility', (c) => c.json(modelVisibility()));
metaApi.put('/model-visibility/:harness', async (c) => {
  const harness = c.req.param('harness');
  if (!isHarnessId(harness)) return c.json({ error: `Unknown harness "${harness}".` }, 400);
  const prefs = parseHarnessPrefs(await c.req.json().catch(() => null));
  if (!prefs) return c.json({ error: 'Send { show, hide, newModels }.' }, 400);
  return c.json(setHarnessModelPrefs(harness, prefs));
});

// Show technical details and the Shopify add-on (display.ts). A PUT sets either or both and answers with both.
metaApi.get('/display', (c) => c.json(displayPrefs()));
metaApi.put('/display', async (c) => {
  const patch = parseDisplayPatch(await c.req.json().catch(() => null));
  if (!patch) return c.json({ error: 'Send { technical, shopify } as booleans.' }, 400);
  return c.json(setDisplayPrefs(patch));
});

/** The other synced Macs a thread can be handed to, with whether Tailscale sees each up. Empty while sync is off. */
metaApi.get('/devices', async (c) => c.json(await listDevices()));

metaApi.get('/secrets', (c) => c.json(listSecrets()));
metaApi.post('/secrets', async (c) => {
  const { scope, name, value } = z.object({ scope: z.string(), name: z.string(), value: z.string() }).parse(await c.req.json());
  await setSecret(scope, name, value);
  return c.json({ ok: true });
});
// The Conductor's set_secret: here when machine is left out, else sealed to that synced machine (secret-drop.ts),
// which saves it after it syncs. Omni's own credentials are refused either way.
metaApi.post('/secrets/send', async (c) => {
  const { machine, scope, name, value } = z
    .object({ machine: z.string().trim().min(1).max(100).optional(), scope: z.string().default('global'), name: z.string(), value: z.string() })
    .parse(await c.req.json());
  if (machine) return c.json(sendSecret(machine, scope, name, value));
  checkSecret(scope, name, value);
  await setSecret(scope, name, value);
  return c.json({ machine: null, scope, name, state: 'accepted' });
});
/** Secrets this machine sent to others, newest first, with each one's answer. Names only. */
metaApi.get('/secrets/sent', (c) => c.json(secretDrops()));
metaApi.get('/secrets/sent/:id', (c) => {
  const d = secretDrop(c.req.param('id'));
  return d ? c.json(d) : c.json({ error: 'No sent secret has that id.' }, 404);
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
  // A thread's own token may not change what {{user}} or {{timezone}} reads (user-config.ts placeholderFieldsIn).
  const held = threadCredential(c) ? placeholderFieldsIn({ user: parsed.data }) : [];
  if (held.length) return c.json({ error: placeholderRefusal(held) }, 403);
  return c.json(setProfile(parsed.data));
});

metaApi.get('/automations', (c) => {
  const cat = getCatalog();
  return c.json(
    loadAutomations().map((a) => ({
      ...a,
      error: a.error ?? validateDefaults({ harness: a.harness, model: a.model, effort: a.effort }, cat),
      // PR event automations: the repo they watch and why the last poll failed, if it did.
      ...(isPrTrigger(a.on) && { repo: watchedRepo({ ...a, on: a.on }), poll_error: pollErrors.get(a.id) ?? null }),
      // Webhook automations: where GitHub posts, and whether this Mac holds the signing secret (never its value).
      ...webhookInfo(a),
      // The machine that runs it, by sync id (null before any machine claimed automations), and whether that is this one.
      runs_on: ownerOf(a),
      source: sourceKind(a.id),
      runs: lastRuns(a.id, 5),
      // What events reached it and what became of each, newest first, and whether the history has older ones.
      ...recentDeliveries(a.id),
    })),
  );
});
metaApi.post('/automations/:id/run', async (c) => {
  const no = refusal(c, 'run');
  if (no) return no;
  const a = loadAutomations().find((x) => x.id === c.req.param('id'));
  if (!a) return c.json({ error: 'not found' }, 404);
  if (a.error) return c.json({ error: a.error }, 400);
  // `{"dry": true}`: a dry run, which says what it would do and does none of it (automation-rules.ts).
  const body = (await c.req.json().catch(() => ({}))) as { dry?: unknown } | null;
  return c.json(await runAutomation(a, 'manual', undefined, { dry: body?.dry === true }));
});
// Delete one: the user's own YAML is removed, a shipped one is hidden on this machine (automations.ts deleteAutomation).
// The id is matched against the listed automations, never joined into a path; one that looks like a path is refused first.
metaApi.delete('/automations/:id', async (c) => {
  const id = c.req.param('id');
  const no = refusal(c, 'delete');
  if (no) return no;
  if (!/^(?!\.)[^/\\\0]+$/.test(id)) return c.json({ error: 'invalid automation id' }, 400);
  const a = loadAutomations().find((x) => x.id === id);
  if (!a) return c.json({ error: 'not found' }, 404);
  const removed = deleteAutomation(a);
  // A webhook automation's signing secret has nothing left to sign for. The automation is gone either way.
  const secret = webhookSecretName(id);
  if (a.on?.event === 'github_webhook' && hasSecret('global', secret))
    await deleteSecret('global', secret).catch((err) => console.error(`[automations] could not remove ${secret}:`, err));
  return c.json({ ok: true, removed });
});
// On or off, written into its YAML (automation-files.ts): a shipped one becomes the user's own copy first.
metaApi.post('/automations/:id/enabled', async (c) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
  const no = refusal(c, enabled ? 'enable' : 'disable');
  if (no) return no;
  return edit(c, () => (setAutomationEnabled(c.req.param('id'), enabled), { ok: true }));
});

// The editor: the file's text and its fields as written (the prompt with its {{placeholders}}).
metaApi.get('/automations/:id/definition', (c) => {
  const d = definitionOf(c.req.param('id'));
  return d ? c.json(d) : c.json({ error: 'not found' }, 404);
});
// Save the editor's fields over the file, keeping its comments, or its raw text: { fields } or { yaml }. Raw text
// that adds or changes a precheck, a shell command, needs the install token or a session paired with it.
const saveInput = z.union([z.object({ fields: automationFields }).strict(), z.object({ yaml: z.string().min(1).max(200_000) }).strict()]);
metaApi.put('/automations/:id', async (c) => {
  const parsed = saveInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid automation' }, 400);
  const no = refusal(c, 'edit');
  if (no) return no;
  return edit(c, () => saveAutomation(c.req.param('id'), parsed.data, { shell: shellAllowed(c) }));
});
// A new automation in data/automations/<id>.yaml. `id` is optional: one is made from the name.
metaApi.post('/automations', async (c) => {
  const parsed = z.object({ id: z.string().max(64).optional(), fields: automationFields }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid automation' }, 400);
  const no = refusal(c, 'create');
  if (no) return no;
  // What a usage scan saves starts off: Ben turns each one on himself (automation-guard.ts).
  const caller = callerOf(c);
  const fields = caller && lineage(caller).scan ? { ...parsed.data.fields, enabled: false } : parsed.data.fields;
  return edit(c, () => createAutomation(fields, parsed.data.id), 201);
});
// Drop the user's copy of a shipped automation, so the shipped YAML loads again. Bringing back a shipped precheck that
// the copy does not run needs the install token or a session paired with it, as a save does.
metaApi.post('/automations/:id/reset', (c) => refusal(c, 'edit') ?? edit(c, () => resetAutomation(c.req.param('id'), { shell: shellAllowed(c) })));

/** A 403 when the agent thread making this call may not (automation-guard.ts). Ben's own clients name no thread and pass. */
function refusal(c: Context, write: AutomationWrite) {
  const no = automationRefusal(callerOf(c), write);
  return no ? c.json({ error: no }, 403) : null;
}

/** A refused edit's message and status (automation-files.ts sets one), else a 500. */
function edit(c: Context, run: () => unknown, ok: 200 | 201 = 200) {
  try {
    return c.json(run() as object, ok);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 403 || status === 404 || status === 409) return c.json({ error: (err as Error).message }, status);
    throw err;
  }
}
