// /api/channels: channel CRUD, and the threads listed under one channel.
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { expandHome } from './user-config.ts';
import { parseChannelIcon, readSvgIcon, SVG_MAX, SVG_PREFIX } from '@omni/shared/channel-icon.ts';
import { readDesignSystem } from '@omni/shared/design-system.ts';
import { channels, folders as folderRepo, publicChannel, threads, type Channel, type Folder, type Thread } from './db.ts';
import { detectRepo } from './github.ts';
import { getCatalog } from './harness/catalog-service.ts';
import { activeTasks } from './runner.ts';
import { allWithDelegating, delegatingIds } from './delegating.ts';
import { validateDefaults } from './harness/resolve.ts';
import { publishFeed } from './bus.ts';
import { baseOptions } from './worktree-base.ts';

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
  // `~/code/x` works as typed: the placeholder in both clients shows it that way.
  repo_path: z.string().nullish().transform((p) => (p?.trim() ? expandHome(p.trim()) : p)),
  github_repo: z.string().nullish(),
  use_worktree: z.coerce.number().int().min(0).max(1).optional(),
  base_dir: z.string().nullish().transform((p) => (p?.trim() ? expandHome(p.trim()) : p)),
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

/** A folder lists at most this many of its threads in the sidebar; its count still says how many there are. */
const THREADS_PER_FOLDER = 50;

/** A thread as the sidebar lists it. `delegating`: a thread it delegated still works (apps/server/delegating.ts). */
const stub = ({ id, channel_id, title, status, created_at, updated_at, folder_id, harness, pinned_at, done_at, parent_id, source }: Thread, delegating: ReadonlySet<string>) => ({
  id, channel_id, title, status, created_at, updated_at, folder_id, harness, pinned_at, done_at, parent_id, source, delegating: delegating.has(id),
});

/** Conductor jobs with their delegated child threads, including children in other channels. */
function conductorHandoffs(delegating: ReadonlySet<string>) {
  const groups = new Map<string, { parent: Thread; children: Thread[] }>();
  for (const child of threads.conductorHandoffChildren()) {
    const parentID = child.parent_id;
    if (!parentID) continue;
    let group = groups.get(parentID);
    if (!group) {
      const parent = threads.get(parentID);
      if (!parent) continue;
      group = { parent, children: [] };
      groups.set(parentID, group);
    }
    group.children.push(child);
  }
  return [...groups.values()].map(({ parent, children }) => ({ parent: stub(parent, delegating), children: children.map((t) => stub(t, delegating)) }));
}

/** Each folder with its count, how many of its threads run, and its newest threads, keyed by channel. */
function foldersByChannel(list: Folder[], filed: Thread[], delegating: ReadonlySet<string>) {
  const byFolder = new Map<string, Thread[]>();
  for (const t of filed) byFolder.set(t.folder_id!, [...(byFolder.get(t.folder_id!) ?? []), t]);
  const withThreads = (f: Folder) => {
    const mine = byFolder.get(f.id) ?? [];
    return {
      ...f,
      count: mine.length,
      running: mine.filter((t) => isWorking(t, delegating)).length,
      threads: mine.slice(0, THREADS_PER_FOLDER).map((t) => stub(t, delegating)),
    };
  };
  const out = new Map<string, ReturnType<typeof withThreads>[]>();
  for (const f of list) out.set(f.channel_id, [...(out.get(f.channel_id) ?? []), withThreads(f)]);
  return out;
}

/**
 * Running and queued threads, plus any thread whose sub-agents still run after its turn ended, so the sidebar can
 * nest those agents under it, and any thread whose delegated threads still work. A team member's agents count for its
 * lead, the thread the sidebar lists.
 */
function busyThreads(delegating: ReadonlySet<string>) {
  const busy = threads.running();
  const seen = new Set(busy.map((t) => t.id));
  for (const id of [...activeTasks().map((task) => task.lead_id ?? task.thread_id), ...delegating]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const t = threads.get(id);
    if (t && !t.archived) busy.push(t);
  }
  return busy;
}

/** Its own turn runs or queues, or a thread it delegated does. A thread with only sub-agents left is not counted. */
const isWorking = (t: Thread, delegating: ReadonlySet<string>) => t.status === 'running' || t.status === 'queued' || delegating.has(t.id);

/**
 * A channel plus its busy threads, its latest ones, and its folders with their threads, so the sidebar can list them
 * under the name. `running` counts the running and queued ones and those whose delegated threads still work.
 */
const withActive = (ch: Channel, busy: Thread[], recent: Thread[], folders: Map<string, unknown[]>, handoffs: ReturnType<typeof conductorHandoffs>, delegating: ReadonlySet<string>) => {
  const mine = busy.filter((t) => t.channel_id === ch.id && t.source !== 'team');
  return {
    ...publicChannel(ch),
    running: mine.filter((t) => isWorking(t, delegating)).length,
    active: mine.map((t) => stub(t, delegating)),
    recent: recent.filter((t) => t.channel_id === ch.id).map((t) => stub(t, delegating)),
    folders: folders.get(ch.id) ?? [],
    ...(ch.id === 'conductor' && handoffs.length ? { handoffs } : {}),
  };
};

channelsApi.get('/', (c) => {
  const delegating = delegatingIds();
  const busy = busyThreads(delegating);
  const recent = threads.recentPerChannel(RECENT_PER_CHANNEL);
  const folders = foldersByChannel(folderRepo.all(), threads.filed(), delegating);
  const handoffs = conductorHandoffs(delegating);
  return c.json(channels.list(c.req.query('archived') === '1').map((ch) => withActive(ch, busy, recent, folders, handoffs, delegating)));
});

channelsApi.get('/:id', (c) => {
  const ch = channels.get(c.req.param('id'));
  if (!ch) return c.json({ error: 'not found' }, 404);
  const delegating = delegatingIds();
  const folders = foldersByChannel(folderRepo.byChannel(ch.id), threads.filed(ch.id), delegating);
  return c.json(withActive(ch, busyThreads(delegating), threads.byChannel(ch.id, RECENT_PER_CHANNEL), folders, conductorHandoffs(delegating), delegating));
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
  // Read the GitHub repo from the path when none is typed and there is none yet, or when the path moves without one
  // typed (the clients leave it out unless detection failed or it was edited, #405).
  const moved = body.repo_path && body.repo_path !== current.repo_path && body.github_repo === undefined;
  if (body.repo_path && !body.github_repo && (!current.github_repo || moved)) body.github_repo = await detectRepo(body.repo_path);
  const updated = channels.update(id, body as any)!;
  publishFeed({ type: 'channel', id });
  return c.json(publicChannel(updated));
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

/** What the new-thread composer offers as a base for a worktree thread in this channel (worktree-base.ts). */
channelsApi.get('/:id/bases', async (c) => {
  const channel = channels.get(c.req.param('id'));
  return channel ? c.json(await baseOptions(channel)) : c.json({ error: 'not found' }, 404);
});

channelsApi.get('/:id/threads', (c) => c.json(allWithDelegating(threads.byChannel(c.req.param('id'), 200, c.req.query('archived') === '1'))));
