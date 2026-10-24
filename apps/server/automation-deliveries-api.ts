// The routes behind an event automation's delivery history (automation-deliveries.ts has the rules):
//   GET  /api/automations/:id/deliveries?limit&before   the history, newest first, a page at a time
//   GET  /api/deliveries/:id                            one delivery
//   POST /api/deliveries/:id/retry   { attempt }        go again, for a failed delivery that made no thread
//   POST /api/deliveries/:id/skip    { attempt? }       never start it
// A refused action answers 409 with the reason and the delivery as it is now, so a client can show both.
import { Hono } from 'hono';
import { z } from 'zod';
import type { DeliveryPage } from '@omni/shared/automation-triggers.ts';
import { admitPending } from './automation-triggers.ts';
import { retryDelivery, skipDelivery, viewById, viewsOf, type DeliveryAction } from './automation-deliveries.ts';
import { triggerDeliveries } from './db/repos/trigger-deliveries.ts';

export const automationDeliveriesApi = new Hono();

const PAGE = { default: 20, max: 100 };

automationDeliveriesApi.get('/automations/:id/deliveries', (c) => {
  const limit = Math.min(Math.max(Math.trunc(Number(c.req.query('limit'))) || PAGE.default, 1), PAGE.max);
  const before = c.req.query('before') || undefined;
  if (before && !triggerDeliveries.get(before)) return c.json({ error: 'no delivery with this id to page from' }, 404);
  const { rows, more } = triggerDeliveries.page(c.req.param('id'), limit, before);
  return c.json({ deliveries: viewsOf(rows), more } satisfies DeliveryPage);
});

automationDeliveriesApi.get('/deliveries/:id', (c) => {
  const delivery = viewById(c.req.param('id'));
  return delivery ? c.json(delivery) : c.json({ error: 'no delivery with this id' }, 404);
});

const reply = (c: { json: (body: unknown, status?: 404 | 409) => Response }, r: DeliveryAction) =>
  r.ok ? c.json({ delivery: r.delivery }) : c.json({ error: r.error, delivery: r.delivery }, r.status);

automationDeliveriesApi.post('/deliveries/:id/retry', async (c) => {
  const { attempt } = z.object({ attempt: z.number().int().positive() }).parse(await c.req.json().catch(() => ({})));
  const r = retryDelivery(c.req.param('id'), attempt);
  // Started here when this Mac runs automations. Another Mac holds it for the one that does.
  if (r.ok) void admitPending();
  return reply(c, r);
});

automationDeliveriesApi.post('/deliveries/:id/skip', async (c) => {
  const { attempt } = z.object({ attempt: z.number().int().positive().optional() }).parse(await c.req.json().catch(() => ({})));
  return reply(c, skipDelivery(c.req.param('id'), attempt));
});
