// /api/channels: channel CRUD, and the threads listed under one channel.
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { parseChannelIcon, readSvgIcon, SVG_MAX, SVG_PREFIX } from '../shared/channel-icon.ts';
import { readDesignSystem } from '../shared/design-system.ts';
import { channels, publicChannel, threads, type Channel, type Thread } from './db.ts';
import { detectRepo } from './github.ts';
import { getCatalog } from './harness/catalog-service.ts';
import { validateDefaults } from './harness/resolve.ts';

export const channelsApi = new Hono();

/**
 * One emoji or character, `icon:<name>` for a design system icon, or `svg:` and a file's text. Blank clears it.
 * An SVG is checked and cleaned by withSvgIcon, so its refusal reads as a sentence.
 */
const channelIcon = z
  .string()
  .trim()
  .max(SVG_MAX * 4)
  .refine((s) => !s || s.startsWith(SVG_PREFIX) || parseChannelIcon(s), 'one emoji or character, icon:<name> from the design system, or svg:<markup>')
  .transform((s) => s || null)
  .nullish();

/** The body with an uploaded SVG icon cleaned for storing, or the reason it is refused. */
function withSvgIcon<T extends { icon?: string | null }>(body: T): T | { error: string } {
  if (!body.icon?.startsWith(SVG_PREFIX)) return body;
  try {
    return { ...body, icon: readSvgIcon(body.icon.slice(SVG_PREFIX.length)) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** A run default: blank clears it, so the channel falls back to Claude Code's default. */
const runDefault = z
  .string()
  .trim()
  .max(120)
  .transform((s) => s || null)
  .nullish();

/**
 * Why the run defaults a body would leave the channel with are refused, against the harness catalog. A body that
 * sets none of them is not checked, so a default the catalog has since retired never blocks a rename or an archive.
 */
function runDefaultsError(body: { default_harness?: string | null; default_model?: string | null; default_effort?: string | null }, current?: Channel) {
  if (!('default_harness' in body || 'default_model' in body || 'default_effort' in body)) return undefined;
  const pick = (k: 'default_harness' | 'default_model' | 'default_effort') => (k in body ? body[k] : current?.[k]) ?? undefined;
  const err = validateDefaults({ harness: pick('default_harness'), model: pick('default_model'), effort: pick('default_effort') }, getCatalog());
  return err ? `Default model: ${err}` : undefined;
}

const channelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/, 'lowercase letters, digits and dashes'),
  name: z.string().min(1),
  kind: z.enum(['client', 'internal', 'personal']).optional(),
  repo_path: z.string().nullish(),
  github_repo: z.string().nullish(),
  use_worktree: z.coerce.number().int().min(0).max(1).optional(),
  base_dir: z.string().nullish(),
  store_domain: z.string().nullish(),
  portal_slug: z.string().nullish(),
  browser_headless: z.coerce.number().int().min(0).max(1).optional(),
  notes: z.string().nullish(),
  icon: channelIcon,
  default_harness: runDefault,
  default_model: runDefault,
  default_effort: runDefault,
});

/** A channel's latest threads of any status, so the sidebar can keep finished ones findable. */
const RECENT_PER_CHANNEL = 5;

const stub = ({ id, channel_id, title, status, created_at }: Thread) => ({ id, channel_id, title, status, created_at });

/** A channel plus its running and queued threads, and its latest ones, so the sidebar can list them under the name. */
const withActive = (ch: Channel, busy: Thread[], recent: Thread[]) => {
  const mine = busy.filter((t) => t.channel_id === ch.id && t.source !== 'team');
  return {
    ...publicChannel(ch),
    running: mine.length,
    active: mine.map(stub),
    recent: recent.filter((t) => t.channel_id === ch.id).map(stub),
  };
};

channelsApi.get('/', (c) => {
  const busy = threads.running();
  const recent = threads.recentPerChannel(RECENT_PER_CHANNEL);
  return c.json(channels.list(c.req.query('archived') === '1').map((ch) => withActive(ch, busy, recent)));
});

channelsApi.get('/:id', (c) => {
  const ch = channels.get(c.req.param('id'));
  if (!ch) return c.json({ error: 'not found' }, 404);
  return c.json(withActive(ch, threads.running(), threads.byChannel(ch.id, RECENT_PER_CHANNEL)));
});

channelsApi.post('/', async (c) => {
  const parsed = withSvgIcon(channelSchema.parse(await c.req.json()));
  if ('error' in parsed) return c.json(parsed, 400);
  const body = parsed;
  if (channels.get(body.id)) return c.json({ error: 'channel exists' }, 409);
  const runError = runDefaultsError(body);
  if (runError) return c.json({ error: runError }, 400);
  if (body.repo_path && !existsSync(body.repo_path)) return c.json({ error: `repo path not found: ${body.repo_path}` }, 400);
  if (body.repo_path && !body.github_repo) body.github_repo = await detectRepo(body.repo_path);
  return c.json(publicChannel(channels.create(body as any)));
});

channelsApi.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const current = channels.get(id);
  if (!current) return c.json({ error: 'not found' }, 404);
  const parsed = withSvgIcon(channelSchema.partial().extend({ archived: z.coerce.number().optional() }).parse(await c.req.json()));
  if ('error' in parsed) return c.json(parsed, 400);
  const body = parsed;
  delete (body as any).id;
  const runError = runDefaultsError(body, current);
  if (runError) return c.json({ error: runError }, 400);
  if (body.repo_path && !body.github_repo && !current.github_repo) body.github_repo = await detectRepo(body.repo_path);
  return c.json(publicChannel(channels.update(id, body as any)!));
});

/** The channel's design system: a standalone HTML file. PUT replaces it, DELETE removes it, GET returns the file. */
channelsApi.get('/:id/design-system', (c) => {
  const ch = channels.get(c.req.param('id'));
  if (!ch?.design_system) return c.json({ error: 'not found' }, 404);
  // Sandboxed, so opening the file in a tab never runs its scripts with this server's origin.
  return c.body(ch.design_system, 200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': 'sandbox' });
});

channelsApi.put('/:id/design-system', async (c) => {
  const id = c.req.param('id');
  if (!channels.get(id)) return c.json({ error: 'not found' }, 404);
  const body = z.object({ name: z.string().trim().min(1).max(200), html: z.string() }).parse(await c.req.json());
  let html: string;
  try {
    html = readDesignSystem(body.html);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  return c.json(publicChannel(channels.update(id, { design_system: html, design_system_name: body.name })!));
});

channelsApi.delete('/:id/design-system', (c) => {
  const id = c.req.param('id');
  if (!channels.get(id)) return c.json({ error: 'not found' }, 404);
  return c.json(publicChannel(channels.update(id, { design_system: null, design_system_name: null })!));
});

channelsApi.get('/:id/threads', (c) => c.json(threads.byChannel(c.req.param('id'), 200, c.req.query('archived') === '1')));
