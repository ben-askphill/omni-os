// Bounded thread history (#223): a thread opens with its newest page of events and loads older pages on demand.
// Pure. The server cuts pages with `cut` and `spanOf`; clients hold a `History` and join every page into it.
// apps/mac/OmniKit/Sources/OmniKit/History.swift ports the client half; packages/test-fixtures/history/spans.json
// keeps the two in step. Budgets and the reasons for them: docs/internals/thread-history.md.

/** What one page may carry. The server enforces it; the budget tests and the recorded baseline read it. */
export const HISTORY_BUDGET = {
  /** Rows in a page, anchors not counted. Bounds a client's fold per page. */
  rows: 300,
  /** Encoded bytes of a page's rows: the JSON of each row, its payload string included. */
  bytes: 256 * 1024,
  /** Encoded bytes of one row. A bigger row is clipped (`Clipped`), never dropped. */
  rowBytes: 32 * 1024,
  /** Encoded bytes of a page's anchors, and how many at most. */
  anchorBytes: 64 * 1024,
  anchors: 16,
} as const;

export type HistoryBudget = { -readonly [K in keyof typeof HISTORY_BUDGET]: number };

/** The kind that ends a turn. A page starts right after one, or ends on one, when the budget allows. */
export const TURN_END = 'result';

/** Set on a row whose payload was too big: its long strings were shortened, its ids and flags kept. */
export interface Clipped {
  /** The stored payload's size in bytes. */
  bytes: number;
}

/** What history needs of a row: the server's EventRow, plus the clip marker. */
export interface HistoryRow {
  id: number;
  kind: string;
  payload: string;
  created_at: string;
  thread_id?: string;
  clipped?: Clipped;
}

/**
 * Event ids `from <= id < to` of one thread, all of whose rows are held. `from: 0` reaches the thread's start,
 * `to: null` the live end. Ids only grow, so a closed span stays complete: no later row can land inside it.
 */
export interface Span {
  from: number;
  to: number | null;
}

/** GET /api/threads/:id/history. `events`: the span's rows and its anchors (rows outside the span), ascending. */
export interface HistoryPage<R extends HistoryRow = HistoryRow> {
  events: R[];
  span: Span;
}

/** `history` on GET /api/threads/:id?history=recent, whose `events` are the newest page and its anchors. */
export interface HistoryHead {
  from: number;
  to: null;
  /** Result rows with id < from, for a turn count that never goes stale. */
  results_below: number;
}

/**
 * Where to cut a page. `before` and `after` are exclusive ids, like the stream's `after`.
 * - newest: the newest rows in (after, before). Neither bound: the head.
 * - oldest: the oldest rows in (after, before). Fills a gap from the span above it.
 * - at: the page holding event `at`, from the start of its turn when that fits, within (after, before).
 */
export type HistoryCursor =
  | { take: 'newest'; before?: number; after?: number }
  | { take: 'oldest'; after: number; before?: number }
  | { at: number; after?: number; before?: number };

/** The query string for a cursor. */
export function historyQuery(c: HistoryCursor): string {
  const q = new URLSearchParams();
  if ('at' in c) q.set('at', String(c.at));
  else if (c.take === 'oldest') q.set('take', 'oldest');
  if (c.after !== undefined) q.set('after', String(c.after));
  if (c.before !== undefined) q.set('before', String(c.before));
  return q.toString();
}

/** The cursor a request names, or why it names none: the server's boundary check. Ids are integers of 0 or more. */
export function parseHistoryQuery(get: (name: string) => string | undefined): HistoryCursor | { error: string } {
  const ids: Record<'at' | 'after' | 'before', number | undefined> = { at: undefined, after: undefined, before: undefined };
  for (const name of ['at', 'after', 'before'] as const) {
    const raw = get(name);
    if (raw === undefined || raw === '') continue;
    if (!/^\d{1,15}$/.test(raw)) return { error: `${name} must be an event id` };
    ids[name] = Number(raw);
  }
  const { at, after, before } = ids;
  if (after !== undefined && before !== undefined && before <= after) return { error: 'before must be greater than after' };
  const take = get('take');
  if (at !== undefined) {
    if (take) return { error: 'at takes no take' };
    return { at, after, before };
  }
  if (take === 'oldest') {
    if (after === undefined) return { error: 'take=oldest needs after' };
    return { take: 'oldest', after, before };
  }
  if (take && take !== 'newest') return { error: 'take is newest or oldest' };
  return { take: 'newest', after, before };
}

// ---------- cutting a page (the server's, pure so tests can run it on rows in memory) ----------

