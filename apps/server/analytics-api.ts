// /api/analytics: Settings > About > Usage analytics, and the Web UI's own events and errors on their way to PostHog
// (analytics.ts). GET answers the switch and whether a project key is set; PUT { enabled } sets the switch for every
// machine. POST /events takes one of the events a client may report (CLIENT_EVENTS) and POST /exception an error the
// page did not catch, both checked against packages/shared/analytics.ts and dropped while the switch is off.
import { Hono } from 'hono';
import { z } from 'zod';
import { CLIENT_EVENTS, CLIENT_SETTINGS, cleanEvent, cleanException } from '@omni/shared/analytics.ts';
import { analyticsState, capture, captureCleanException, setAnalyticsEnabled } from './analytics.ts';

export const analyticsApi = new Hono();

analyticsApi.get('/', async (c) => c.json(await analyticsState()));

analyticsApi.put('/', async (c) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json().catch(() => null));
  return c.json(await setAnalyticsEnabled(enabled));
});

analyticsApi.post('/events', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { event?: unknown; props?: unknown } | null;
  const clean = cleanEvent(body?.event, body?.props);
  if (!clean || !CLIENT_EVENTS.includes(clean.event)) return c.json({ error: 'Not an event a client reports.' }, 400);
  // A client reports only the settings it keeps itself; the server reports the ones it saves.
  if (clean.event === 'settings_changed' && !CLIENT_SETTINGS.includes(clean.props.setting as (typeof CLIENT_SETTINGS)[number])) return c.json({ error: 'The server reports that setting.' }, 400);
  capture(clean.event, clean.props);
  return c.body(null, 204);
});

analyticsApi.post('/exception', async (c) => {
  const e = cleanException(await c.req.json().catch(() => null));
  if (!e) return c.json({ error: 'Send { type, frames }.' }, 400);
  captureCleanException({ ...e, source: 'web' });
  return c.body(null, 204);
});
