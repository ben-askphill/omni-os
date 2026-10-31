import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixture } from '@omni/test-fixtures';
import {
  appendLive,
  applyHead,
  applyPage,
  atStart,
  boundHistory,
  cut,
  detachHead,
  earlierCursor,
  emptyHistory,
  historyEdges,
  historyQuery,
  laterCursor,
  openHistory,
  parseHistoryQuery,
  replaceRow,
  revealCursor,
  spanIndex,
  spanOf,
  tailId,
  turnCount,
  unionSpans,
  type History,
  type HistoryHead,
  type HistoryPage,
  type HistoryRow,
  type Retain,
} from '../history.ts';

// The client half is ported to Swift (OmniKit/History.swift). Its tests replay packages/test-fixtures/history/spans.json,
// which this file writes with OMNI_RECORD_HISTORY_CORPUS=1 and checks otherwise.

const row = (id: number, kind = 'assistant_text', clipped = false): HistoryRow => ({
  id,
  thread_id: 't',
  kind,
  payload: clipped ? '{"text":"cut…"}' : `{"text":"row ${id}"}`,
  created_at: '2026-10-24T10:00:00.000Z',
  ...(clipped && { clipped: { bytes: 90_000 } }),
});
const rows = (...ids: number[]) => ids.map((id) => row(id));
/** A tool_use row for call `call`, nested under call `parent`. */
const use = (id: number, call: string, parent?: string): HistoryRow => ({
  id,
  thread_id: 't',
  kind: 'tool_use',
  payload: JSON.stringify({ id: call, name: 'Agent', input: {}, ...(parent && { parent }) }),
  created_at: '2026-10-24T10:00:00.000Z',
});
const head = (from: number, results_below = 0): HistoryHead => ({ from, to: null, results_below });

type Step =
  | { op: 'open'; events: HistoryRow[]; head: HistoryHead }
  | { op: 'head'; events: HistoryRow[]; head: HistoryHead }
  | { op: 'page'; page: HistoryPage }
  | { op: 'live'; rows: HistoryRow[] }
  | { op: 'replace'; row: HistoryRow }
  | { op: 'detach' }
  | { op: 'bound'; follows: boolean; retain: Retain };

function run(steps: Step[]): History {
  let h: History = emptyHistory;
  for (const s of steps) {
    if (s.op === 'open') h = openHistory(s.events, s.head);
    else if (s.op === 'head') h = applyHead(h, s.events, s.head);
    else if (s.op === 'page') h = applyPage(h, s.page);
    else if (s.op === 'live') h = appendLive(h, s.rows);
    else if (s.op === 'replace') h = replaceRow(h, s.row);
    else if (s.op === 'bound') h = boundHistory(h, s.follows, s.retain);
    else h = detachHead(h);
  }
  return h;
}

/** Everything a client reads off a state, for the corpus. */
function observe(h: History, probes: { reveal: number[]; keys: number[] }) {
  return {
    ids: h.rows.map((r) => r.id),
    clipped: h.rows.filter((r) => r.clipped).map((r) => r.id),
    spans: h.spans,
    atStart: atStart(h),
    tailId: tailId(h),
    turnCount: turnCount(h),
    earlier: h.spans.map((_, i) => earlierCursor(h, i)),
    later: h.spans.map((_, i) => laterCursor(h, i)),
    reveal: probes.reveal.map((id) => ({ id, cursor: revealCursor(h, id), span: spanIndex(h.spans, id) })),
    edges: [...historyEdges(h, probes.keys)].sort((a, b) => a[0] - b[0]),
  };
}

