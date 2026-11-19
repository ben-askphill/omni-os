// The gate in front of every /api route. Two jobs:
// - Only Omni's own clients get in: every request carries this install's token (apps/server/api-token.ts), as
//   `Authorization: Bearer` or the cookie a paired browser holds, or a session a device got by signing in with Google
//   as the install's owner (apps/server/google-auth.ts). Through tailscale serve, the Tailscale login must also be the
//   owner's when the user config names one.
// - A web page in a browser that holds the cookie cannot use it: a cross-site POST /api/threads would run a prompt
//   with bypassPermissions, and a DNS-rebinding domain could read the responses as well.
import type { IncomingMessage } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { cookieName, tokenMatches } from './api-token.ts';
import { CALLER_HEADER as THREAD_HEADER } from './caller-header.ts';
import { docSession, docUrl, requestBase, sessionCookies } from './browser-session.ts';
import { nonceLive } from './desktop-pairing.ts';
import { decideRequest, mayUseShell, type Credential, type RouteClass } from './request-trust.ts';
import { config } from './config.ts';
import { CSP_REPORT_PATH } from './web-headers.ts';
import { resolved } from './user-config.ts';

/** This machine's Omni Connect hostname while Connect is on (connect/service.ts). app.ts sets it, so the tests never open the db. */
let connectHost: () => string | null = () => null;
export const useConnectHost = (fn: typeof connectHost) => {
  connectHost = fn;
};

/** The Host is this machine's own Omni Connect hostname: the request came through its Cloudflare tunnel. */
export const viaConnect = (hostname: string) => {
  const own = connectHost();
  return !!own && hostname.toLowerCase().replace(/\.$/, '') === own;
};

/** Names the server answers to: loopback, the tailnet (tailscale serve), the Omni Connect hostname, OMNI_HOST, and OMNI_ALLOWED_HOSTS. */
export function hostAllowed(hostname: string, extra: readonly string[] = extraHosts()): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // MagicDNS names and the 100.64.0.0/10 range belong to Tailscale. Nobody outside the tailnet can point them here.
  if (viaTailnet(h)) return true;
  // Only Cloudflare's edge serves this name, and only through this machine's own tunnel.
  if (viaConnect(h)) return true;
  return extra.includes(h);
}

