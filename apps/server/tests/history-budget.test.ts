import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HISTORY_BUDGET,
  TURN_END,
  applyPage,
  earlierCursor,
  historyQuery,
  openHistory,
  revealCursor,
  type HistoryCursor,
  type HistoryHead,
  type HistoryPage,
  type HistoryRow,
  type Span,
} from '@omni/shared/history.ts';
import { TOOL_OUTPUT } from '@omni/shared/tool-output.ts';
import { LONG_THREAD, longThread } from '@omni/test-fixtures/long-thread.ts';
import { startRunner } from './runner-boot.ts';

// Bounded thread history (#223) on the long fixture: ~80 turns and ~3,600 events with a 4 MB tool result, a 1.5 MB
// Write, a 160 KB pasted log, a background agent whose calls land in later turns, a question and a kind no client
// knows. Every page stays within HISTORY_BUDGET, paging reaches the start visiting each row once, and each read is
// indexed. The numbers are recorded in packages/test-fixtures/history/baseline.json and checked exactly, since the
// fixture is deterministic. To record them again after a deliberate change:
//   OMNI_RECORD_HISTORY_BASELINE=1 npx vitest run --config apps/server/vitest.config.ts apps/server/tests/history-budget.test.ts

const BASELINE = resolve(import.meta.dirname, '../../../packages/test-fixtures/history/baseline.json');
const RECORD = process.env.OMNI_RECORD_HISTORY_BASELINE === '1';
const B = HISTORY_BUDGET;
const T = { timeout: 60_000 };

const r = await startRunner();
const { app } = await import('../app.ts');
const { HISTORY_SQL } = await import('../db/repos/history.ts');

const ID = 'long-thread';
r.db.threads.create({
  id: ID, channel_id: 'scratch', title: 'Long thread', status: 'done', role: null, model: null, session_id: ID, cwd: r.tmp,
  branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
});
for (const e of longThread()) r.db.events.add(ID, e.kind, e.payload);