const CASES: { name: string; steps: Step[]; reveal: number[]; keys: number[] }[] = [
  {
    name: 'open-at-start',
    steps: [{ op: 'open', events: rows(1, 2, 3), head: head(0) }],
    reveal: [2, 9],
    keys: [1, 2, 3],
  },
  {
    name: 'open-then-earlier-pages-to-the-start',
    steps: [
      { op: 'open', events: [row(40, 'init'), row(55, 'result'), ...rows(60, 61, 62)], head: head(60, 3) },
      { op: 'page', page: { events: [row(30), row(31, 'result'), ...rows(40, 50), row(55, 'result')], span: { from: 30, to: 60 } } },
      { op: 'page', page: { events: rows(1, 2, 20), span: { from: 0, to: 30 } } },
    ],
    reveal: [2, 31, 61],
    keys: [1, 20, 30, 50, 60],
  },
  {
    name: 'reveal-island-then-fill-the-gap-both-ways',
    steps: [
      { op: 'open', events: rows(500, 510, 520), head: head(500, 9) },
      { op: 'page', page: { events: [...rows(100, 110), row(120, 'result')], span: { from: 100, to: 121 } } },
      { op: 'page', page: { events: [...rows(130, 140), row(150, 'result')], span: { from: 121, to: 151 } } },
      { op: 'page', page: { events: rows(300, 400), span: { from: 300, to: 500 } } },
    ],
    reveal: [105, 200, 450, 99],
    keys: [100, 110, 130, 300, 400, 500, 520],
  },
  {
    name: 'gap-closes-when-a-page-reaches-the-span-above',
    steps: [
      { op: 'open', events: rows(500, 510), head: head(500) },
      { op: 'page', page: { events: rows(100, 110), span: { from: 100, to: 200 } } },
      { op: 'page', page: { events: rows(200, 250), span: { from: 200, to: 500 } } },
    ],
    reveal: [150, 300],
    keys: [100, 200, 500],
  },
  {
    name: 'pages-land-twice-and-out-of-order',
    steps: [
      { op: 'open', events: rows(500), head: head(500) },
      { op: 'page', page: { events: rows(1, 2), span: { from: 0, to: 100 } } },
      { op: 'page', page: { events: rows(300), span: { from: 300, to: 500 } } },
      { op: 'page', page: { events: rows(300), span: { from: 300, to: 500 } } },
      { op: 'page', page: { events: rows(100, 200), span: { from: 100, to: 300 } } },
    ],
    reveal: [150],
    keys: [1, 100, 300, 500],
  },
  {
    name: 'anchors-outside-spans-and-clipped-copies',
    steps: [
      { op: 'open', events: [row(10, 'tool_use'), row(20, 'init'), row(500, 'tool_use', true), ...rows(510)], head: head(500) },
      { op: 'replace', row: row(500, 'tool_use') },
      { op: 'page', page: { events: [row(500, 'tool_use', true), ...rows(300)], span: { from: 300, to: 500 } } },
      { op: 'live', rows: rows(510, 520, 530) },
    ],
    reveal: [10, 20, 400],
    keys: [300, 510, 520, 530],
  },
  {
    name: 'reconnect-head-joins-and-detach-makes-an-island',
    steps: [
      { op: 'open', events: rows(500, 510), head: head(500, 4) },
      { op: 'live', rows: rows(520) },
      { op: 'head', events: rows(515, 520, 530), head: head(515, 6) },
      { op: 'detach' },
      { op: 'head', events: rows(900, 910), head: head(900, 8) },
    ],
    reveal: [700, 520],
    keys: [500, 520, 530, 900, 910],
  },
  {
    name: 'bound-cuts-at-a-turn-start-and-keeps-anchors',
    steps: [
      {
        op: 'open',
        events: [row(10, 'init'), use(20, 'a'), row(30), row(40, 'result'), row(50), use(60, 'b', 'a'), row(70, 'result'), row(80, 'result')],
        head: head(10, 2),
      },
      { op: 'live', rows: [row(90), row(100, 'result'), use(110, 'c', 'b'), row(120)] },
      { op: 'bound', follows: true, retain: { rows: 4, slack: 2, hard: 8 } },
      { op: 'bound', follows: false, retain: { rows: 4, slack: 2, hard: 8 } },
    ],
    reveal: [50, 110],
    keys: [90, 100, 110, 120],
  },
  {
    name: 'bound-cuts-one-long-turn-only-while-following',
    steps: [
      { op: 'open', events: rows(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), head: head(0) },
      { op: 'bound', follows: false, retain: { rows: 4, slack: 2, hard: 20 } },
      { op: 'bound', follows: true, retain: { rows: 4, slack: 2, hard: 20 } },
    ],
    reveal: [3, 8],
    keys: [7, 8, 9, 10],
  },
  {
    name: 'bound-drops-older-islands',
    steps: [
      { op: 'open', events: rows(500, 510, 520), head: head(500, 9) },
      { op: 'page', page: { events: [...rows(100, 110), row(120, 'result')], span: { from: 100, to: 121 } } },
      { op: 'live', rows: rows(530, 540) },
      { op: 'bound', follows: true, retain: { rows: 3, slack: 1, hard: 99 } },
    ],
    reveal: [110, 510],
    keys: [520, 530, 540],
  },
];