/** The hostname of `integrations.mcpPublicUrl`, or '' when unset. */
export function mcpPublicHost(): string {
  const url = resolved.mcpPublicUrl();
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * hostAllowed, plus the Cloudflare Tunnel's public name. Only /mcp and /.well-known use it: requestGuard keeps
 * refusing that name on /api, so a tunnel whose ingress forwards every path still reaches nothing else.
 */
export function mcpHostAllowed(hostname: string): boolean {
  if (hostAllowed(hostname)) return true;
  const own = mcpPublicHost();
  return !!own && hostname.toLowerCase().replace(/\.$/, '') === own;
}

function extraHosts(): string[] {
  const list = (process.env.OMNI_ALLOWED_HOSTS ?? '').split(',');
  if (!['0.0.0.0', '::'].includes(config.host)) list.push(config.host);
  return list.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const hostnameOf = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
};

const refuse = (reason: string, status = 403) =>
  new Response(JSON.stringify({ error: status === 403 ? `Forbidden: ${reason}` : reason }), { status, headers: { 'content-type': 'application/json' } });

/** The desktop app asks this to prove the process on the port is this install, before it sends the token. */
export const PROOF_PATH = '/api/auth/proof';

/**
 * The desktop app's window opens this with a one-time nonce (desktop-pairing.ts), and the response sets the pairing
 * cookie. No token in the URL. Only a request from this machine that did not come through a proxy (so Tailscale and a
 * forwarded client still have to pair with the token).
 */
export const DESKTOP_PAIR_PATH = '/api/auth/desktop-pair';

/** GitHub's webhook posts (apps/server/github-webhook-api.ts) take no token either: each proves itself with its signature. */
export const isWebhookPost = (c: Context) => c.req.method === 'POST' && /^\/api\/hooks\/github\/[\w.-]+$/.test(c.req.path);

/** The Google sign-in routes a device without the token calls: whether sign-in is on, and the device-code flow. */
export const SIGN_IN_ROUTES: readonly (readonly [string, string])[] = [
  ['GET', '/api/auth/methods'],
  ['POST', '/api/auth/google/start'],
  ['POST', '/api/auth/google/poll'],
];
const isSignInRoute = (c: Context) => SIGN_IN_ROUTES.some(([m, p]) => c.req.method === m && c.req.path === p);

/** Redeeming a pairing code needs no token: the one-time code, which only an authenticated device could mint, is the proof. */
export const APP_PAIRING_OPEN_ROUTES: readonly (readonly [string, string])[] = [
  ['POST', '/api/auth/app-pairings/redeem'],
  // The link a phone's camera opens from the pairing QR (auth-api.ts): the same one-time code, spent for a browser.
  ['GET', '/api/auth/pair-link'],
];
const isAppPairingRoute = (c: Context) => APP_PAIRING_OPEN_ROUTES.some(([m, p]) => c.req.method === m && c.req.path === p);

/** Omni Connect's routes that prove themselves: the relay's signed mint and health requests, and a browser's code and key proof. */
export const CONNECT_OPEN_ROUTES: readonly (readonly [string, string])[] = [
  ['POST', '/api/connect/mint'],
  ['POST', '/api/connect/health'],
  ['POST', '/api/connect/redeem'],
];
const isConnectRoute = (c: Context) => CONNECT_OPEN_ROUTES.some(([m, p]) => c.req.method === m && c.req.path === p);

/**
 * The Web UI shell's CSP violation reports (csp-report-api.ts), open only straight from this machine: a browser here
 * talks plain HTTP, so its cookie sits on the keyed path and the report to /api/csp-report goes without it. Through a
 * proxy or the Connect tunnel the cookie is on /api and goes along, so a report there needs a session like any request,
 * and nobody else can fill the counts with junk.
 */
const isCspReport = (c: Context) => c.req.method === 'POST' && c.req.path === CSP_REPORT_PATH && directFromThisMac(c);

/**
 * How a request proved itself: the install's token, a device's session (`method`: signed in with Google, or an app
 * that redeemed a pairing code), a thread's own token (thread-tokens.ts: `thread` is the thread it was minted for), or
 * neither (the open routes). `cookiePath`: where a browser session's cookie lives (browser-session.ts), null for one
 * from before the keyed path.
 */
export type OmniAuth =
  | { via: 'token' }
  | { via: 'session'; session: string; kind: 'browser' | 'app'; method: 'google' | 'pairing' | 'token'; cookiePath?: string | null }
  | { via: 'thread'; thread: string }
  | { via: 'none' };

declare module 'hono' {
  interface ContextVariableMap {
    omniAuth: OmniAuth;
  }
}

type Session = { id: string; kind: 'browser' | 'app'; method: 'google' | 'pairing' | 'token'; cookiePath?: string | null };

/**
 * Looks a session up by its token (google-auth.ts sessionFor) and, for a signed document address, by its id
 * (sessionById). app.ts sets them, so this module and its tests never open the db.
 */
let sessionCheck: (token: string) => Session | null = () => null;
let sessionById: (id: string) => Session | null = () => null;
export const useSessionCheck = (byToken: typeof sessionCheck, byId: typeof sessionById = () => null) => {
  sessionCheck = byToken;
  sessionById = byId;
};

/** Looks a thread's token up (thread-tokens.ts threadOfToken). app.ts sets it, so this module and its tests never open the db. */
let threadTokenCheck: (token: string) => string | null = () => null;
export const useThreadTokenCheck = (fn: typeof threadTokenCheck) => {
  threadTokenCheck = fn;
};

/**
 * A browser's session counts only on its own path (browser-session.ts): a keyed one under its /api/k/<key>, one behind
 * HTTPS or from before the keyed path on /api. Another port on this host never gets a keyed cookie, and its value
 * alone, sent from anywhere without the key, is refused. An app's session has no cookie and counts anywhere.
 */
const onItsPath = (s: Session, base: string) => s.kind !== 'browser' || (s.cookiePath ?? '/api') === base;

/**
 * A load that becomes a document: a tab, a frame, a download. Its address would show the page's key. A browser that
 * sends no Sec-Fetch headers (Safari before 16.4) still asks for a page as text/html, which fetch, images and streams
 * do not.
 */
const DOCUMENT_DESTS = ['document', 'iframe', 'frame', 'embed', 'object'];
function documentLoad(c: Context): boolean {
  if (c.req.method !== 'GET') return false;
  const mode = c.req.header('sec-fetch-mode');
  const dest = c.req.header('sec-fetch-dest');
  if (mode === undefined && dest === undefined) return (c.req.header('accept') ?? '').includes('text/html');
  return mode === 'navigate' || DOCUMENT_DESTS.includes(dest ?? '');
}

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
 * take a header off the request the proxy sends on. cloudflared adds Cf-Connecting-IP and X-Forwarded-For the same way.
 * Omni's own loopback clients and the vite dev proxy send none.
 */
const PROXY_HEADERS = ['x-forwarded-host', 'x-forwarded-for', 'x-forwarded-proto', 'forwarded', 'tailscale-user-login', 'tailscale-funnel-request', 'cf-connecting-ip'];

/**
 * Came in through this machine's Connect tunnel, not tailscale serve with the Connect name as its Host. tailscale
 * serve sets X-Forwarded-For to the peer's tailnet address (100.64.0.0/10) and adds Tailscale-User-Login for a user's
 * device. Cloudflare appends the client's public address last, which is never in that range.
 */
function fromConnectTunnel(c: Context, host: string): boolean {
  if (!viaConnect(hostnameOf(host)) || c.req.header('tailscale-user-login') !== undefined) return false;
  const last = (c.req.header('x-forwarded-for') ?? '').split(',').at(-1)?.trim() ?? '';
  return !viaTailnet(last);
}

/** The request came in through tailscale serve (or another proxy), whatever Host it names. */
const cameThroughProxy = (c: Context, host: string) => viaTailnet(hostnameOf(host)) || PROXY_HEADERS.some((h) => c.req.header(h) !== undefined);

/** From a process on this machine, straight to the server: no tailscale serve, tunnel or other proxy in front. */
export const directFromThisMac = (c: Context) => fromThisMac(c) && !cameThroughProxy(c, requestHost(c));


const requestHost = (c: Context) => c.req.header('host') ?? new URL(c.req.url).host;

/** Every address this Mac answers on: loopback, the LAN and its Tailscale address. */
const ownAddresses = () => Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((a) => a.address.toLowerCase()));

