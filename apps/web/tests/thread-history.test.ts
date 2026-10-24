import { describe, expect, it } from 'vitest';
import { LONG_THREAD } from '@omni/test-fixtures/long-thread.ts';
import { appendLive, applyHead, atStart, earlierCursor, emptyHistory, historyQuery, laterCursor, openHistory, revealCursor, tailId, turnCount, type History, type HistoryPage, type HistoryRow } from '@omni/shared/history.ts';
import { headOf, historyLoader, keyAtOrBefore, opening } from '../src/thread-history.ts';
import { historyServer, longRows } from './history-sim.ts';

// The Web UI's thread session over a paged history: what the desktop transcript and the phone thread screen load.

const ROWS = longRows();
const needleOf = (rows: HistoryRow[]) => rows.find((r) => r.kind === 'user' && r.payload.includes(LONG_THREAD.oldNeedle))!.id;

/** A loader over the in-memory server, with its state in a variable and every request counted. */
function session(fail = new Set<string>()) {
  const server = historyServer(ROWS);
  const head = server.head();
  let h: History = openHistory(head.events, head.head);
  const asked: string[] = [];
  let changes = 0;
  const loader = historyLoader<HistoryRow>({
    page: async (q) => {
      asked.push(q);
      if (fail.has(q)) throw new Error('Cannot reach the Omni server. Is it running?');
      const p = new URLSearchParams(q);
      const n = (k: string) => (p.has(k) ? Number(p.get(k)) : undefined);
      const at = n('at');
      return server.page(at !== undefined ? { at, after: n('after'), before: n('before') } : p.get('take') === 'oldest' ? { take: 'oldest', after: n('after')!, before: n('before') } : { take: 'newest', after: n('after'), before: n('before') });
    },
    row: async (id) => {
      asked.push(`row ${id}`);
      return ROWS.find((r) => r.id === id)!;
    },
    get: () => h,
    update: (fn) => {
      h = fn(h);
    },
    changed: () => changes++,
  });
  return { server, loader, asked, state: () => h, changes: () => changes, set: (next: History) => (h = next) };
}

describe('thread history session', () => {
  it('opens on the head with a turn count for the whole thread', () => {
    const s = session();
    const h = s.state();
    expect(atStart(h)).toBe(false);
    expect(h.rows.length).toBeLessThan(ROWS.length / 5);
    expect(turnCount(h)).toBe(ROWS.filter((r) => r.kind === 'result').length);
    expect(tailId(h)).toBe(ROWS[ROWS.length - 1].id);
  });

  it('asks once for an edge however often it is asked, and says it is loading meanwhile', async () => {
    const s = session();
    const c = earlierCursor(s.state());
    const both = Promise.all([s.loader.load(c), s.loader.load(c)]);
    expect(s.loader.busy(c)).toBe(true);
    expect(await both).toEqual([true, true]);
    expect(s.asked).toHaveLength(1);
    expect(s.loader.busy(c)).toBe(false);
    expect(s.state().spans).toHaveLength(1);
    expect(s.state().spans[0].from).toBeLessThan(c!.before!);
    expect(s.changes()).toBe(2);
  });

  it('pages to the start and then has nothing earlier', async () => {
    const s = session();
    while (earlierCursor(s.state())) await s.loader.load(earlierCursor(s.state()));
    expect(atStart(s.state())).toBe(true);
    expect(s.state().rows.map((r) => r.id)).toEqual(ROWS.map((r) => r.id));
  });

  it('keeps an error on the edge that failed until a retry gets through', async () => {
    const first = earlierCursor(session().state())!;
    const fail = new Set([historyQuery(first)]);
    const s = session(fail);
    expect(await s.loader.load(first)).toBe(false);
    expect(s.loader.error(first)).toMatch(/Cannot reach/);
    fail.clear();
    expect(await s.loader.load(first)).toBe(true);
    expect(s.loader.error(first)).toBeNull();
  });

  it('reveals an old message with one request, and none when it is already held', async () => {
    const s = session();
    const needle = needleOf(ROWS);
    expect(await s.loader.reveal(needle)).toBe(true);
    expect(s.asked).toHaveLength(1);
    expect(s.state().spans).toHaveLength(2);
    expect(s.state().rows.some((r) => r.id === needle)).toBe(true);
    await s.loader.reveal(needle);
    await s.loader.reveal(tailId(s.state()));
    expect(s.asked).toHaveLength(1);
    expect(laterCursor(s.state(), 0)).not.toBeNull();
  });

  it('opens straight onto the page holding a search hit', async () => {
    const s = session();
    const head = s.server.head();
    const needle = needleOf(ROWS);
    const page = async (q: string): Promise<HistoryPage> => {
      const p = new URLSearchParams(q);
      return s.server.page({ at: Number(p.get('at')), before: Number(p.get('before')) });
    };
    const h = await opening(head.events, head.head, needle, page);
    expect(revealCursor(h, needle)).toBeNull();
    expect(await opening(head.events, head.head, undefined, page)).toEqual(openHistory(head.events, head.head));
    const down = await opening(head.events, head.head, needle, () => Promise.reject(new Error('down')));
    expect(down).toEqual(openHistory(head.events, head.head));
  });

  it('shows a clipped row whole on request', async () => {
    const s = session();
    const huge = s.state().rows.find((r) => r.clipped)!;
    expect(huge.payload.length).toBeLessThan(40_000);
    await s.loader.showAll(huge.id);
    expect(s.asked).toEqual([`row ${huge.id}`]);
    const whole = s.state().rows.find((r) => r.id === huge.id)!;
    expect(whole.clipped).toBeUndefined();
    expect(whole.payload.length).toBeGreaterThan(1_000_000);
  });

  it('takes live rows at the tail and a reconnect head without losing older pages', async () => {
    const s = session();
    await s.loader.load(earlierCursor(s.state()));
    const before = s.state();
    const next = ROWS[ROWS.length - 1].id + 3;
    const live = { id: next, thread_id: 't', kind: 'assistant_text', payload: '{"text":"more"}', created_at: '2026-10-24T11:00:00.000Z' };
    s.set(appendLive(s.state(), [live]));
    expect(tailId(s.state())).toBe(next);
    const head = s.server.head();
    s.set(applyHead(s.state(), [...head.events, live], head.head));
    expect(s.state().spans).toEqual(before.spans);
    expect(s.state().rows).toHaveLength(before.rows.length + 1);
  });

  it('reads an older server that sends every event as the whole thread', () => {
    const h = openHistory(ROWS, headOf({}));
    expect(atStart(h)).toBe(true);
    expect(earlierCursor(h)).toBeNull();
    expect(openHistory([], headOf({}))).toEqual({ ...emptyHistory, spans: [{ from: 0, to: null }] });
  });

  it('finds the shown row or turn an event is in', () => {
    expect(keyAtOrBefore([10, 20, 30], 25)).toBe(20);
    expect(keyAtOrBefore([10, 20, 30], 30)).toBe(30);
    expect(keyAtOrBefore([10, 20, 30], 5)).toBeNull();
    expect(keyAtOrBefore([], 5)).toBeNull();
  });
});