type Row = HistoryRow & { thread_id: string };
const all = r.db.events.since(ID) as Row[];
const byId = new Map(all.map((e) => [e.id, e]));
const payload = (e: Row) => JSON.parse(e.payload) as Record<string, any>;
const size = (rows: readonly unknown[]) => rows.reduce<number>((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0);
/** The thread's row just below `id`, if any. */
const below = (id: number) => all.findLast((e) => e.id < id);

const get = async <T>(path: string): Promise<T> => {
  const res = await app.request(`/api${path}`);
  expect(res.status, path).toBe(200);
  return (await res.json()) as T;
};
const page = (c: HistoryCursor) => get<HistoryPage<Row>>(`/threads/${ID}/history?${historyQuery(c)}`);
const head = () => get<{ events: Row[]; history: HistoryHead }>(`/threads/${ID}?history=recent`);

const inside = (s: Span, id: number) => id >= s.from && (s.to === null || id < s.to);
const split = (events: readonly Row[], span: Span) => ({ rows: events.filter((e) => inside(span, e.id)), anchors: events.filter((e) => !inside(span, e.id)) });

/** Within every budget, holding every row of its span, with every nested call's parent call and every question's answer. */
function checkPage(events: readonly Row[], span: Span, label: string) {
  const { rows, anchors } = split(events, span);
  expect(rows.length, `${label}: rows`).toBeLessThanOrEqual(B.rows);
  expect(size(rows), `${label}: bytes`).toBeLessThanOrEqual(B.bytes);
  expect(anchors.length, `${label}: anchors`).toBeLessThanOrEqual(B.anchors);
  expect(size(anchors), `${label}: anchor bytes`).toBeLessThanOrEqual(B.anchorBytes);
  for (const e of events) expect(Buffer.byteLength(JSON.stringify(e)), `${label}: row ${e.id}`).toBeLessThanOrEqual(B.rowBytes);
  expect(rows.map((e) => e.id), `${label}: the whole span`).toEqual(all.filter((e) => inside(span, e.id)).map((e) => e.id));
  const calls = new Set(events.filter((e) => e.kind === 'tool_use').map((e) => payload(e).id));
  for (const e of rows) if (e.kind === 'tool_use' && payload(e).parent) expect(calls, `${label}: parent of ${e.id}`).toContain(payload(e).parent);
  const answered = new Set(events.filter((e) => e.kind === 'question_answer').map((e) => payload(e).id));
  for (const e of rows) if (e.kind === 'question') expect(answered, `${label}: answer to ${e.id}`).toContain(payload(e).id);
  return { rows, anchors };
}

/** No turn edge inside: one turn over the budget, cut mid-turn. */
const partial = (rows: readonly Row[]) => !rows.slice(0, -1).some((e) => e.kind === TURN_END);

const measured: Record<string, unknown> = {};

describe('thread history on a long thread', () => {
  it('opens on the newest page within budget, with the session and the 4 MB result compact', T, async () => {
    const full = await get<{ events: Row[]; history?: unknown }>(`/threads/${ID}`);
    expect(full.events.length).toBe(all.length);
    expect(full.history).toBeUndefined();

    const d = await head();
    const { rows, anchors } = checkPage(d.events, d.history, 'head');
    expect(d.history.to).toBeNull();
    expect(below(d.history.from)?.kind, 'the head starts right after a result').toBe(TURN_END);
    expect(rows.at(-1)?.id).toBe(all.at(-1)!.id);
    expect(d.history.results_below).toBe(all.filter((e) => e.kind === TURN_END && e.id < d.history.from).length);
    // The head holds no init: the session's comes along.
    expect(rows.some((e) => e.kind === 'init')).toBe(false);
    expect(anchors.map((e) => e.id)).toContain(all.findLast((e) => e.kind === 'init' && e.id < d.history.from)!.id);

    const huge = rows.find((e) => e.kind === 'tool_result' && payload(e).tool_use_id === LONG_THREAD.hugeResultCall)!;
    // A tool_result is made compact, not clipped (#225): its preview and its size.
    expect(huge.clipped).toBeUndefined();
    expect(payload(huge)).toMatchObject({ tool_use_id: LONG_THREAD.hugeResultCall, is_error: false, truncated: true });
    expect(payload(huge).output.chars).toBeGreaterThanOrEqual(4_000_000);
    expect(payload(huge).text.length).toBeLessThanOrEqual(TOOL_OUTPUT.preview);
    expect(Buffer.byteLength(JSON.stringify(huge))).toBeLessThan(8 * 1024);
    const whole = await get<Row>(`/threads/${ID}/events/${huge.id}`);
    expect(whole).toEqual(byId.get(huge.id));
    expect(whole.payload.length).toBeGreaterThan(4_000_000);

    measured.full = { rows: full.events.length, bytes: size(full.events) };
    measured.head = { rows: rows.length, bytes: size(rows), anchors: anchors.length, anchorBytes: size(anchors), resultsBelow: d.history.results_below };
  });

  it('pages earlier to the start, every row once, each page from the start of a turn', T, async () => {
    const d = await head();
    let h = openHistory(d.events, d.history);
    const seen = new Set(split(d.events, d.history).rows.map((e) => e.id));
    let pages = 0;
    let maxRows = 0;
    let maxBytes = 0;
    let partials = 0;
    for (let c = earlierCursor(h); c; c = earlierCursor(h)) {
      const p = await page(c);
      const { rows } = checkPage(p.events, p.span, `page ${++pages}`);
      expect(p.span.to, 'it reaches the span above').toBe(h.spans[0].from);
      for (const e of rows) {
        expect(seen.has(e.id), `row ${e.id} twice`).toBe(false);
        seen.add(e.id);
      }
      if (partial(rows)) partials++;
      else if (p.span.from > 0) expect(below(p.span.from)?.kind, `page ${pages} starts a turn`).toBe(TURN_END);
      maxRows = Math.max(maxRows, rows.length);
      maxBytes = Math.max(maxBytes, size(p.events));
      h = applyPage(h, p);
      expect(pages, 'pages to reach the start').toBeLessThan(100);
    }
    expect(h.spans).toEqual([{ from: 0, to: null }]);
    expect([...seen].sort((a, b) => a - b)).toEqual(all.map((e) => e.id));
    // A kind no client knows pages like any other row.
    const unknown = h.rows.filter((e) => e.kind === LONG_THREAD.unknownKind);
    expect(unknown.length).toBe(all.filter((e) => e.kind === LONG_THREAD.unknownKind).length);
    expect(unknown.every((e) => !e.clipped && e.payload === byId.get(e.id)!.payload)).toBe(true);
    // The pasted log and the big Write are clipped. The big result is compact (#225) and so never clipped.
    expect(h.rows.filter((e) => e.clipped).length).toBe(2);
    measured.pages = { count: pages, partial: partials, maxRows, maxBytes };
  });

  it('reveals an old search hit in one request, from the start of its turn', T, async () => {
    const hits = await get<{ thread_id: string; event_id: number | null }[]>(`/search?q=${LONG_THREAD.oldNeedle}`);
    const at = hits.find((x) => x.thread_id === ID)!.event_id!;
    expect(byId.get(at)!.payload).toContain(LONG_THREAD.oldNeedle);

    const d = await head();
    const c = revealCursor(openHistory(d.events, d.history), at)!;
    expect(c).toEqual({ at, before: d.history.from });
    const p = await page(c);
    const { rows } = checkPage(p.events, p.span, 'reveal');
    expect(rows[0].id, 'the page starts at the hit, the first row of its turn').toBe(at);
    expect(below(at)!.kind).toBe(TURN_END);
  });

  it('carries the background agent call into a page holding only its later nested calls', T, async () => {
    const agent = all.find((e) => e.kind === 'tool_use' && payload(e).id === LONG_THREAD.backgroundCall)!;
    const nested = all.find((e) => e.kind === 'tool_use' && payload(e).parent === LONG_THREAD.backgroundCall)!;
    const p = await page({ at: nested.id });
    const { rows, anchors } = checkPage(p.events, p.span, 'nested');
    expect(rows.map((e) => e.id)).toContain(nested.id);
    expect(rows.map((e) => e.id)).not.toContain(agent.id);
    expect(anchors.map((e) => e.id)).toContain(agent.id);
  });

  it('carries the answer into an island that holds only the question', T, async () => {
    const question = all.find((e) => e.kind === 'question')!;
    const answer = all.find((e) => e.kind === 'question_answer')!;
    const turnStart = all.findLast((e) => e.kind === TURN_END && e.id < question.id)!;
    const p = await page({ take: 'newest', after: turnStart.id, before: answer.id });
    const { rows, anchors } = checkPage(p.events, p.span, 'island');
    expect(rows.map((e) => e.id)).toContain(question.id);
    expect(anchors.map((e) => e.id)).toEqual([answer.id]);
  });

  it('gives the same page for the same cursor', T, async () => {
    const d = await head();
    const c = earlierCursor(openHistory(d.events, d.history))!;
    expect(await page(c)).toEqual(await page(c));
    expect(await head()).toEqual(d);
  });

  it('reads every history statement through an index', () => {
    const want: Record<string, RegExp> = {
      newest: /USING INDEX events_thread/,
      oldest: /USING INDEX events_thread/,
      payload: /USING INTEGER PRIMARY KEY/,
      turnStart: /USING (COVERING )?INDEX events_result/,
      resultsBelow: /USING COVERING INDEX events_result/,
      initBelow: /USING INDEX events_init/,
      resultBelow: /USING INDEX events_result/,
      calls: /USING INDEX events_call/,
      answers: /USING INDEX events_question_answer/,
      row: /USING INTEGER PRIMARY KEY/,
      has: /USING INTEGER PRIMARY KEY/,
    };
    expect(Object.keys(HISTORY_SQL).sort()).toEqual(Object.keys(want).sort());
    for (const [name, sql] of Object.entries(HISTORY_SQL)) {
      const text = typeof sql === 'function' ? sql(2) : sql;
      const params = Array(text.split('?').length - 1).fill(1);
      const plan = (r.db.db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...params) as { detail: string }[]).map((p) => p.detail);
      expect(plan.filter((d) => /^SCAN /.test(d)), `${name}: ${plan.join('; ')}`).toEqual([]);
      expect(plan.join('; '), name).toMatch(want[name]);
    }
  });

  it('matches the recorded baseline', () => {
    const now = {
      budget: B,
      fixture: { turns: 80, rows: all.length, payloadBytes: all.reduce((n, e) => n + Buffer.byteLength(e.payload), 0) },
      ...measured,
    };
    const recorded = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    console.log(`[history] full ${JSON.stringify(measured.full)} head ${JSON.stringify(measured.head)} pages ${JSON.stringify(measured.pages)}`);
    if (RECORD) {
      expect(Object.keys(measured).sort(), 'every measurement, before recording').toEqual(['full', 'head', 'pages']);
      // Only this test's keys: the web fold's timings may live beside them.
      writeFileSync(BASELINE, `${JSON.stringify({ ...recorded, ...now }, null, 2)}\n`);
      return;
    }
    expect(existsSync(BASELINE), `${BASELINE} is missing. Record it with OMNI_RECORD_HISTORY_BASELINE=1`).toBe(true);
    for (const [key, value] of Object.entries(now)) expect(recorded[key], `baseline.${key}`).toEqual(value);
  });
});
