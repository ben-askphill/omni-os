// What a thread's stream sends when it connects, before it goes live (#224): the rows the client missed when they fit
// one page, else the newest page in their place, then one `sync` with the thread's state now. A client applies the
// sync instead of fetching the detail again. Why and how the clients join it: docs/internals/thread-history.md.
import type { HistoryHead } from '@omni/shared/history.ts';
import { lastContext } from './context.ts';
import { events } from './db.ts';
import { BUDGET, clip, headPage, readAfter, type PageRow } from './history.ts';

export type CatchUp = { mode: 'replay'; rows: PageRow[] } | { mode: 'snapshot'; events: PageRow[]; history: HistoryHead };

/** The detail GET /api/threads/:id answers with, with `page`'s events. Null when there is no thread. */
export type DetailOf = (page: { events: PageRow[]; history?: HistoryHead }) => object | null;

export interface SSEMessage {
  id?: string;
  data: string;
}

/** The stream's `after`: an event id, else null, which reads as stale. */
export function parseAfter(raw: string | undefined): number | null {
  return raw !== undefined && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

/**
 * Replays the rows after `after` when they fit one page (HISTORY_BUDGET), else sends the newest page. A stale `after`
 * (none, or past the thread's newest row) gets the newest page too.
 */
export function catchUp(threadId: string, after: number | null): CatchUp {
  if (after !== null && after <= events.lastId(threadId)) {
    const rows = readAfter(threadId, after);
    if (rows) return { mode: 'replay', rows };
  }
  return { mode: 'snapshot', ...headPage(threadId) };
}

const isRow = (e: unknown): e is PageRow => !!e && typeof (e as PageRow).id === 'number' && typeof (e as PageRow).payload === 'string';
const message = (e: unknown): SSEMessage => ({ id: isRow(e) ? String(e.id) : undefined, data: JSON.stringify(e) });

/**
 * The messages a connection opens with. `queue` holds what the bus sent since the stream subscribed, which is before
 * this read: rows in it that the catch-up carries are dropped (`sent` remembers them for later), and so are thread,
 * artifact and context messages, which the sync and the context sent here supersede.
 * A snapshot's sync takes the page's newest row id as its SSE id, so a client resumes after the page it just got.
 */
export function openingMessages(threadId: string, after: number | null, detailOf: DetailOf, queue: unknown[], sent: Set<number>): SSEMessage[] {
  const up = catchUp(threadId, after);
  const out: SSEMessage[] = [];
  let sync: object | null;
  let id: string | undefined;
  if (up.mode === 'replay') {
    for (const r of up.rows) {
      sent.add(r.id);
      out.push(message(r));
    }
    sync = detailOf({ events: [] });
  } else {
    for (const r of up.events) sent.add(r.id);
    sync = detailOf({ events: up.events, history: up.history });
    const tail = up.events.length ? up.events[up.events.length - 1].id : 0;
    // Not when it is at or below `after` (the client's newest row was deleted): a client that saw that id drops it.
    if (tail && (after === null || tail > after)) id = String(tail);
  }
  if (sync) out.push({ id, data: JSON.stringify({ kind: 'sync', catch_up: up.mode, ...sync }) });
  const context = lastContext(threadId);
  if (context) out.push(message({ kind: 'context', context }));
  const fresh = queue.filter((e) => (isRow(e) ? !sent.has(e.id) : (e as { kind?: string })?.kind === 'mod_toast'));
  queue.splice(0, queue.length, ...fresh);
  return out;
}

/** A message from the bus as the stream sends it: a row clipped like a page's, null for one already sent. */
export function liveMessage(e: unknown, sent: ReadonlySet<number>): SSEMessage | null {
  if (!isRow(e)) return message(e);
  if (sent.has(e.id)) return null;
  return message(clip(e, BUDGET.rowBytes));
}
