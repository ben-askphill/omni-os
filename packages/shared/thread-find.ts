// Find in a thread: the words Ben types into the thread's find bar, matched against every event the thread holds,
// held by the client or not. Pure. The server counts matches over the stored rows (GET /api/threads/:id/find); the
// Web UI highlights the same pattern in the rows it draws and steps through the server's list.

/** The kinds a find looks in: what the transcript shows as text, a tool call's input and its output included. */
export const FIND_KINDS = ['user', 'assistant_text', 'crew_report', 'error', 'tool_use', 'tool_result'] as const;

/** The most matches one answer lists. A query that matches more says so (`capped`), and the count reads "1000+". */
export const FIND_CAP = 1000;

/** The longest query the server takes. */
export const FIND_MAX_QUERY = 200;

/** One event with matches, and how many it holds. Ascending by event in an answer. */
export interface FindHit {
  event: number;
  count: number;
}

/** GET /api/threads/:id/find?q=. */
export interface FindAnswer {
  hits: FindHit[];
  /** Matches in `hits`, at most FIND_CAP. */
  total: number;
  /** The thread holds more matches than `hits` lists. */
  capped: boolean;
}

/** One match: the event it is in and which of that event's matches, from 0. */
export interface FindMatch {
  event: number;
  n: number;
}

/** The query as typed, trimmed of the whitespace around it. A blank query finds nothing. */
export const findQuery = (q: string): string => q.trim().slice(0, FIND_MAX_QUERY);

/** A case-insensitive pattern for the query, read literally. Null for a blank query. */
export function findPattern(q: string): RegExp | null {
  const t = findQuery(q);
  if (!t) return null;
  return new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
}

/** Where `re` matches in `text`, as [start, end) offsets, without overlaps. */
export function rangesIn(text: string, re: RegExp): [number, number][] {
  const out: [number, number][] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

const count = (text: string, re: RegExp) => rangesIn(text, re).length;

/** Every string inside a value, in order: a tool call's input fields, its todos' content. Keys are left out. */
function strings(v: unknown, out: string[]) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
}

/** The text a find looks in for one event, as the transcript shows it: a message, a report, a call's input or output. */
export function findTexts(kind: string, payload: unknown): string[] {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const text = typeof p.text === 'string' ? p.text : '';
  switch (kind) {
    case 'user':
    case 'assistant_text':
    case 'error':
      return text ? [text] : [];
    case 'crew_report':
      return [typeof p.title === 'string' ? p.title : '', text].filter(Boolean);
    case 'tool_use': {
      const out: string[] = [];
      strings(p.input, out);
      return out.filter(Boolean);
    }
    case 'tool_result':
      return text ? [text] : [];
    default:
      return [];
  }
}

const parse = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

/**
 * The events with matches, ascending, from rows read in id order. Stops at FIND_CAP matches; an event the cap cuts
 * through keeps the matches that fit. `capped` says whether any were left out.
 */
export function findHits(rows: Iterable<{ id: number; kind: string; payload: string }>, q: string): FindAnswer {
  const re = findPattern(q);
  const hits: FindHit[] = [];
  let total = 0;
  if (!re) return { hits, total, capped: false };
  for (const r of rows) {
    if (!(FIND_KINDS as readonly string[]).includes(r.kind)) continue;
    const n = findTexts(r.kind, parse(r.payload)).reduce((s, t) => s + count(t, re), 0);
    if (!n) continue;
    if (total + n > FIND_CAP) {
      const take = FIND_CAP - total;
      if (take > 0) hits.push({ event: r.id, count: take });
      return { hits, total: FIND_CAP, capped: true };
    }
    hits.push({ event: r.id, count: n });
    total += n;
  }
  return { hits, total, capped: false };
}

/**
 * Whether a query is safe to narrow with SQL's LIKE before the rows are read: printable ASCII, which LIKE folds the
 * case of the way `findPattern` does, and no quote or backslash, which a payload's JSON escapes.
 */
export const likeSafe = (q: string): boolean => /^[\x20-\x7e]+$/.test(q) && !/["\\]/.test(q);

/** The LIKE pattern for a `likeSafe` query, with `\` as the escape character. */
export const likePattern = (q: string): string => `%${q.replace(/[%_\\]/g, '\\$&')}%`;

/** Every match, in thread order: event by event, and within an event in the order its text reads. */
export const matchList = (hits: readonly FindHit[]): FindMatch[] => hits.flatMap((h) => Array.from({ length: h.count }, (_, n) => ({ event: h.event, n })));

/** The match after (`1`) or before (`-1`) index `i`, wrapping at either end. -1 when there are none. */
export function stepMatch(i: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return -1;
  if (i < 0) return dir === 1 ? 0 : total - 1;
  return (i + dir + total) % total;
}

/**
 * Where a new query starts: the first match at or after the event Ben is reading (the top row on screen), else the
 * last match. Ben reading the newest rows starts on the newest match, and Shift+Enter walks back through the thread.
 */
export function nearestMatch(matches: readonly FindMatch[], reading: number | null): number {
  if (!matches.length) return -1;
  if (reading === null) return matches.length - 1;
  const at = matches.findIndex((m) => m.event >= reading);
  return at === -1 ? matches.length - 1 : at;
}

/** The find bar's count: "3 of 12", "No results", or "3 of 1000+" when the thread holds more than an answer lists. */
export function findCount(index: number, total: number, capped: boolean): string {
  if (!total) return 'No results';
  return `${index < 0 ? 0 : index + 1} of ${total}${capped ? '+' : ''}`;
}
