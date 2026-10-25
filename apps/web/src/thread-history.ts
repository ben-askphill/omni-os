// Loading a thread's history page by page (#223), React-free so the tests drive it: useThreadHistory holds the state.
// The state itself and every join on it are @omni/shared/history.ts; this adds the requests, one in flight per
// cursor, and what each control shows while one runs or after one failed.
import { ALL, appendLive, applyHead, applyPage, detachHead, historyQuery, openHistory, replaceRow, revealCursor, spanIndex, type History, type HistoryCursor, type HistoryHead, type HistoryPage, type HistoryRow } from '@omni/shared/history.ts';
import { errorText } from './api.ts';

/** The head a detail answer carries; an older server sends every event and no head, which is the whole thread. */
export const headOf = (d: { history?: HistoryHead }): HistoryHead => d.history ?? { from: ALL.from, to: null, results_below: 0 };

export interface HistoryIO<R extends HistoryRow> {
  /** GET /threads/:id/history?<query>. */
  page: (query: string) => Promise<HistoryPage<R>>;
  /** GET /threads/:id/events/:eventId. */
  row: (eventId: number) => Promise<R>;
  get: () => History<R>;
  update: (fn: (h: History<R>) => History<R>) => void;
  /** What is loading or failed changed. */
  changed: () => void;
}

export function historyLoader<R extends HistoryRow>(io: HistoryIO<R>) {
  const inflight = new Map<string, Promise<boolean>>();
  const errors = new Map<string, string>();

  const run = (key: string, load: () => Promise<(h: History<R>) => History<R>>): Promise<boolean> => {
    const known = inflight.get(key);
    if (known) return known;
    errors.delete(key);
    const p = load().then(
      (fn) => {
        io.update(fn);
        return true;
      },
      (e: unknown) => {
        errors.set(key, errorText(e));
        return false;
      },
    );
    const done = p.finally(() => {
      inflight.delete(key);
      io.changed();
    });
    inflight.set(key, done);
    io.changed();
    return done;
  };

  const pageKey = (c: HistoryCursor) => `page:${historyQuery(c)}`;
  const rowKey = (id: number) => `row:${id}`;

  /** Loads the page a cursor names and joins it in. True once it is held; a second call while one runs waits on it. */
  const load = (c: HistoryCursor | null): Promise<boolean> =>
    c
      ? run(pageKey(c), async () => {
          const page = await io.page(historyQuery(c));
          return (h) => applyPage(h, page);
        })
      : Promise.resolve(true);

  return {
    load,
    /** Makes sure the page holding `eventId` is held. */
    reveal: (eventId: number) => load(revealCursor(io.get(), eventId)),
    /** A clipped row whole, in place of its clipped copy. */
    showAll: (eventId: number) =>
      run(rowKey(eventId), async () => {
        const row = await io.row(eventId);
        return (h) => replaceRow(h, row);
      }),
    busy: (c: HistoryCursor | null) => !!c && inflight.has(pageKey(c)),
    error: (c: HistoryCursor | null) => (c && errors.get(pageKey(c))) ?? null,
    rowBusy: (eventId: number) => inflight.has(rowKey(eventId)),
    rowError: (eventId: number) => errors.get(rowKey(eventId)) ?? null,
  };
}

/**
 * A stream sync that carries a page instead of a replay (#224). `live`: rows the stream brought that are not joined
 * yet, which belong to the old head. That head closes into an island, and the fresh head joins above it.
 */
export function joinSnapshot<R extends HistoryRow>(h: History<R>, live: readonly R[], events: readonly R[], head: HistoryHead): History<R> {
  return applyHead(detachHead(appendLive(h, live)), events, head);
}

/** A thread's first state: its head, and the page holding `at` when Ben opened it at an older event. */
export async function opening<R extends HistoryRow>(events: R[], head: HistoryHead, at: number | undefined, page: HistoryIO<R>['page']): Promise<History<R>> {
  const h = openHistory(events, head);
  const c = at ? revealCursor(h, at) : null;
  if (!c) return h;
  try {
    return applyPage(h, await page(historyQuery(c)));
  } catch {
    // The head still opens; the reveal tries again from the screen and shows its error there.
    return h;
  }
}

/** The shown key to scroll to for an event: its own item, else the last one before it (the turn holding it). */
export function keyAtOrBefore(keys: readonly number[], eventId: number): number | null {
  let lo = 0;
  let hi = keys.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] <= eventId) {
      found = keys[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Whether an event is held whole, so a reveal can scroll to it. */
export const holds = (h: Pick<History, 'spans'>, eventId: number) => spanIndex(h.spans, eventId) >= 0;
