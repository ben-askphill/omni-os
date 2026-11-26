// The two routes behind thread references (the thread_reference kind of message context). Its own app so tests can
// call it without starting the server.
//   GET /api/thread-references?thread=<id>&q=<text>&scope=channel|all: the picker's search over titles and channel names.
//     channel=<id> in place of thread=: for a thread not made yet (the new-thread composer), searched from that channel.
//   GET /api/threads/:id/references/:ref/history?before=|after=&limit=: one bounded page of a referenced thread (thread-history.ts).
import { Hono } from 'hono';
import { z } from 'zod';
import { shortId } from '@omni/shared/message-context-thread.ts';
import { channels, db, threads } from './db.ts';
import { PAGE_CHARS_MAX, PAGE_ROWS_MAX, ROW_CHARS_MAX, readReferenced, readConversation } from './thread-history.ts';

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
  /** In the channel of the thread being written in (or to be made in). A candidate with this false is a cross-channel reference. */
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

/** Where the search is asked from: a thread's reply box, or the new-thread composer of a channel. */
export type SearchFrom = { thread: string } | { channel: string };

/**
 * Threads whose title or channel name contains every word of `query` (any case), newest first and archived last. The
 * default scope is the channel searched from: another channel's threads are listed only for `scope: 'all'`, which the
 * picker offers as its own choice, so a reference never crosses channels by being the first match. A thread searched
 * from is left out. Null for an unknown thread or channel.
 */
export function searchReferences(from: SearchFrom, query: string, scope: 'channel' | 'all'): ReferenceCandidate[] | null {
  const self = 'thread' in from ? from.thread : null;
  const here = 'thread' in from ? threads.get(from.thread)?.channel_id : channels.get(from.channel)?.id;
  if (!here) return null;
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
  const where = [...(self !== null ? ['t.id != ?'] : []), ...(scope === 'channel' ? ['t.channel_id = ?'] : []), ...terms.map(() => `(t.title LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`)];
  const args = [...(self !== null ? [self] : []), ...(scope === 'channel' ? [here] : []), ...terms.flatMap((w) => [like(w), like(w)])];
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.channel_id, c.name AS channel_name, t.status, t.archived, t.updated_at
       FROM threads t JOIN channels c ON c.id = t.channel_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
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
    same_channel: r.channel_id === here,
  }));
}

export const threadReferencesApi = new Hono();

threadReferencesApi.get('/', (c) => {
  const thread = c.req.query('thread');
  const from: SearchFrom = thread !== undefined ? { thread } : { channel: c.req.query('channel') ?? '' };
  const scope = c.req.query('scope') === 'all' ? 'all' : 'channel';
  const found = searchReferences(from, (c.req.query('q') ?? '').slice(0, 200), scope);
  if (!found) return c.json({ error: 'not found' }, 404);
  return c.json(found);
});

const cursor = z.coerce.number().int().min(0);
const pageQuery = z
  .object({
    before: cursor.optional(),
    after: cursor.optional(),
    limit: z.coerce.number().int().min(1).max(PAGE_ROWS_MAX).optional(),
    page_chars: z.coerce.number().int().min(1).max(PAGE_CHARS_MAX).optional(),
    row_chars: z.coerce.number().int().min(1).max(ROW_CHARS_MAX).optional(),
  })
  .refine((q) => q.before === undefined || q.after === undefined, 'Pass before or after, not both.');

export const referencedHistoryApi = new Hono();

referencedHistoryApi.get('/:id/references/:ref/history', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const q = pageQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!q.success) return c.json({ error: q.error.issues[0]?.message ?? 'invalid page' }, 400);
  return c.json(readReferenced(id, c.req.param('ref'), q.data));
});

/** Any thread's conversation, a page at a time, as read_referenced_thread pages it. For the external MCP server's read_thread. */
referencedHistoryApi.get('/:id/conversation', (c) => {
  const q = pageQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!q.success) return c.json({ error: q.error.issues[0]?.message ?? 'invalid page' }, 400);
  const page = readConversation(c.req.param('id'), q.data);
  return page ? c.json(page) : c.json({ error: 'not found' }, 404);
});
