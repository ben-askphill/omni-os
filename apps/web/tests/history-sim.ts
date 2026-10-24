import { longThread, type LongThreadOptions } from '@omni/test-fixtures/long-thread.ts';
import { cut, HISTORY_BUDGET, spanOf, TURN_END, type HistoryBudget, type HistoryCursor, type HistoryHead, type HistoryPage, type HistoryRow, type Span } from '@omni/shared/history.ts';

// The server's page selection (docs in the #223 contract), in memory, so the Web UI's tests can fold real pages of
// the long fixture without a server. The clip is a stand-in for the server's: kind-blind, ids and short scalars kept.

const AT = '2026-10-24T10:00:00.000Z';

/** longThread() as stored rows. Ids skip, as one AUTOINCREMENT shared by every thread does. */
export function longRows(opts?: LongThreadOptions): HistoryRow[] {
  return longThread(opts).map((e, i) => ({ id: 100 + i * 3, thread_id: 't', kind: e.kind, payload: JSON.stringify(e.payload), created_at: AT }));
}

const encoded = (r: HistoryRow) => Buffer.byteLength(JSON.stringify(r));

function shorten(v: unknown, max: number): unknown {
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}…` : v;
  if (Array.isArray(v)) return v.map((x) => shorten(x, max));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x, max)]));
  return v;
}

/** A row over rowBytes with its long strings cut until it fits. */
export function clip(r: HistoryRow, rowBytes: number): HistoryRow {
  if (encoded(r) <= rowBytes) return r;
  const bytes = Buffer.byteLength(r.payload);
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(r.payload) as Record<string, unknown>;
  } catch {
    return { ...r, payload: '{}', clipped: { bytes } };
  }
  const mark = (o: Record<string, unknown>) => (typeof o.truncated === 'boolean' ? { ...o, truncated: true } : o);
  for (const max of [2048, 512, 128]) {
    const row = { ...r, payload: JSON.stringify(mark(shorten(p, max) as Record<string, unknown>)), clipped: { bytes } };
    if (encoded(row) <= rowBytes) return row;
  }
  const scalars = Object.fromEntries(Object.entries(p).filter(([, v]) => v === null || typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 128)));
  return { ...r, payload: JSON.stringify(mark(scalars)), clipped: { bytes } };
}

const payloadOf = (r: HistoryRow) => {
  try {
    return JSON.parse(r.payload) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** Serves pages of `rows` (ascending, one thread) the way GET /api/threads/:id/history does. */
export function historyServer(stored: HistoryRow[], budget: HistoryBudget = HISTORY_BUDGET) {
  const rows = stored.map((r) => clip(r, budget.rowBytes));
  const weigh = (r: HistoryRow) => (r.clipped ? budget.rowBytes : encoded(r));
  const calls = new Map<string, HistoryRow>();
  const answers = new Map<string, HistoryRow>();
  stored.forEach((r, i) => {
    const id = payloadOf(r).id;
    if (typeof id !== 'string') return;
    if (r.kind === 'tool_use' && !calls.has(id)) calls.set(id, rows[i]);
    if (r.kind === 'question_answer') answers.set(id, rows[i]);
  });

  function read(take: 'newest' | 'oldest', after?: number, before?: number) {
    const inside = rows.filter((r) => (after === undefined || r.id > after) && (before === undefined || r.id < before));
    const ordered = take === 'newest' ? inside.reverse() : inside;
    const { kept, next } = cut(ordered.slice(0, budget.rows + 1), take, weigh, budget);
    return { kept: [...kept].sort((a, b) => a.id - b.id), span: spanOf(kept, next, take, after, before) };
  }

  function anchors(page: HistoryRow[], span: Span, head: boolean): HistoryRow[] {
    const held = new Set(page.map((r) => r.id));
    const out: HistoryRow[] = [];
    const add = (r: HistoryRow | undefined) => {
      if (!r || held.has(r.id)) return;
      held.add(r.id);
      out.push(r);
    };
    const queue = page.filter((r) => r.kind === 'tool_use');
    while (queue.length) {
      const parent = payloadOf(queue.shift()!).parent;
      const row = typeof parent === 'string' ? calls.get(parent) : undefined;
      if (row && !held.has(row.id)) {
        add(row);
        queue.push(row);
      }
    }
    for (const r of page) if (r.kind === 'question') add(answers.get(String(payloadOf(r).id)));
    if (head) {
      for (const kind of ['init', TURN_END]) {
        if (page.some((r) => r.kind === kind)) continue;
        add(rows.findLast((r) => r.kind === kind && r.id < span.from));
      }
    }
    const kept: HistoryRow[] = [];
    let bytes = 0;
    for (const r of out) {
      if (kept.length >= budget.anchors || bytes + encoded(r) > budget.anchorBytes) break;
      kept.push(r);
      bytes += encoded(r);
    }
    return kept;
  }

  const withAnchors = (kept: HistoryRow[], span: Span, head: boolean) => [...kept, ...anchors(kept, span, head)].sort((a, b) => a.id - b.id);

  return {
    rows,
    head(): { events: HistoryRow[]; head: HistoryHead; anchors: number } {
      const { kept, span } = read('newest');
      const events = withAnchors(kept, span, true);
      return { events, head: { from: span.from, to: null, results_below: rows.filter((r) => r.kind === TURN_END && r.id < span.from).length }, anchors: events.length - kept.length };
    },
    page(c: HistoryCursor): HistoryPage {
      if ('at' in c) {
        const start = rows.findLast((r) => r.kind === TURN_END && r.id < c.at && (c.after === undefined || r.id > c.after))?.id ?? c.after;
        let got = read('oldest', start ?? -1, c.before);
        if (got.span.to !== null && c.at >= got.span.to) got = read('oldest', c.at - 1, c.before);
        return { events: withAnchors(got.kept, got.span, false), span: got.span };
      }
      const { kept, span } = read(c.take, c.after, c.before);
      return { events: withAnchors(kept, span, false), span };
    },
  };
}
