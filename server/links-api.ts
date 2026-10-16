// /api/links: previews for the links in a reply (server/links.ts) and the marks they wear (shared/link-icons.ts).
import { Hono } from 'hono';
import { z } from 'zod';
import { LINK_ICONS } from '../shared/link-icons.ts';
import { resolveLinks } from './links.ts';

export const linksApi = new Hono();

const Resolve = z.object({
  urls: z.array(z.string().max(2048)).max(60),
  /** The channel the links were posted in: its secrets are used before the global ones. */
  channel_id: z.string().regex(/^[a-z0-9-]+$/).optional(),
});

linksApi.post('/resolve', async (c) => {
  const { urls, channel_id } = Resolve.parse(await c.req.json());
  return c.json({ previews: await resolveLinks(urls.filter((u) => /^https?:\/\//i.test(u)), channel_id) });
});

// The marks never change while the server runs, so a client fetches them once.
linksApi.get('/icons', (c) => {
  c.header('Cache-Control', 'max-age=86400');
  return c.json({ icons: LINK_ICONS });
});
