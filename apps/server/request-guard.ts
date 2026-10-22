// The gate in front of every /api route. Two jobs:
// - Only Omni's own clients get in: every request carries this install's token (apps/server/api-token.ts), as
//   `Authorization: Bearer` or the cookie a paired browser holds. Through tailscale serve, the Tailscale login must
//   also be the owner's when the user config names one.
// - A web page in a browser that holds the cookie cannot use it: a cross-site POST /api/threads would run a prompt
//   with bypassPermissions, and a DNS-rebinding domain could read the responses as well.
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { cookieName, tokenMatches } from './api-token.ts';
import { config } from './config.ts';
import { resolved } from './user-config.ts';

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

const hostnameOf = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
};

const refuse = (reason: string, status = 403) =>
  new Response(JSON.stringify({ error: status === 403 ? `Forbidden: ${reason}` : reason }), { status, headers: { 'content-type': 'application/json' } });

/** The one route that takes no token: the Mac app asks it to prove it is this install before sending the token. */
export const PROOF_PATH = '/api/auth/proof';

const bearer = (c: Context) => c.req.header('authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];

/** A Host that only reaches the server through Tailscale: a MagicDNS name or a 100.64.0.0/10 address. */
export function viaTailnet(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h.endsWith('.ts.net')) return true;
  const cgnat = h.match(/^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  return !!cgnat && Number(cgnat[1]) >= 64 && Number(cgnat[1]) <= 127;
}

/** Body types a cross-site page can send without a CORS preflight. JSON routes never take them. */
const SIMPLE_TYPES = ['text/plain', 'application/x-www-form-urlencoded'];

/**
 * Lets through what Omni's own clients send and refuses what a browser sends on another site's behalf:
 * - a Host outside hostAllowed (DNS rebinding);
 * - Sec-Fetch-Site: cross-site (any request a page on another site made);
 * - an Origin, `null` included, that is not the Host the request came in on;
 * - a text/plain or form-urlencoded body, the content types that skip the preflight;
 * - no token, or the wrong one (401), in the Authorization header or the paired browser's cookie;
 * - through tailscale serve, a Tailscale-User-Login that is not in `integrations.tailscaleLogin`, when that is set.
 * The Mac app, apps/mcp/omni.ts, scripts and curl send no Origin or Sec-Fetch-Site, so the Host and token checks apply to them.
 */
export const requestGuard: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host') ?? new URL(c.req.url).host;
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
  if (!(c.req.method === 'GET' && c.req.path === PROOF_PATH)) {
    if (!tokenMatches(bearer(c) ?? getCookie(c, cookieName()))) return refuse("Unauthorized: send this install's token (data/api-token), or pair this browser", 401);
  }
  const owners = resolved.tailscaleLogins();
  if (owners.length && viaTailnet(hostnameOf(host)) && !owners.includes((c.req.header('tailscale-user-login') ?? '').trim().toLowerCase())) {
    return refuse('this Tailscale login is not the owner');
  }
  await next();
};
