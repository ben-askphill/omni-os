// The cookie a paired browser holds (PRD #667, S11): a revocable device session's token, never the install's token.
// HttpOnly, so page scripts never see it, and SameSite=Strict. Named per port (api-token.ts).
//
// Cookies ignore ports, so a cookie on /api over plain HTTP also goes to every other service on that host under /api:
// a dev server, a container's UI. Over plain HTTP the cookie therefore lives on a path of its own instead,
// /api/k/<key>, with a random key per session that only the page knows (apps/web/src/api-base.ts keeps it in
// localStorage, which is per origin, port included). Every request the page makes goes under that path, the server
// takes it off again (app.ts), and requestGuard takes the session only on its own path: another port never gets the
// cookie, and the cookie's value alone, replayed from anywhere, is refused.
//
// Behind HTTPS (tailscale serve, Omni Connect) the cookie stays on /api: it is Secure, so no plain-HTTP service on
// that host gets it. A document the page opens (an artifact in a frame or a tab, a download) would see the key in its
// own address, so requestGuard sends such a load to a signed address on /api for that one URL instead (docUrl).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { apiToken, cookieName, sessionCookieName } from './api-token.ts';

/** /api/k/<key>, with the 32 hex characters of a session's key, at the start of a path. */
const KEYED = /^\/api\/k\/([0-9a-f]{32})(?=\/|$)/;

/** A path with its session key taken off: what the routes see (app.ts getPath). */
export const withoutKey = (path: string) => path.replace(KEYED, '/api');

/** Where this request's session cookie lives: `/api/k/<key>` when it came in on a keyed path, else `/api`. */
export const requestBase = (c: Context) => new URL(c.req.url).pathname.match(KEYED)?.[0] ?? '/api';

const overHttps = (c: Context) => new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';

/** Where a new browser session's cookie goes: a fresh keyed path over plain HTTP, /api behind HTTPS. */
export const newCookiePath = (c: Context) => (overHttps(c) ? '/api' : `/api/k/${randomBytes(16).toString('hex')}`);

const MAX_AGE = 400 * 24 * 3600;
export const cookieOptions = (c: Context, path = '/api') => ({ path, httpOnly: true, sameSite: 'Strict' as const, secure: overHttps(c), maxAge: MAX_AGE });

/** Hand the browser this session on its path, and drop the raw-token cookie older builds set. */
export function setSessionCookie(c: Context, token: string, path: string) {
  setCookie(c, sessionCookieName(), token, cookieOptions(c, path));
  deleteCookie(c, cookieName(), { path: '/api' });
}

/** Every value of the session cookie in the request: a browser sends the one on its keyed path and any stale one on /api. */
export function sessionCookies(c: Context): string[] {
  const name = sessionCookieName();
  const out: string[] = [];
  for (const pair of (c.req.header('cookie') ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0 && pair.slice(0, at).trim() === name) out.push(pair.slice(at + 1).trim());
  }
  return out;
}

/** Where the desktop window's session id waits for the next desktop-pair (deviceCookieName), which a keyed cookie never reaches. */
export const DESKTOP_PAIR_COOKIE_PATH = '/api/auth/desktop-pair';

// ---------- documents ----------

/** How long a signed document address works. Reloading a tab left open longer asks for the page again. */
const DOC_TTL_MS = 12 * 3600_000;
const DOC_PARAM = 'omni_doc';

const docMac = (sessionId: string, exp: number, target: string) =>
  createHmac('sha256', apiToken()).update(`omni-doc:${sessionId}:${exp}:${target}`).digest('base64url');

/**
 * The address a document load on a keyed path goes to instead: the same route and query on /api, signed for this
 * session. It opens only that one URL, so a page that reads its own address learns nothing it could use elsewhere.
 */
export function docUrl(c: Context, sessionId: string, at = Date.now()): string {
  const url = new URL(c.req.url);
  const target = withoutKey(url.pathname) + url.search;
  const exp = at + DOC_TTL_MS;
  return `${target}${url.search ? '&' : '?'}${DOC_PARAM}=${sessionId}.${exp}.${docMac(sessionId, exp, target)}`;
}

/** The session a signed document address names, while its signature holds and it has not expired. */
export function docSession(c: Context, at = Date.now()): string | null {
  const url = new URL(c.req.url);
  const full = url.pathname + url.search;
  const m = full.match(new RegExp(`[?&]${DOC_PARAM}=([0-9a-f-]{36})\\.(\\d{13})\\.([\\w-]{43})$`));
  if (!m || m.index === undefined) return null;
  const [, sessionId, expText, mac] = m;
  const exp = Number(expText);
  if (exp < at) return null;
  const want = Buffer.from(docMac(sessionId, exp, full.slice(0, m.index)));
  const given = Buffer.from(mac);
  return given.length === want.length && timingSafeEqual(given, want) ? sessionId : null;
}
