// /api/csp-report: where the Web UI shell's browser posts the violations of its Content-Security-Policy (web-headers.ts).
// POST is open straight from this machine, where a browser's report goes without the page's cookie (request-guard.ts
// isCspReport); from anywhere else it needs a session like any request.
// GET, behind the token like any route, answers the counts since the server started.
//
// A report names the page's address, which can carry a pairing token, and other URLs, which can carry a cookie path's
// key or a signed query. None of that is kept: the page's address is dropped, a URL on this host keeps its path with
// the key masked, a URL elsewhere keeps its origin, and every query and fragment goes.
import { Hono } from 'hono';

export const cspReportApi = new Hono();

const MAX_BODY = 64 * 1024;
const MAX_REPORTS_PER_POST = 50;
/** Distinct violations kept; any after that only count in `dropped`. */
const MAX_KINDS = 50;
const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'self', 'trusted-types-policy', 'trusted-types-sink']);

type CspViolation = {
  directive: string;
  blocked: string;
  source: string;
  line: number | null;
  column: number | null;
  disposition: string;
  /** The first 40 characters of the blocked inline code, when the browser sent them ('report-sample'). */
  sample: string;
  count: number;
  first: string;
  last: string;
};

const kinds = new Map<string, CspViolation>();
let total = 0;
let dropped = 0;
const since = new Date().toISOString();

/** Masks the keyed cookie path's key (browser-session.ts): /api/k/<key>/… becomes /api/k/…/… */
const maskKey = (path: string) => path.replace(/^\/api\/k\/[^/]+/, '/api/k/…');

/** A URL from a report, as safe to log: a keyword as is, this host's URL as its path, any other as its origin. */
function safeUrl(raw: unknown, host: string | undefined): string {
  if (typeof raw !== 'string' || !raw) return '';
  if (KEYWORDS.has(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'unparsed';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol.slice(0, -1);
  if (host && url.host.toLowerCase() === host.toLowerCase()) return maskKey(url.pathname);
  return url.origin;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);

/** One violation's fields, from either shape: the Reporting API's `body` or report-uri's `csp-report`. */
function violationOf(r: Record<string, unknown>, legacy: boolean, host: string | undefined) {
  const directive = str(r[legacy ? 'effective-directive' : 'effectiveDirective']) || str(r['violated-directive']).split(' ')[0];
  return {
    directive: clean(directive, 60) || 'unknown',
    blocked: safeUrl(r[legacy ? 'blocked-uri' : 'blockedURL'], host),
    source: safeUrl(r[legacy ? 'source-file' : 'sourceFile'], host),
    line: num(r[legacy ? 'line-number' : 'lineNumber']),
    column: num(r[legacy ? 'column-number' : 'columnNumber']),
    disposition: clean(str(r.disposition), 20) || 'unknown',
    sample: clean(str(r[legacy ? 'script-sample' : 'sample']), 40),
  };
}

function record(v: ReturnType<typeof violationOf>) {
  total += 1;
  const key = [v.directive, v.blocked, v.source, v.line, v.column, v.sample].join('\u0000');
  const now = new Date().toISOString();
  const seen = kinds.get(key);
  if (seen) {
    seen.count += 1;
    seen.last = now;
    return;
  }
  if (kinds.size >= MAX_KINDS) {
    // Said once, so a flood of junk cannot hide the real violations that come after it without a trace.
    if (dropped === 0) console.warn(`[csp] ${MAX_KINDS} distinct violations kept; any new one after this is only counted (GET /api/csp-report)`);
    dropped += 1;
    return;
  }
  kinds.set(key, { ...v, count: 1, first: now, last: now });
  const at = v.source ? ` at ${v.source}${v.line === null ? '' : `:${v.line}`}` : '';
  console.warn(`[csp] ${v.disposition} ${v.directive} blocked ${v.blocked || 'unknown'}${at}${v.sample ? ` (${JSON.stringify(v.sample)})` : ''}`);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

cspReportApi.post('/', async (c) => {
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!['application/reports+json', 'application/csp-report', 'application/json'].includes(type)) return c.json({ error: 'Send a CSP report' }, 415);
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) return c.json({ error: 'Report too large' }, 413);
  const text = await c.req.text();
  if (text.length > MAX_BODY) return c.json({ error: 'Report too large' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: 'Send JSON' }, 400);
  }
  const host = c.req.header('host');
  if (Array.isArray(body)) {
    for (const r of body.slice(0, MAX_REPORTS_PER_POST)) {
      if (isObject(r) && r.type === 'csp-violation' && isObject(r.body)) record(violationOf(r.body, false, host));
    }
  } else if (isObject(body) && isObject(body['csp-report'])) {
    record(violationOf(body['csp-report'], true, host));
  } else {
    return c.json({ error: 'Send a CSP report' }, 400);
  }
  return c.body(null, 204);
});

/** The violations since the server started, most frequent first. */
cspReportApi.get('/', (c) =>
  c.json({ since, total, dropped, violations: [...kinds.values()].sort((a, b) => b.count - a.count) }),
);

/** For tests. */
export function resetCspReports() {
  kinds.clear();
  total = 0;
  dropped = 0;
}