describe('history cursors', () => {
  it('writes and reads every cursor the same way', () => {
    for (const c of [{ take: 'newest' as const }, { take: 'newest' as const, before: 9, after: 2 }, { take: 'oldest' as const, after: 3, before: 7 }, { at: 5, after: 1 }]) {
      const q = new URLSearchParams(historyQuery(c));
      expect(parseHistoryQuery((n) => q.get(n) ?? undefined)).toEqual(c);
    }
  });

  it('refuses what no cursor means', () => {
    const parse = (s: string) => {
      const q = new URLSearchParams(s);
      return parseHistoryQuery((n) => q.get(n) ?? undefined);
    };
    expect(parse('before=abc')).toEqual({ error: 'before must be an event id' });
    expect(parse('before=-4')).toEqual({ error: 'before must be an event id' });
    expect(parse('after=9&before=9')).toEqual({ error: 'before must be greater than after' });
    expect(parse('take=oldest')).toEqual({ error: 'take=oldest needs after' });
    expect(parse('at=3&take=oldest')).toEqual({ error: 'at takes no take' });
    expect(parse('take=sideways')).toEqual({ error: 'take is newest or oldest' });
    expect(parse('')).toEqual({ take: 'newest' });
  });
});

describe('cut', () => {
  const r = (id: number, kind = 'x') => ({ id, kind });
  const one = () => 1;
  const budget = { rows: 4, bytes: 100 };

  it('keeps the whole read when it ran out, without snapping', () => {
    expect(cut([r(9), r(8, 'result'), r(7)], 'newest', one, budget)).toEqual({ kept: [r(9), r(8, 'result'), r(7)], next: null });
  });

  it('starts a newest page right after the oldest turn end it holds', () => {
    const read = [r(9), r(8, 'result'), r(7), r(6, 'result'), r(5)];
    expect(cut(read, 'newest', one, budget)).toEqual({ kept: [r(9), r(8, 'result'), r(7)], next: 6 });
  });

  it('never snaps a newest page to nothing: a turn end at its newest row is not a boundary', () => {
    const read = [r(9, 'result'), r(8), r(7), r(6), r(5)];
    expect(cut(read, 'newest', one, budget)).toEqual({ kept: [r(9, 'result'), r(8), r(7), r(6)], next: 5 });
  });

  it('ends an oldest page on the newest turn end it holds', () => {
    const read = [r(1), r(2, 'result'), r(3), r(4, 'result'), r(5)];
    expect(cut(read, 'oldest', one, budget)).toEqual({ kept: [r(1), r(2, 'result'), r(3), r(4, 'result')], next: 5 });
    expect(cut([r(1), r(2, 'result'), r(3), r(4), r(5)], 'oldest', one, budget)).toEqual({ kept: [r(1), r(2, 'result')], next: 3 });
  });

  it('stops at the byte budget but always keeps the first row', () => {
    const read = [r(9), r(8), r(7)];
    expect(cut(read, 'newest', () => 60, budget)).toEqual({ kept: [r(9)], next: 8 });
    expect(cut(read, 'newest', () => 500, budget)).toEqual({ kept: [r(9)], next: 8 });
  });

  it('gives spans with exact edges', () => {
    expect(spanOf([{ id: 9 }, { id: 7 }], 6, 'newest')).toEqual({ from: 7, to: null });
    expect(spanOf([{ id: 9 }, { id: 7 }], null, 'newest', 3, 10)).toEqual({ from: 4, to: 10 });
    expect(spanOf([{ id: 9 }, { id: 7 }], null, 'newest')).toEqual({ from: 0, to: null });
    expect(spanOf([], null, 'newest', undefined, 10)).toEqual({ from: 0, to: 10 });
    expect(spanOf([{ id: 4 }, { id: 5 }], 6, 'oldest', 3, 10)).toEqual({ from: 4, to: 6 });
    expect(spanOf([{ id: 4 }, { id: 5 }], null, 'oldest', 3, 10)).toEqual({ from: 4, to: 10 });
    expect(spanOf([{ id: 4 }], null, 'oldest', 3)).toEqual({ from: 4, to: null });
  });
});

