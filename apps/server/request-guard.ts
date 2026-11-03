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
import { cookieName, sessionCookieName, tokenMatches } from './api-token.ts';
import { config } from './config.ts';
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
 * The desktop app opens this once, in its own window, and the response sets the pairing cookie.
 * No token in the URL. Only a request from this machine that did not come through a proxy (so Tailscale
 * and a forwarded client still have to pair with the token).
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
export const APP_PAIRING_OPEN_ROUTES: readonly (readonly [string, string])[] = [['POST', '/api/auth/app-pairings/redeem']];
const isAppPairingRoute = (c: Context) => APP_PAIRING_OPEN_ROUTES.some(([m, p]) => c.req.method === m && c.req.path === p);

/** Omni Connect's routes that prove themselves: the relay's signed mint and health requests, and a browser's code and key proof. */
export const CONNECT_OPEN_ROUTES: readonly (readonly [string, string])[] = [
  ['POST', '/api/connect/mint'],
  ['POST', '/api/connect/health'],
  ['POST', '/api/connect/redeem'],
];
const isConnectRoute = (c: Context) => CONNECT_OPEN_ROUTES.some(([m, p]) => c.req.method === m && c.req.path === p);

/**
 * How a request proved itself: the install's token, a device's session (`method`: signed in with Google, or an app
 * that redeemed a pairing code), or neither (the open routes).
 */
export type OmniAuth = { via: 'token' } | { via: 'session'; session: string; kind: 'browser' | 'app'; method: 'google' | 'pairing' } | { via: 'none' };

declare module 'hono' {
  interface ContextVariableMap {
    omniAuth: OmniAuth;
  }
}

/** Looks a session token up (google-auth.ts sessionFor). app.ts sets it, so this module and its tests never open the db. */
let sessionCheck: (token: string) => { id: string; kind: 'browser' | 'app'; method: 'google' | 'pairing' } | null = () => null;
export const useSessionCheck = (fn: typeof sessionCheck) => {
  sessionCheck = fn;
};

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

/** True only for GET desktop-pair from this machine, with no proxy in front. The handler sets the cookie. */
export function desktopPairAllowed(c: Context): boolean {
  if (c.req.method !== 'GET' || c.req.path !== DESKTOP_PAIR_PATH) return false;
  return fromThisMac(c) && !cameThroughProxy(c, requestHost(c));
}

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

/** Body types a cross-site page can send without a CORS preflight. JSON routes never take them. */
const SIMPLE_TYPES = ['text/plain', 'application/x-www-form-urlencoded'];

/**
 * Lets through what Omni's own clients send and refuses what a browser sends on another site's behalf:
 * - a Host outside hostAllowed (DNS rebinding);
 * - Sec-Fetch-Site: cross-site (any request a page on another site made);
 * - an Origin, `null` included, that is not the Host the request came in on;
 * - a text/plain or form-urlencoded body, the content types that skip the preflight;
 * - no token, or the wrong one (401), in the Authorization header or the paired browser's cookie, and no live
 *   device session in either, except on the proof route, a GitHub webhook post (its own signature), GET desktop-pair
 *   from this machine, the Google sign-in routes, redeeming an app pairing code, and Omni Connect's signed routes (CONNECT_OPEN_ROUTES);
 * - through tailscale serve (a tailnet Host, or any proxy header), a Tailscale-User-Login that is not in
 *   `integrations.tailscaleLogin`, when that is set.
 * The desktop app's main process, apps/mcp/omni.ts, scripts and curl send no Origin or Sec-Fetch-Site, so the Host and token checks apply to them.
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
  const desktop = c.req.method === 'GET' && c.req.path === DESKTOP_PAIR_PATH;
  if (desktop && !desktopPairAllowed(c)) return refuse('desktop pairing is only from this machine');
  const open = desktop || (c.req.method === 'GET' && c.req.path === PROOF_PATH) || isWebhookPost(c) || isSignInRoute(c) || isAppPairingRoute(c) || isConnectRoute(c);
  const given = bearer(c);
  let auth: OmniAuth = { via: 'none' };
  if (tokenMatches(given ?? getCookie(c, cookieName()))) auth = { via: 'token' };
  else {
    const session = sessionCheck(given ?? getCookie(c, sessionCookieName()) ?? '');
    if (session) auth = { via: 'session', session: session.id, kind: session.kind, method: session.method };
  }
  if (auth.via === 'none' && !open) return refuse("Unauthorized: send this install's token (data/api-token), pair this browser, or sign in with Google", 401);
  c.set('omniAuth', auth);
  const owners = resolved.tailscaleLogins();
  // Through the Connect tunnel there is no Tailscale login to check: the token or a session is the control there.
  if (owners.length && cameThroughProxy(c, host) && !fromConnectTunnel(c, host) && !owners.includes((c.req.header('tailscale-user-login') ?? '').trim().toLowerCase())) {
    return refuse('this Tailscale login is not the owner');
  }
  await next();
};
