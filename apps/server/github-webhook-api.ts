// POST /api/hooks/github/:automation, where GitHub posts the events of an `on: github_webhook` automation, and
// PUT/DELETE /api/automations/:id/webhook-secret, which set its signing secret in the Keychain. GitHub cannot send this
// install's token, so the guard lets the hook route through and the request proves itself with its signature. Size,
// content type, event and signature are all checked before anything is saved. A valid event is saved as a delivery
// (db/repos/trigger-deliveries.ts) keyed by its X-GitHub-Delivery id before the reply, and started like any other
// (automation-triggers.ts): on the Mac that runs automations, or held for it and carried over by sync.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { TriggerDelivery } from '@omni/shared/automation-triggers.ts';
import type { WebhookTrigger } from './automation-events.ts';
import { admitPending } from './automation-triggers.ts';
import { ghLogin } from './automation-watch.ts';
import { loadAutomations, type Automation } from './automations.ts';
import { publishFeed } from './bus.ts';
import { deliveryId, triggerDeliveries } from './db/repos/trigger-deliveries.ts';
import { DELIVERY_ID, isWebhookEvent, readWebhook, signatureValid, WEBHOOK_MAX_BYTES, webhookPath, webhookSecretName } from './github-webhook.ts';
import { deleteSecret, globalSecret, hasSecret, setSecret } from './secrets.ts';
import { automationsOwner } from './sync/owner.ts';

export const githubWebhookApi = new Hono();

type WebhookAutomation = Automation & { on: WebhookTrigger };
const isWebhookAutomation = (a: Automation | undefined): a is WebhookAutomation => a?.on?.event === 'github_webhook';
const find = (id: string) => loadAutomations().find((a) => a.id === id);

/** What GET /api/automations adds for a webhook automation: where GitHub posts, and whether this Mac holds its secret. Never the value. */
export const webhookInfo = (a: Automation) =>
  isWebhookAutomation(a) && { webhook: { path: webhookPath(a.id), secret: webhookSecretName(a.id), secret_set: hasSecret('global', webhookSecretName(a.id)) } };

/** The reply to a saved event, the same for the first request and every repeat of it. */
const admission = (d: TriggerDelivery, duplicate: boolean) => ({ delivery: d.id, state: d.state, reason: d.reason, thread_id: d.thread_id, duplicate });

githubWebhookApi.post(
  '/hooks/github/:automation',
  bodyLimit({ maxSize: WEBHOOK_MAX_BYTES, onError: (c) => c.json({ error: `body over ${WEBHOOK_MAX_BYTES} bytes` }, 413) }),
  async (c) => {
    const a = find(c.req.param('automation'));
    if (!isWebhookAutomation(a) || a.error) return c.json({ error: 'no webhook automation with this id' }, 404);
    if (!/^application\/json\s*(;|$)/i.test(c.req.header('content-type') ?? '')) return c.json({ error: 'send application/json (the webhook content type)' }, 415);
    const event = c.req.header('x-github-event');
    const wanted = isWebhookEvent(event) && a.on.events.includes(event) ? event : null;
    if (!wanted && event !== 'ping')
      return c.json({ error: `this automation takes ${a.on.events.join(', ')}, not ${event ?? 'an unnamed event'}` }, 400);
    const guid = c.req.header('x-github-delivery') ?? '';
    if (!DELIVERY_ID.test(guid)) return c.json({ error: 'missing or malformed X-GitHub-Delivery' }, 400);
    const secret = await globalSecret(webhookSecretName(a.id));
    if (!secret) return c.json({ error: 'no signing secret is set for this automation on this Mac' }, 503);
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (!signatureValid(secret, body, c.req.header('x-hub-signature-256'))) return c.json({ error: 'bad signature' }, 401);
    // GitHub pings a new hook once. Answered so the hook shows as working, and nothing is saved.
    if (!wanted) return c.json({ ok: true });

    const id = deliveryId(a.id, 'github_webhook', guid);
    const seen = triggerDeliveries.get(id);
    if (seen) return c.json(admission(seen, true));
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return c.json({ error: 'body is not JSON' }, 400);
    }
    const reading = readWebhook(a.on, wanted, payload, wanted === 'pull_request_review' ? await ghLogin() : null);
    if (reading.kind === 'reject') return c.json({ error: reading.error }, 400);
    if (reading.kind === 'ignore') return c.json({ ignored: reading.reason }, 202);
    const owner = automationsOwner();
    // Another Mac cannot tell whether it is on there, so it holds the event and that Mac decides.
    if (owner.isThisMac && !a.enabled) return c.json({ error: 'the automation is paused' }, 409);
    const { delivery, fresh } = triggerDeliveries.add({
      automation: a.id,
      source: 'github_webhook',
      source_id: guid,
      summary: reading.summary,
      context: reading.context,
      state: reading.skip ? 'skipped' : owner.isThisMac ? 'accepted' : 'queued',
      reason: reading.skip,
      owner: owner.owner,
      source_thread: null,
    });
    if (fresh) {
      publishFeed({ type: 'automation_delivery', automation: a.id });
      if (delivery.state === 'accepted') void admitPending();
    }
    return c.json(admission(delivery, !fresh), fresh ? 202 : 200);
  },
);

githubWebhookApi.put('/automations/:id/webhook-secret', async (c) => {
  const a = find(c.req.param('id'));
  if (!isWebhookAutomation(a)) return c.json({ error: 'not a webhook automation' }, 404);
  const { value } = z.object({ value: z.string() }).parse(await c.req.json());
  await setSecret('global', webhookSecretName(a.id), value.trim());
  return c.json({ ok: true, secret_set: true });
});

githubWebhookApi.delete('/automations/:id/webhook-secret', async (c) => {
  const a = find(c.req.param('id'));
  if (!isWebhookAutomation(a)) return c.json({ error: 'not a webhook automation' }, 404);
  await deleteSecret('global', webhookSecretName(a.id));
  return c.json({ ok: true, secret_set: false });
});
