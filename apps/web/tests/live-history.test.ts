import { describe, expect, it } from 'vitest';
import { appendLive, applyPage, boundHistory, earlierCursor, openHistory, RETAIN, spanIndex, TURN_END, turnCount, type History, type HistoryRow } from '@omni/shared/history.ts';
import { buildItems, keepSame, type TranscriptEvent } from '../src/transcript/fold.ts';
import { historyServer, longRows } from './history-sim.ts';

// A thread held open while its agent streams for hours (#411): the client opens on the head of an 80-turn thread, and
// the next 320 turns stream in, 8 rows a frame, through appendLive and boundHistory as useThreadHistory does it.

const opts = { hugeResult: 20_000, hugeWrite: 20_000 };
const all = longRows({ turns: 400, ...opts });
const opened = longRows({ turns: 80, ...opts }).length;
const results = (rows: readonly HistoryRow[]) => rows.filter((r) => r.kind === TURN_END).length;

function soak(follows: boolean, check: (h: History, streamed: number) => void) {
  const { events, head } = historyServer(all.slice(0, opened)).head();
  let h: History = openHistory(events, head);
  for (let i = opened; i < all.length; i += 8) {
    h = boundHistory(appendLive(h, all.slice(i, i + 8)), follows);
    check(h, Math.min(i + 8, all.length));
  }
  return h;
}

describe('a thread held open for a long session', () => {
  it('holds a bounded number of rows while Ben follows the newest, and counts every turn', () => {
    let peak = 0;
    let trims = 0;
    let from = 0;
    const h = soak(true, (h, streamed) => {
      peak = Math.max(peak, h.rows.length);
      if (h.spans[0].from !== from) trims++;
      from = h.spans[0].from;
      expect(turnCount(h)).toBe(results(all.slice(0, streamed)));
    });
    expect(peak).toBeLessThanOrEqual(RETAIN.rows + RETAIN.slack);
    // A step every few hundred rows, not one per frame.
    expect(trims).toBeGreaterThan(5);
    expect(trims).toBeLessThan((all.length - opened) / RETAIN.slack + 2);
    expect(h.rows.at(-1)?.id).toBe(all.at(-1)?.id);
  });

  it('keeps more while Ben reads older rows, up to the hard limit', () => {
    let peak = 0;
    soak(false, (h) => {
      peak = Math.max(peak, h.rows.length);
    });
    expect(peak).toBeGreaterThan(RETAIN.rows + RETAIN.slack);
    expect(peak).toBeLessThanOrEqual(RETAIN.hard);
  });

  it('shows what the whole thread shows inside the rows it kept, and loads the dropped ones back', () => {
    const h = soak(true, () => {});
    // Each cut lands at a turn start.
    const floor = h.spans[0].from;
    expect(all[all.findIndex((r) => r.id === floor) - 1].kind).toBe(TURN_END);
    const full = buildItems(all as TranscriptEvent[]).items.filter((it) => spanIndex(h.spans, it.key) >= 0);
    expect(buildItems(h.rows as TranscriptEvent[], h.spans).items).toEqual(full);

    const cursor = earlierCursor(h);
    expect(cursor).toEqual({ take: 'newest', before: floor });
    const back = applyPage(h, historyServer(all).page(cursor!));
    expect(back.spans).toHaveLength(1);
    expect(back.spans[0].from).toBeLessThan(floor);
  });

  it('keeps the parent call of a background agent whose calls outlive the cut', () => {
    // The background agent starts in turn 70 and its calls land in turns 71 and 72: cut right after turn 70.
    const rows = all.slice(0, longRows({ turns: 73, ...opts }).length);
    const turn71 = rows.findIndex((r, i) => i > 0 && rows[i - 1].kind === TURN_END && results(rows.slice(0, i)) === 71);
    const h = boundHistory(openHistory(rows, { from: 0, to: null, results_below: 0 }), true, { rows: rows.length - turn71, slack: 1, hard: 1e9 });
    expect(h.spans[0].from).toBe(rows[turn71].id);
    const parent = h.rows.find((r) => r.kind === 'tool_use' && JSON.parse(r.payload).id === 'call-bg-70');
    expect(parent && spanIndex(h.spans, parent.id)).toBe(-1);
    const nested = buildItems(h.rows as TranscriptEvent[], h.spans).items.flatMap((it) => (it.type === 'tools' ? it.calls : [])).filter((c) => c.orphan);
    expect(nested).toEqual([]);
  });
});

describe('folding again', () => {
  it('keeps every unchanged item the same object', () => {
    const rows = all.slice(0, opened) as TranscriptEvent[];
    const first = buildItems(rows.slice(0, -40)).items;
    const next = keepSame(first, buildItems(rows).items);
    const kept = next.filter((it, i) => it === first[i]).length;
    expect(kept).toBeGreaterThan(first.length - 4);
    expect(next).toEqual(buildItems(rows).items);
    // A fold of the same rows changes nothing.
    expect(keepSame(next, buildItems(rows).items).every((it, i) => it === next[i])).toBe(true);
  });
});
