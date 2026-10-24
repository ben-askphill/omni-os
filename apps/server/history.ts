// Bounded thread history (#223): the newest page a thread opens with, and older pages on demand.
// Rows are read with bounded keyset queries (db/repos/history.ts), cut with the shared `cut` and `spanOf`, clipped
// when one is too big, and joined by the anchors the clients' folds need from outside the page.
// Why the budgets, anchors and clip tiers are what they are: docs/internals/thread-history.md.
import {
  HISTORY_BUDGET,
  cut,
  spanOf,
  type Clipped,
  type HistoryBudget,
  type HistoryCursor,
  type HistoryHead,
  type HistoryPage,
  type Span,
} from '@omni/shared/history.ts';
import type { EventRow } from './db/repos/events.ts';
import { history as repo, type Bounds, type Probe } from './db/repos/history.ts';

/** A row as a page carries it. */
export type PageRow = EventRow & { clipped?: Clipped };

/**
 * `rows:bytes:rowBytes`, for the Mac fixture recording only (apps/server/tests/mac-fixtures.test.ts), where a short
 * thread has to show a head, an older page, a reveal and a clipped row. Anchors keep their budget.
 */
export function budgetFromEnv(raw: string | undefined): HistoryBudget | null {
  if (!raw) return null;
  const parts = raw.split(':');
  const [rows, bytes, rowBytes] = parts.map(Number);
  if (parts.length !== 3 || ![rows, bytes, rowBytes].every((n) => Number.isInteger(n) && n > 0) || rowBytes > bytes) {
    throw new Error(`OMNI_HISTORY_BUDGET is rows:bytes:rowBytes, positive integers with rowBytes <= bytes; got "${raw}"`);
  }
  return { ...HISTORY_BUDGET, rows, bytes, rowBytes };
}

/** Read once. */
export const BUDGET: HistoryBudget = budgetFromEnv(process.env.OMNI_HISTORY_BUDGET) ?? { ...HISTORY_BUDGET };

export const encodedSize = (row: PageRow) => Buffer.byteLength(JSON.stringify(row));

// ---------- clipping ----------

const TIERS = [2048, 512, 128];
const SCALAR_MAX = 128;

/** `s` cut to `n` UTF-16 units plus an ellipsis, never splitting a surrogate pair. */
function prefix(s: string, n: number) {
  const code = s.charCodeAt(n - 1);
  return `${s.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n)}…`;
}

function shorten(v: unknown, n: number): unknown {
  if (typeof v === 'string') return v.length > n ? prefix(v, n) : v;
  if (Array.isArray(v)) return v.map((x) => shorten(x, n));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x, n)]));
  return v;
}

const scalar = (x: unknown) => x === null || typeof x === 'number' || typeof x === 'boolean' || (typeof x === 'string' && x.length <= SCALAR_MAX);

/** Only the top level's short scalars. */
function scalars(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter(scalar);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => scalar(x)));
  return shorten(v, SCALAR_MAX);
}

/** A payload that says whether its text was cut says so now. */
function flagged(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { truncated?: unknown }).truncated === 'boolean') {
    return { ...v, truncated: true };
  }
  return v;
}

/**
 * The row a page carries: unchanged when its encoded JSON fits rowBytes. Otherwise its payload with every string
 * longer than 2048, then 512, then 128 characters shortened, stopping at the first tier that fits, and as a last tier
 * only its top-level scalars of 128 characters or fewer. Blind to kind, so ids, names, `parent`, `tool_use_id` and
 * flags survive for kinds no client knows yet. A payload that is not JSON, or one still too big, becomes '{}'.
 * `bytes`: the stored payload's size, when the caller has it.
 */
export function clip(row: EventRow, rowBytes: number, bytes = Buffer.byteLength(row.payload)): PageRow {
  if (encodedSize(row) <= rowBytes) return row;
  const { id, thread_id, kind, created_at } = row;
  const as = (payload: string): PageRow => ({ id, thread_id, kind, payload, created_at, clipped: { bytes } });
  let value: unknown;
  try {
    value = JSON.parse(row.payload);
  } catch {
    return as('{}');
  }
  for (const tier of [...TIERS.map((n) => (v: unknown) => shorten(v, n)), scalars]) {
    const out = as(JSON.stringify(flagged(tier(value))));
    if (encodedSize(out) <= rowBytes) return out;
  }
  return as('{}');
}

// ---------- anchors ----------