/**
 * Cuts a page from rows read toward the far end: newest first for 'newest', oldest first for 'oldest', at most
 * budget.rows + 1 of them. Keeps rows while both budgets hold (the first always fits), then moves the cut to a turn
 * boundary inside it: a 'newest' page starts right after a TURN_END row, an 'oldest' page ends on one. With no
 * boundary inside (one turn over budget) the whole cut stays, a partial page. With nothing read past the cut, no snap.
 * `next`: the id of the first row past the cut, null when the read ran out.
 */
export function cut<P extends { id: number; kind: string }>(
  read: readonly P[],
  take: 'newest' | 'oldest',
  weigh: (p: P) => number,
  budget: Pick<HistoryBudget, 'rows' | 'bytes'>,
): { kept: P[]; next: number | null } {
  let n = 0;
  let total = 0;
  for (const p of read) {
    const w = weigh(p);
    if (n >= budget.rows || (n > 0 && total + w > budget.bytes)) break;
    total += w;
    n++;
  }
  if (n === read.length) return { kept: read.slice(), next: null };
  let end = n;
  if (take === 'newest') {
    for (let i = n - 1; i >= 1; i--) {
      if (read[i].kind === TURN_END) {
        end = i;
        break;
      }
    }
  } else {
    for (let i = n - 1; i >= 0; i--) {
      if (read[i].kind === TURN_END) {
        end = i + 1;
        break;
      }
    }
  }
  return { kept: read.slice(0, end), next: read[end].id };
}

/**
 * The span a cut covers. newest: from its oldest kept row, or the bound below when the read ran out; to the bound
 * above. oldest: from the bound below; to the first row past the cut, else the bound above. Every edge that is not a
 * request bound has a real row past it, so a gap the client shows is never empty when made.
 */
export function spanOf(
  kept: readonly { id: number }[],
  next: number | null,
  take: 'newest' | 'oldest',
  after?: number,
  before?: number,
): Span {
  const floor = after === undefined ? 0 : after + 1;
  if (take === 'newest') return { from: next === null || !kept.length ? floor : kept[kept.length - 1].id, to: before ?? null };
  return { from: floor, to: next ?? before ?? null };
}

// ---------- what a client holds ----------

/**
 * What a client holds of one thread.
 * Invariants: rows ascending by id, each once; spans ascending, disjoint and not touching (a.to < b.from); once
 * opened, the last span has `to: null`. A row outside every span is an anchor: it informs the fold, never shows.
 */
export interface History<R extends HistoryRow = HistoryRow> {
  readonly rows: readonly R[];
  readonly spans: readonly Span[];
  /** From the latest head: results under `from`. turnCount adds the held results at or above it. */
  readonly below: { readonly from: number; readonly results: number };
}

export const emptyHistory: History<never> = { rows: [], spans: [], below: { from: 0, results: 0 } };

/** The whole thread as one span: what a client holds when it read the full detail. */
export const ALL: Span = { from: 0, to: null };

const reaches = (a: Span, b: Span) => a.to === null || a.to >= b.from;

/** Union of spans: ascending, touching and overlapping ones merged. */
export function unionSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && reaches(last, s)) out[out.length - 1] = { from: last.from, to: last.to === null || s.to === null ? null : Math.max(last.to, s.to) };
    else out.push({ ...s });
  }
  return out;
}

