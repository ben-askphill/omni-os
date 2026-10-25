// The two routes behind thread references (the thread_reference kind of message context). Its own app so tests can
// call it without starting the server.
//   GET /api/thread-references?thread=<id>&q=<text>&scope=channel|all: the picker's search over titles and channel names.
//   GET /api/threads/:id/references/:ref/history?before=|after=&limit=: one bounded page of a referenced thread (thread-history.ts).
import { Hono } from 'hono';
import { z } from 'zod';
import { shortId } from '@omni/shared/message-context-thread.ts';
import { db, threads } from './db.ts';
import { PAGE_ROWS_MAX, readReferenced } from './thread-history.ts';

/** Matches in one answer. */
export const PICK_LIMIT = 20;

export interface ReferenceCandidate {
  id: string;
  short_id: string;
  title: string;
  channel: string;
  channel_name: string;
  status: string;
  archived: boolean;
  updated_at: string;
  /** In the channel of the thread being written in. A candidate with this false is a cross-channel reference. */
  same_channel: boolean;
}

interface Row {
  id: string;
  title: string;
  channel_id: string;
  channel_name: string;
  status: string;
  archived: number;
  updated_at: string;
}

/** `%`, `_` and `\` in a typed term are text, not wildcards. */
const like = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Threads whose title or channel name contains every word of `query` (any case), newest first and archived last. The
 * default scope is the channel of `thread`: another channel's threads are listed only for `scope: 'all'`, which the
 * picker offers as its own choice, so a reference never crosses channels by being the first match. `thread` itself is left out.
 */
export function searchReferences(thread: string, query: string, scope: 'channel' | 'all'): ReferenceCandidate[] | null {
  const here = threads.get(thread);
  if (!here) return null;
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
  const where = ['t.id != ?', ...(scope === 'channel' ? ['t.channel_id = ?'] : []), ...terms.map(() => `(t.title LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`)];
  const args = [thread, ...(scope === 'channel' ? [here.channel_id] : []), ...terms.flatMap((w) => [like(w), like(w)])];
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.channel_id, c.name AS channel_name, t.status, t.archived, t.updated_at
       FROM threads t JOIN channels c ON c.id = t.channel_id WHERE ${where.join(' AND ')}
       ORDER BY t.archived, t.updated_at DESC, t.id LIMIT ?`,
    )
    .all(...args, PICK_LIMIT) as unknown as Row[];
  return rows.map((r) => ({
    id: r.id,
    short_id: shortId(r.id),
    title: r.title,
    channel: r.channel_id,
    channel_name: r.channel_name,
    status: r.status,
    archived: !!r.archived,
    updated_at: r.updated_at,
    same_channel: r.channel_id === here.channel_id,
  }));
}

export const threadReferencesApi = new Hono();

threadReferencesApi.get('/', (c) => {
  const thread = c.req.query('thread') ?? '';
  const scope = c.req.query('scope') === 'all' ? 'all' : 'channel';
  const found = searchReferences(thread, (c.req.query('q') ?? '').slice(0, 200), scope);
  if (!found) return c.json({ error: 'not found' }, 404);
  return c.json(found);
});

const cursor = z.coerce.number().int().min(0);
const pageQuery = z
  .object({ before: cursor.optional(), after: cursor.optional(), limit: z.coerce.number().int().min(1).max(PAGE_ROWS_MAX).optional() })
  .refine((q) => q.before === undefined || q.after === undefined, 'Pass before or after, not both.');

export const referencedHistoryApi = new Hono();

referencedHistoryApi.get('/:id/references/:ref/history', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const q = pageQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!q.success) return c.json({ error: q.error.issues[0]?.message ?? 'invalid page' }, 400);
  return c.json(readReferenced(id, c.req.param('ref'), q.data));
});