/**
 * The request came from this Mac, so the client sits at the Mac the server runs on. tailscale serve runs on this Mac
 * too, so through it the socket is always loopback and only the X-Forwarded-For address it sets says who connected.
 * Requests built in-process (tests) have no socket and count as local unless they carry proxy headers.
 */
export function fromThisMac(c: Context): boolean {
  const proxied = cameThroughProxy(c, requestHost(c));
  // Cloudflare sets Cf-Connecting-IP itself; the first X-Forwarded-For entry through it is whatever the client sent.
  const forwarded = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0];
  const client = proxied ? forwarded : (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket.remoteAddress;
  if (client === undefined) return !proxied;
  return ownAddresses().includes(client.trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, ''));
}

/**
 * Who is asking, for rate limits on the open routes. Behind a proxy every request's socket is the proxy's, so the
 * address comes from what the proxy adds: Cloudflare's Cf-Connecting-IP (it sets that itself) or the last
 * X-Forwarded-For entry, which the proxy appends and the client cannot overwrite; Tailscale's login when it names
 * one. A request with no proxy in front is its socket's address, and a client's own forwarding headers count for
 * nothing. In-process requests (tests) have no socket and share the key `direct:local`.
 */
export function clientKey(c: Context): string {
  const host = requestHost(c);
  const last = (c.req.header('x-forwarded-for') ?? '').split(',').at(-1)?.trim();
  if (fromConnectTunnel(c, host)) return `connect:${c.req.header('cf-connecting-ip')?.trim() || last || 'unknown'}`;
  if (cameThroughProxy(c, host)) return `proxy:${c.req.header('tailscale-user-login')?.trim().toLowerCase() || last || 'unknown'}`;
  return `direct:${(c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket.remoteAddress ?? 'local'}`;
}

/** A thread's terminal: opening, typing into or watching its shell (terminal-api.ts). */
const TERMINAL_PATH = /^\/api\/threads\/[^/]+\/terminal(?:\/|$)/;