/** Union of rows by id, ascending. Of two copies of one row, an unclipped one wins, else the newer argument's. */
function unionRows<R extends HistoryRow>(a: readonly R[], b: readonly R[]): R[] {
  if (!b.length) return a as R[];
  const byId = new Map<number, R>();
  for (const r of a) byId.set(r.id, r);
  for (const r of b) {
    const prev = byId.get(r.id);
    if (!prev || !(r.clipped && !prev.clipped)) byId.set(r.id, r);
  }
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

/** The state a thread opens with: the head page from GET /api/threads/:id?history=recent. */
export function openHistory<R extends HistoryRow>(events: readonly R[], head: HistoryHead): History<R> {
  return applyHead(emptyHistory as History<R>, events, head);
}

/**
 * Joins a page in. Commutative, associative, idempotent: rows unioned by id (an unclipped copy beats a clipped one),
 * spans unioned as intervals. A page that lands late or twice changes nothing more.
 */
export function applyPage<R extends HistoryRow>(h: History<R>, page: HistoryPage<R>): History<R> {
  return { rows: unionRows(h.rows, page.events), spans: unionSpans([...h.spans, page.span]), below: h.below };
}

/** A fresh head (open or reconnect): applyPage with span [from, null), and `below` taken from it. */
export function applyHead<R extends HistoryRow>(h: History<R>, events: readonly R[], head: HistoryHead): History<R> {
  const next = applyPage(h, { events: events as R[], span: { from: head.from, to: null } });
  return { ...next, below: { from: head.from, results: head.results_below } };
}

/** Rows from the live stream. They land in the head span (ids only grow). Returns `h` itself when none was new. */
export function appendLive<R extends HistoryRow>(h: History<R>, rows: readonly R[]): History<R> {
  const held = new Set(h.rows.map((r) => r.id));
  const fresh = rows.filter((r) => !held.has(r.id));
  if (!fresh.length) return h;
  return { ...h, rows: unionRows(h.rows, fresh) };
}

/** A full row from GET /api/threads/:id/events/:eventId, in place of its clipped copy. Unknown ids change nothing. */
export function replaceRow<R extends HistoryRow>(h: History<R>, row: R): History<R> {
  const i = h.rows.findIndex((r) => r.id === row.id);
  if (i < 0) return h;
  const rows = h.rows.slice();
  rows[i] = row;
  return { ...h, rows };
}

/**
 * For #224: the stream says the gap since `tailId` is too big to replay. The head span closes after the newest held
 * row and becomes an island; the fresh head then comes in through applyHead. Older history stays reachable.
 */
export function detachHead<R extends HistoryRow>(h: History<R>): History<R> {
  const last = h.spans[h.spans.length - 1];
  if (!last || last.to !== null) return h;
  return { ...h, spans: [...h.spans.slice(0, -1), { from: last.from, to: tailId(h) + 1 }] };
}

/** The index of the span holding `id`, -1 for none. */
export function spanIndex(spans: readonly Span[], id: number): number {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = spans[mid];
    if (id < s.from) hi = mid - 1;
    else if (s.to !== null && id >= s.to) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** The thread's first row is held: nothing earlier to load, and the first item is the thread's first message. */
export const atStart = (h: Pick<History, 'spans'>): boolean => h.spans[0]?.from === 0;

/** The newest held id: the stream's `after`. 0 for none. */
export const tailId = (h: Pick<History, 'rows'>): number => h.rows[h.rows.length - 1]?.id ?? 0;

/** Turns that ended in the whole thread: every result row, held or not. */
export function turnCount(h: History): number {
  let n = h.below.results;
  for (const r of h.rows) if (r.kind === TURN_END && r.id >= h.below.from) n++;
  return n;
}

/** The page above span `i` (default the first), down to the span below it. Null when span i reaches the start. */
export function earlierCursor(h: Pick<History, 'spans'>, i = 0): HistoryCursor | null {
  const s = h.spans[i];
  if (!s || s.from === 0) return null;
  const below = i > 0 ? h.spans[i - 1] : undefined;
  return below?.to != null ? { take: 'newest', before: s.from, after: below.to - 1 } : { take: 'newest', before: s.from };
}

/** The page under span `i + 1`, filling the gap up from span `i`. Null for the head span. */
export function laterCursor(h: Pick<History, 'spans'>, i: number): HistoryCursor | null {
  const s = h.spans[i];
  const above = h.spans[i + 1];
  if (!s || s.to === null || !above) return null;
  return { take: 'oldest', after: s.to - 1, before: above.from };
}

/** The page that holds `eventId`, bounded by the spans around it. Null when it is held already. */
export function revealCursor(h: Pick<History, 'spans'>, eventId: number): HistoryCursor | null {
  if (spanIndex(h.spans, eventId) >= 0) return null;
  let after: number | undefined;
  let before: number | undefined;
  for (const s of h.spans) {
    if (s.to !== null && s.to <= eventId) after = s.to - 1;
    else if (s.from > eventId) {
      before = s.from;
      break;
    }
  }
  return { at: eventId, ...(after !== undefined && { after }), ...(before !== undefined && { before }) };
}

/** A loading control among the shown rows: older history above the first span, or the gap under span `after`. */
export type HistoryEdge = { type: 'earlier' } | { type: 'gap'; after: number };

/**
 * Where each control goes, by the key of the shown row it sits above. `keys`: the shown rows' keys, ascending (item
 * keys on the desktop and the Mac, turn keys on the phone). A control with no shown row under it is keyed -1, at the
 * end; the earlier control wins that key.
 */
export function historyEdges(h: Pick<History, 'spans'>, keys: readonly number[]): Map<number, HistoryEdge> {
  const out = new Map<number, HistoryEdge>();
  const firstFrom = (from: number) => keys.find((k) => k >= from) ?? -1;
  for (let i = h.spans.length - 2; i >= 0; i--) out.set(firstFrom(h.spans[i + 1].from), { type: 'gap', after: i });
  if (h.spans.length && !atStart(h)) out.set(keys[0] ?? -1, { type: 'earlier' });
  return out;
}