describe('history joins', () => {
  const a: HistoryPage = { events: rows(10, 11), span: { from: 10, to: 20 } };
  const b: HistoryPage = { events: rows(20, 25), span: { from: 20, to: 30 } };
  const c: HistoryPage = { events: [row(5), row(11, 'x', true)], span: { from: 5, to: 10 } };
  const start = openHistory(rows(40, 41), head(40));

  it('is idempotent, commutative and associative', () => {
    const ab = applyPage(applyPage(start, a), b);
    expect(applyPage(ab, a)).toEqual(ab);
    expect(applyPage(applyPage(start, b), a)).toEqual(ab);
    const all = [a, b, c];
    const orders = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [0, 2, 1]];
    const results = orders.map((o) => o.reduce((h, i) => applyPage(h, all[i]), start));
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it('merges touching spans and keeps the unclipped copy of a row', () => {
    const h = [a, b, c].reduce(applyPage, start);
    expect(h.spans).toEqual([{ from: 5, to: 30 }, { from: 40, to: null }]);
    expect(h.rows.find((r) => r.id === 11)?.clipped).toBeUndefined();
    expect(unionSpans([{ from: 1, to: 5 }, { from: 5, to: null }])).toEqual([{ from: 1, to: null }]);
  });

  it('returns the same state when the stream sends nothing new', () => {
    expect(appendLive(start, rows(40, 41))).toBe(start);
  });

  it('bounds what it holds and leaves a small history as it is', () => {
    const live = Array.from({ length: 40 }, (_, i) => row(100 + i, i % 5 === 4 ? 'result' : 'assistant_text'));
    const retain = { rows: 10, slack: 5, hard: 30 };
    let h = openHistory(rows(1, 2), head(0));
    expect(boundHistory(h, true, retain)).toBe(h);
    let total = 0;
    for (const r of live) {
      h = boundHistory(appendLive(h, [r]), true, retain);
      if (r.kind === 'result') total++;
      expect(h.rows.length).toBeLessThanOrEqual(retain.rows + retain.slack);
      expect(turnCount(h)).toBe(total);
    }
    // Every cut lands right after a result, so the head starts a turn.
    expect(h.rows[0].id).toBe(h.spans[0].from);
    expect(live.find((r) => r.id === h.spans[0].from - 1)?.kind).toBe('result');
    expect(earlierCursor(h)).toEqual({ take: 'newest', before: h.spans[0].from });
  });

  it('counts turns held and below the head', () => {
    const h = openHistory([row(3, 'result'), row(40, 'result'), row(41)], head(40, 7));
    expect(turnCount(h)).toBe(8);
  });
});

describe('history corpus (TS and Swift)', () => {
  const path = fixture('history', 'spans.json');
  const corpus = { cases: CASES.map((k) => ({ name: k.name, steps: k.steps, reveal: k.reveal, keys: k.keys, expect: observe(run(k.steps), k) })) };

  it('matches what Swift replays', () => {
    if (process.env.OMNI_RECORD_HISTORY_CORPUS) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(corpus, null, 2)}\n`);
    }
    expect(existsSync(path), `record it with OMNI_RECORD_HISTORY_CORPUS=1`).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(JSON.parse(JSON.stringify(corpus)));
  });

  it('keeps the invariants in every case', () => {
    for (const k of CASES) {
      const h = run(k.steps);
      const ids = h.rows.map((r) => r.id);
      expect(ids, k.name).toEqual([...new Set(ids)].sort((x, y) => x - y));
      for (let i = 1; i < h.spans.length; i++) expect(h.spans[i - 1].to! < h.spans[i].from, k.name).toBe(true);
      expect(h.spans[h.spans.length - 1]?.to, k.name).toBeNull();
    }
  });
});
