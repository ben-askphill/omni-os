// The gate in front of every /api route. Two jobs:
// - Only Omni's own clients get in: every request carries this install's token (apps/server/api-token.ts), as
//   `Authorization: Bearer` or the cookie a paired browser holds, or a live Google sign-in session
//   (apps/server/sign-in.ts) as its cookie or bearer credential. Through tailscale serve, the Tailscale login must
//   also be the owner's when the user config names one.
// - A web page in a browser that holds a cookie cannot use it: a cross-site POST /api/threads would run a prompt
//   with bypassPermissions, and a DNS-rebinding domain could read the responses as well.
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { cookieName, isSessionCredential, sessionCookieName, tokenMatches } from './api-token.ts';
import { config } from './config.ts';
import { resolved } from './user-config.ts';
import type { SessionAccess } from './db/repos/auth.ts';

/** How a request got in: the install token, or a Google sign-in session (and whether it came as the cookie). */
export type Access = { via: 'token' } | { via: 'session'; session: SessionAccess; cookie: boolean };

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by requestGuard. Null only on the routes that take no credential. */
    access: Access | null;
  }
}

let lookupSession: (credential: string) => SessionAccess | null = () => null;

/** apps/server/sign-in.ts hands the guard its session check at startup, so this module stays clear of the database. */
export function useSessions(lookup: (credential: string) => SessionAccess | null) {
  lookupSession = lookup;
}

/** Names the server answers to: loopback, the tailnet (tailscale serve), OMNI_HOST, and OMNI_ALLOWED_HOSTS. */
export function hostAllowed(hostname: string, extra: readonly string[] = extraHosts()): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // MagicDNS names and the 100.64.0.0/10 range belong to Tailscale. Nobody outside the tailnet can point them here.
  if (viaTailnet(h)) return true;
  return extra.includes(h);
}

function extraHosts(): string[] {
  const list = (process.env.OMNI_ALLOWED_HOSTS ?? '').split(',');
  if (!['0.0.0.0', '::'].includes(config.host)) list.push(config.host);
  return list.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** The Host the request names, as host[:port]. */
export const requestHost = (c: Context) => c.req.header('host') ?? new URL(c.req.url).host;

/** The hostname in a Host header, or '' when it is not one. */
export const hostnameOf = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
};

const refuse = (reason: string, status = 403) =>
  new Response(JSON.stringify({ error: status === 403 ? `Forbidden: ${reason}` : reason }), { status, headers: { 'content-type': 'application/json' } });

/** The Mac app asks this to prove it is this install before sending the token. */
export const PROOF_PATH = '/api/auth/proof';

/**
 * The routes that take no token and no session, so a browser can start signing in. Every other check below still
 * applies, so only a page on this origin can call them. Google's redirect back (GET /api/auth/google/callback) is
 * not here: it comes from another site by design, so app.ts routes it ahead of this guard, behind `hostAndOwner`.
 */
const OPEN = new Set([`GET ${PROOF_PATH}`, 'GET /api/auth/google', 'POST /api/auth/google/start', 'POST /api/auth/google/finish']);

/** GitHub's webhook posts (apps/server/github-webhook-api.ts) take no token either: each proves itself with its signature. */
export const isWebhookPost = (c: Context) => c.req.method === 'POST' && /^\/api\/hooks\/github\/[\w.-]+$/.test(c.req.path);