/**
 * The channel action routes that put a command in a login shell (actions-api.ts): adding or changing one (which also
 * makes it the setup or teardown step), running one and retrying a run. Reading, stopping a run and removing an
 * action do not. tests/actions-credentials.test.ts fails when actions-api.ts gains a route this list leaves out.
 */
const ACTION_SHELL_ROUTES: readonly (readonly [string, RegExp])[] = [
  ['POST', /^\/api\/channels\/[^/]+\/actions\/?$/],
  ['PATCH', /^\/api\/channels\/[^/]+\/actions\/[^/]+\/?$/],
  ['POST', /^\/api\/threads\/[^/]+\/actions\/[^/]+\/run\/?$/],
  ['POST', /^\/api\/threads\/[^/]+\/action-runs\/[^/]+\/retry\/?$/],
];
const isActionShellRoute = (c: Context) => ACTION_SHELL_ROUTES.some(([m, p]) => c.req.method === m && p.test(c.req.path));

/** The desktop app's main process asks this for a one-time nonce (desktop-pairing.ts). It checks its own secret. */
export const DESKTOP_NONCE_PATH = '/api/auth/desktop-nonce';

/** Swaps a raw-token cookie an older build set for a session (browser-session.ts). app.ts sets it, so the tests never open the db. */
let legacyUpgrade: ((c: Context) => { id: string; token: string; cookiePath?: string }) | null = null;
export const useLegacyUpgrade = (fn: typeof legacyUpgrade) => {
  legacyUpgrade = fn;
};

const routeClass = (c: Context): RouteClass => {
  if (c.req.method === 'GET' && c.req.path === DESKTOP_PAIR_PATH) return 'pairing';
  if (TERMINAL_PATH.test(c.req.path) || isActionShellRoute(c)) return 'shell';
  return c.req.method === 'GET' || c.req.method === 'HEAD' ? 'read' : 'act';
};

const credentialOf = (auth: OmniAuth): Credential =>
  auth.via === 'token' ? 'token' : auth.via === 'session' ? (auth.method === 'token' ? 'session-token' : 'session') : auth.via === 'thread' ? 'thread' : 'none';

/**
 * Whether the request requestGuard let through may reach a shell (request-trust.ts mayUseShell), for a route whose
 * shell depends on state its path does not show: Retry setup and the routes that fall through to it. A request that
 * never passed the guard has no credential and may not.
 */
export const shellAllowed = (c: Context) => {
  const auth = c.get('omniAuth');
  return !!auth && mayUseShell(credentialOf(auth));
};

/**
 * Lets through what Omni's own clients send and refuses what a browser sends on another site's behalf, as
 * request-trust.ts decides:
 * - a Host outside hostAllowed (DNS rebinding);
 * - Sec-Fetch-Site: cross-site or same-site (a page on another site, or on another port of this host);
 * - an Origin, `null` included, that is not the Host the request came in on;
 * - a text/plain or form-urlencoded body, the content types that skip the preflight;
 * - no token, or the wrong one (401), in the Authorization header, and no live device session in it or the paired
 *   browser's cookie, except on the proof route, a GitHub webhook post (its own signature), the desktop app's nonce
 *   and pairing routes from this machine, the Google sign-in routes, redeeming an app pairing code, Omni
 *   Connect's signed routes (CONNECT_OPEN_ROUTES) and the shell's CSP reports from this machine (isCspReport);
 * - a shell (the terminal, or adding, changing, running or retrying a channel action), for anything but the token or
 *   a session paired with it;
 * - a thread's token from anywhere but this machine straight to the server, or one sent with an x-omni-thread header
 *   that names another thread (a wiring bug, which should surface);
 * - a browser's session off its own path (onItsPath), and a signed document address for anything but a read;
 * - through tailscale serve (a tailnet Host, or any proxy header), a Tailscale-User-Login that is not in
 *   `integrations.tailscaleLogin`, when that is set.
 * A raw-token cookie an older build set still works once, and is swapped for a session cookie once the request is let through.
 * A document load on a keyed path is sent to a signed address on /api for that one URL (browser-session.ts docUrl).
 * The desktop app's main process, apps/mcp/omni.ts, scripts and curl send no Origin or Sec-Fetch-Site, so the Host and token checks apply to them.
 */
