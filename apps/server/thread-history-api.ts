// /api/threads/:id/history and /api/threads/:id/events/:eventId: a thread's older history, a page at a time, and one
// whole row. The newest page comes with the detail (GET /api/threads/:id?history=recent). See apps/server/history.ts.
// /api/threads/:id/find: the find bar's matches over every row, held by the client or not.
import { Hono } from 'hono';
import { parseHistoryQuery } from '@omni/shared/history.ts';
import { FIND_MAX_QUERY } from '@omni/shared/thread-find.ts';
import { threads } from './db.ts';
import { findInThread } from './db/repos/find.ts';
import { history as repo } from './db/repos/history.ts';
import { readPage } from './history.ts';

export const threadHistoryApi = new Hono();

/** A page for the cursor in the query (packages/shared/history.ts `historyQuery`). */
threadHistoryApi.get('/:id/history', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const cursor = parseHistoryQuery((name) => c.req.query(name));
  if ('error' in cursor) return c.json({ error: cursor.error }, 400);
  if ('at' in cursor) {
    if ((cursor.after !== undefined && cursor.at <= cursor.after) || (cursor.before !== undefined && cursor.at >= cursor.before)) {
      return c.json({ error: 'at must lie between after and before' }, 400);
    }
    if (!repo.has(id, cursor.at)) return c.json({ error: 'event not found' }, 404);
  }
  return c.json(readPage(id, cursor));
});

/** One row of the thread, whole: what "Show all" on a clipped row reads. */
threadHistoryApi.get('/:id/events/:eventId', (c) => {
  const id = c.req.param('id');
  const eventId = c.req.param('eventId');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const row = /^\d{1,15}$/.test(eventId) ? repo.row(id, Number(eventId)) : null;
  return row ? c.json(row) : c.json({ error: 'event not found' }, 404);
});

/** The thread's matches for `q`, case-insensitive, ascending by event (packages/shared/thread-find.ts `FindAnswer`). */
threadHistoryApi.get('/:id/find', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const q = c.req.query('q') ?? '';
  if (q.length > FIND_MAX_QUERY) return c.json({ error: `q is at most ${FIND_MAX_QUERY} characters` }, 400);
  return c.json(findInThread(id, q));
});