const bearer = (c: Context) => c.req.header('authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];

/** A Host that only reaches the server through Tailscale: a MagicDNS name or a 100.64.0.0/10 address. */
export function viaTailnet(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h.endsWith('.ts.net')) return true;
  const cgnat = h.match(/^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  return !!cgnat && Number(cgnat[1]) >= 64 && Number(cgnat[1]) <= 127;
}

/**
 * Headers a proxy in front of the server adds. tailscale serve always sets X-Forwarded-Host from the incoming Host,
 * and X-Forwarded-For and the Tailscale-* identity headers when it knows them (ipn/ipnlocal/serve.go,
 * `addProxyForwardedHeaders` and `addTailscaleIdentityHeaders`). A client behind it can pick its Host, but it cannot
 * take a header off the request the proxy sends on. Omni's own loopback clients and the vite dev proxy send none.
 */
const PROXY_HEADERS = ['x-forwarded-host', 'x-forwarded-for', 'x-forwarded-proto', 'forwarded', 'tailscale-user-login', 'tailscale-funnel-request'];

/** The request came in through tailscale serve (or another proxy), whatever Host it names. */
const cameThroughProxy = (c: Context, host: string) => viaTailnet(hostnameOf(host)) || PROXY_HEADERS.some((h) => c.req.header(h) !== undefined);

/** Body types a cross-site page can send without a CORS preflight. JSON routes never take them. */
const SIMPLE_TYPES = ['text/plain', 'application/x-www-form-urlencoded'];

/** The request reached the server over HTTPS, directly or through tailscale serve. */
export const isHttps = (c: Context) => new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';

/** The session cookie: HttpOnly, SameSite=Strict, on /api, until the session's own expiry. */
export function setSessionCookie(c: Context, credential: string, expiresAt: string) {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  setCookie(c, sessionCookieName(), credential, { path: '/api', httpOnly: true, sameSite: 'Strict', secure: isHttps(c), maxAge });
}

/** A bearer header wins over the cookies, as it always has; a session credential and the token are told apart by shape. */
function accessOf(c: Context): Access | null {
  const given = bearer(c);
  if (given !== undefined) {
    if (!isSessionCredential(given)) return tokenMatches(given) ? { via: 'token' } : null;
    const session = lookupSession(given);
    return session ? { via: 'session', session, cookie: false } : null;
  }
  const fromCookie = getCookie(c, sessionCookieName());
  const session = fromCookie ? lookupSession(fromCookie) : null;
  if (session) return { via: 'session', session, cookie: true };
  return tokenMatches(getCookie(c, cookieName())) ? { via: 'token' } : null;
}

/** Through tailscale serve, refuses a Tailscale login that is not the owner's, when the user config names one. */
function notOwner(c: Context, host: string): Response | null {
  const owners = resolved.tailscaleLogins();
  if (owners.length && cameThroughProxy(c, host) && !owners.includes((c.req.header('tailscale-user-login') ?? '').trim().toLowerCase())) {
    return refuse('this Tailscale login is not the owner');
  }
  return null;
}

/** Refuses a Host outside hostAllowed, and through tailscale serve a Tailscale login that is not the owner's. */
export function hostAndOwner(c: Context): Response | null {
  const host = requestHost(c);
  return hostAllowed(hostnameOf(host)) ? notOwner(c, host) : refuse('host not allowed');
}

/**
 * Lets through what Omni's own clients send and refuses what a browser sends on another site's behalf:
 * - a Host outside hostAllowed (DNS rebinding);
 * - Sec-Fetch-Site: cross-site (any request a page on another site made);
 * - an Origin, `null` included, that is not the Host the request came in on;
 * - a text/plain or form-urlencoded body, the content types that skip the preflight;
 * - through tailscale serve (a tailnet Host, or any proxy header), a Tailscale-User-Login that is not in
 *   `integrations.tailscaleLogin`, when that is set;
 * - neither the token nor a live session (401), in the Authorization header or the browser's cookies, outside OPEN
 *   and signed GitHub webhook routes. A session is looked up last, so a request refused above never renews one.
 * The Mac app, apps/mcp/omni.ts, scripts and curl send no Origin or Sec-Fetch-Site, so the Host and token checks apply to them.
 * A session cookie used more than 5 minutes after its last use is sent again with its new 30-day expiry.
 */
export const requestGuard: MiddlewareHandler = async (c, next) => {
  const host = requestHost(c);
  if (!hostAllowed(hostnameOf(host))) return refuse('host not allowed');
  if (c.req.header('sec-fetch-site') === 'cross-site') return refuse('cross-site request');
  const origin = c.req.header('origin');
  if (origin !== undefined) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      // `null` and anything else that is not a URL.
    }
    // tailscale serve keeps the Host, and names the original one in X-Forwarded-Host if a proxy does not.
    const seen = [host, c.req.header('x-forwarded-host') ?? ''].map((h) => h.toLowerCase());
    if (!hostAllowed(hostnameOf(originHost)) || !seen.includes(originHost.toLowerCase())) return refuse('origin not allowed');
  }
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (SIMPLE_TYPES.includes(type)) return refuse('send JSON', 415);
  const owner = notOwner(c, host);
  if (owner) return owner;
  const access = accessOf(c);
  if (!access && !OPEN.has(`${c.req.method} ${c.req.path}`) && !isWebhookPost(c)) {
    return refuse("Unauthorized: send this install's token (data/api-token), or sign in or pair this browser", 401);
  }
  c.set('access', access);
  if (access?.via === 'session' && access.cookie && access.session.renewed) setSessionCookie(c, getCookie(c, sessionCookieName())!, access.session.expiresAt);
  await next();
};