export const requestGuard: MiddlewareHandler = async (c, next) => {
  const host = requestHost(c);
  const route = routeClass(c);
  const desktop = route === 'pairing' || (c.req.method === 'POST' && c.req.path === DESKTOP_NONCE_PATH);
  if (desktop && hostAllowed(hostnameOf(host)) && !directFromThisMac(c)) return refuse('desktop pairing is only from this machine');
  const open =
    desktop || (c.req.method === 'GET' && c.req.path === PROOF_PATH) || isWebhookPost(c) || isSignInRoute(c) || isAppPairingRoute(c) || isConnectRoute(c) || isCspReport(c);
  const given = bearer(c);
  const base = requestBase(c);
  let auth: OmniAuth = { via: 'none' };
  let legacy = false;
  const install = tokenMatches(given);
  const thread = install ? null : threadTokenCheck(given ?? '');
  if (install) auth = { via: 'token' };
  else if (thread) {
    // Threads reach the server on loopback (runner/state.ts omniUrl): a copy that left the machine counts for nothing.
    if (!directFromThisMac(c)) return refuse("a thread's token works only from this machine", 401);
    const named = c.req.header(THREAD_HEADER);
    if (named && named !== thread) return refuse(`this token is thread ${thread}'s, and the ${THREAD_HEADER} header names another`);
    auth = { via: 'thread', thread };
  } else {
    let session: Session | null = null;
    for (const token of given === undefined ? sessionCookies(c) : [given]) {
      const s = sessionCheck(token);
      if (s && onItsPath(s, base)) {
        session = s;
        break;
      }
    }
    // A signed document address opens its one URL for reading, as the session that was sent to it. Never /api/auth,
    // whose answers name the session's own path.
    if (!session && given === undefined && route === 'read' && !c.req.path.startsWith('/api/auth')) {
      const id = docSession(c);
      session = id ? sessionById(id) : null;
    }
    if (session) auth = { via: 'session', session: session.id, kind: session.kind, method: session.method, cookiePath: session.cookiePath ?? null };
    // An older build's cookie held the token itself. It counts as a token-paired session, and is traded for one below.
    else legacy = !given && !!legacyUpgrade && tokenMatches(getCookie(c, cookieName()));
  }
  const origin = c.req.header('origin');
  let originHost = '';
  try {
    originHost = origin === undefined ? '' : new URL(origin).host;
  } catch {
    // `null` and anything else that is not a URL.
  }
  const credential = route === 'pairing' && nonceLive(c.req.query('nonce')) ? 'nonce' : legacy ? 'session-token' : credentialOf(auth);
  const decision = decideRequest({
    method: c.req.method,
    route,
    hostAllowed: hostAllowed(hostnameOf(host)),
    fetchSite: c.req.header('sec-fetch-site'),
    origin,
    // tailscale serve keeps the Host, and names the original one in X-Forwarded-Host if a proxy does not.
    hosts: [host, c.req.header('x-forwarded-host') ?? ''],
    originAllowed: origin !== undefined && hostAllowed(hostnameOf(originHost)),
    contentType: c.req.header('content-type'),
    credential,
    open,
  });
  if (!decision.ok) {
    // A stale or missing nonce sends the window to the pairing screen, which says what to do, instead of raw JSON.
    if (route === 'pairing' && decision.status === 403 && /nonce/.test(decision.reason)) return c.redirect('/#/pair?desktop=expired', 303);
    return refuse(decision.reason, decision.status);
  }
  const owners = resolved.tailscaleLogins();
  // Through the Connect tunnel there is no Tailscale login to check: the token or a session is the control there.
  if (owners.length && cameThroughProxy(c, host) && !fromConnectTunnel(c, host) && !owners.includes((c.req.header('tailscale-user-login') ?? '').trim().toLowerCase())) {
    return refuse('this Tailscale login is not the owner');
  }
  if (legacy && legacyUpgrade) {
    const s = legacyUpgrade(c);
    auth = { via: 'session', session: s.id, kind: 'browser', method: 'token', cookiePath: s.cookiePath ?? null };
  }
  if (auth.via === 'session' && auth.kind === 'browser' && base !== '/api' && documentLoad(c)) return c.redirect(docUrl(c, auth.session), 303);
  c.set('omniAuth', auth);
  await next();
};
