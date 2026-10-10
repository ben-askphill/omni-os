// /api/folders: the sidebar folders that group a channel's threads. Putting a thread in one is PATCH /api/threads/:id.
import { Hono } from 'hono';
import { z } from 'zod';
import { publishFeed } from './bus.ts';
import { FolderError, folders } from './db.ts';

export const foldersApi = new Hono();

/** Any FolderError as its status and sentence; other errors go on to the app's handler. */
const refused = (err: unknown) => {
  if (err instanceof FolderError) return { body: { error: err.message }, status: err.status };
  throw err;
};

/** Folder writes reach other open clients as a channel change, which makes them refetch the channel list. */
const changed = (channelId: string) => publishFeed({ type: 'channel', id: channelId });

const body = async (c: { req: { json: () => Promise<unknown> } }) => (await c.req.json().catch(() => null)) ?? {};

foldersApi.get('/', (c) => {
  const channel = c.req.query('channel');
  return c.json(channel ? folders.byChannel(channel) : folders.all());
});

const createSchema = z.object({ channel: z.string().min(1), name: z.string().nullish(), parent_id: z.string().nullish() });

foldersApi.post('/', async (c) => {
  const parsed = createSchema.safeParse(await body(c));
  if (!parsed.success) return c.json({ error: 'a channel is required' }, 400);
  try {
    const f = folders.create({ channel_id: parsed.data.channel, name: parsed.data.name, parent_id: parsed.data.parent_id });
    changed(f.channel_id);
    return c.json(f, 201);
  } catch (err) {
    const r = refused(err);
    return c.json(r.body, r.status);
  }
});

const orderSchema = z.object({ channel: z.string().min(1), ids: z.array(z.string()) });

/** Ben's manual order for a channel's folders. */
foldersApi.put('/order', async (c) => {
  const parsed = orderSchema.safeParse(await body(c));
  if (!parsed.success) return c.json({ error: 'a channel and the folder ids in order are required' }, 400);
  try {
    const list = folders.reorder(parsed.data.channel, parsed.data.ids);
    changed(parsed.data.channel);
    return c.json(list);
  } catch (err) {
    const r = refused(err);
    return c.json(r.body, r.status);
  }
});

const patchSchema = z
  .object({ name: z.string().optional(), collapsed: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional() })
  .refine((b) => b.name !== undefined || b.collapsed !== undefined, 'a name or collapsed is required');

/** Rename, or open and close it in the sidebar. */
foldersApi.patch('/:id', async (c) => {
  const parsed = patchSchema.safeParse(await body(c));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'a name or collapsed is required' }, 400);
  const id = c.req.param('id');
  try {
    let f = folders.get(id);
    if (!f) return c.json({ error: 'folder not found' }, 404);
    if (parsed.data.name !== undefined) f = folders.rename(id, parsed.data.name);
    if (parsed.data.collapsed !== undefined) f = folders.setCollapsed(id, !!parsed.data.collapsed);
    changed(f.channel_id);
    return c.json(f);
  } catch (err) {
    const r = refused(err);
    return c.json(r.body, r.status);
  }
});

/** "<name> copy", empty: a thread sits in one folder only. */
foldersApi.post('/:id/duplicate', (c) => {
  try {
    const f = folders.duplicate(c.req.param('id'));
    changed(f.channel_id);
    return c.json(f, 201);
  } catch (err) {
    const r = refused(err);
    return c.json(r.body, r.status);
  }
});

/** Delete the folder. Its threads are kept, back in the channel's ungrouped list. */
foldersApi.delete('/:id', (c) => {
  const f = folders.get(c.req.param('id'));
  if (!f) return c.json({ error: 'folder not found' }, 404);
  const moved = folders.remove(f.id);
  changed(f.channel_id);
  return c.json({ ok: true, moved });
});