const json = (row: EventRow): Record<string, unknown> => {
  try {
    const v = JSON.parse(row.payload);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Takes anchors in order while the anchor budgets hold. A row that does not fit is skipped. */
class Anchors {
  readonly rows: PageRow[] = [];
  private bytes = 0;
  constructor(private readonly held: Set<number>, private readonly budget: HistoryBudget) {}
  get full() {
    return this.rows.length >= this.budget.anchors;
  }
  add(row: EventRow): boolean {
    if (this.held.has(row.id) || this.full) return false;
    const clipped = clip(row, this.budget.rowBytes);
    const w = encodedSize(clipped);
    if (this.bytes + w > this.budget.anchorBytes) return false;
    this.bytes += w;
    this.held.add(row.id);
    this.rows.push(clipped);
    return true;
  }
}

/**
 * Rows outside `span` the clients' folds need, clipped, at most budget.anchors and budget.anchorBytes, in rule order:
 * 1. parent calls: a call in the page nested under one that is not, that call, recursively (background agents' calls
 *    land turns after the agent started);
 * 2. answers: a question in the page whose answer is not;
 * 3. session (head only): the newest init below the page when it has none;
 * 4. last result (head only): the newest result below the page when it has none.
 * A kind that refers back to an earlier row (#209) adds a rule here; any other kind needs none.
 */
export function anchorsFor(threadId: string, page: readonly PageRow[], span: Span, head: boolean, budget: HistoryBudget = BUDGET): PageRow[] {
  const anchors = new Anchors(new Set(page.map((r) => r.id)), budget);

  const calls = new Set<string>();
  const parents = (rows: readonly EventRow[]) => {
    const out: string[] = [];
    for (const r of rows) if (r.kind === 'tool_use') {
      const p = json(r);
      const id = str(p.id);
      if (id) calls.add(id);
      const parent = str(p.parent);
      if (parent) out.push(parent);
    }
    return out;
  };
  let wanted = parents(page);
  while (!anchors.full) {
    const missing = [...new Set(wanted.filter((id) => !calls.has(id)))];
    if (!missing.length) break;
    const added = repo.calls(threadId, missing).filter((r) => anchors.add(r));
    for (const id of missing) calls.add(id);
    wanted = parents(added);
  }

  const answered = new Set(page.filter((r) => r.kind === 'question_answer').map((r) => str(json(r).id)));
  const asked = [...new Set(page.filter((r) => r.kind === 'question').map((r) => str(json(r).id)))].filter(
    (id): id is string => !!id && !answered.has(id),
  );
  for (const r of repo.answers(threadId, asked)) anchors.add(r);

  if (head) {
    for (const kind of ['init', 'result'] as const) {
      if (page.some((r) => r.kind === kind)) continue;
      const row = repo.latestBelow(threadId, kind, span.from);
      if (row) anchors.add(row);
    }
  }
  return anchors.rows;
}

// ---------- pages ----------

/** One cut: read toward the far end, cut on the budget and a turn edge, and the kept rows as a page carries them. */
function take(threadId: string, dir: 'newest' | 'oldest', b: Bounds, budget: HistoryBudget): { rows: PageRow[]; span: Span } {
  const read = repo[dir](threadId, b, budget.rows + 1, budget.rowBytes);
  const carried = new Map<number, PageRow>();
  const carry = (p: Probe): PageRow | null => {
    if (p.payload === null) return null;
    let row = carried.get(p.id);
    if (!row) {
      row = clip({ id: p.id, thread_id: p.thread_id, kind: p.kind, payload: p.payload, created_at: p.created_at }, budget.rowBytes, p.bytes);
      carried.set(p.id, row);
    }
    return row;
  };
  // A row read without its payload is over rowBytes, so it clips to at most that.
  const weigh = (p: Probe) => {
    const row = carry(p);
    return row ? encodedSize(row) : budget.rowBytes;
  };
  const { kept, next } = cut(read, dir, weigh, budget);
  const rows = kept.map((p) => {
    const row = carry(p);
    if (row) return row;
    const { id, thread_id, kind, created_at, bytes } = p;
    return clip({ id, thread_id, kind, payload: repo.payload(id), created_at }, budget.rowBytes, bytes);
  });
  if (dir === 'newest') rows.reverse();
  return { rows, span: spanOf(kept, next, dir, b.after, b.before) };
}

const ascending = (rows: PageRow[]) => rows.sort((a, b) => a.id - b.id);

/**
 * The page for a cursor: its span's rows and their anchors, ascending.
 * `at` holds event `at` in one request: from the start of its turn when that reaches it, else from `at` itself.
 */
export function readPage(threadId: string, cursor: HistoryCursor, budget: HistoryBudget = BUDGET): HistoryPage<PageRow> {
  let page: { rows: PageRow[]; span: Span };
  if ('at' in cursor) {
    const { at, after, before } = cursor;
    page = take(threadId, 'oldest', { after: repo.turnStart(threadId, at, after) ?? after, before }, budget);
    if (page.span.to !== null && at >= page.span.to) page = take(threadId, 'oldest', { after: at - 1, before }, budget);
  } else {
    page = take(threadId, cursor.take, { after: cursor.after, before: cursor.before }, budget);
  }
  return { events: ascending([...page.rows, ...anchorsFor(threadId, page.rows, page.span, false, budget)]), span: page.span };
}

/**
 * Every row after `after`, ascending, when they fit one page: the stream's replay (#224). Null when they do not. Rows
 * over rowBytes are measured from the record header, so a gap too big to replay is never read whole.
 */
export function readAfter(threadId: string, after: number, budget: HistoryBudget = BUDGET): PageRow[] | null {
  const { rows, span } = take(threadId, 'oldest', { after }, budget);
  return span.to === null ? rows : null;
}

/** The newest page, its anchors, and the `history` GET /api/threads/:id?history=recent adds. */
export function headPage(threadId: string, budget: HistoryBudget = BUDGET): { events: PageRow[]; history: HistoryHead } {
  const { rows, span } = take(threadId, 'newest', {}, budget);
  return {
    events: ascending([...rows, ...anchorsFor(threadId, rows, span, true, budget)]),
    history: { from: span.from, to: null, results_below: repo.resultsBelow(threadId, span.from) },
  };
}
