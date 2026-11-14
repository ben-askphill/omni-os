// OAuth for /mcp through Clerk: how claude.ai, ChatGPT and other MCP clients sign in with Google instead of holding
// data/mcp-token. Omni is the protected resource and the Clerk instance that Google sign-in uses (apps/server/clerk.ts)
// is the authorization server. A client finds Clerk through the metadata here (RFC 9728), registers and signs in there,
// and sends the access token it gets to /mcp.
//
// A token gets in only when it is the owner's (google-auth.ts) and bound to this install: mcp-token.ts decides, with
// the instance's JWKS for the signature and Clerk's userinfo endpoint for revocation. Userinfo answers are cached
// briefly, so a busy client costs one Clerk call a minute. The resource URL comes from configuration and the Host,
// never X-Forwarded-*, so a proxy header cannot point a client at another host.
import { createHash } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { DEFAULT_CLERK_PUBLISHABLE_KEY, issuerFromKey } from './clerk.ts';
import { owner } from './google-auth.ts';
import { config } from './config.ts';
import { connectHostname } from './connect/service.ts';
import { mcpClients } from './mcp-clients.ts';
import { verifyMcpToken, type Jwk, type Verdict } from './mcp-token.ts';
import { mcpHostAllowed, mcpPublicHost, viaConnect, viaTailnet } from './request-guard.ts';
import { resolved } from './user-config.ts';

/** What a client asks Clerk for: enough for userinfo to name the user. */
export const MCP_SCOPES = ['openid', 'profile', 'email'];

/** How long Clerk's answer for a token holds: a live one, and a refused one. */
const OK_MS = 60_000;
const NO_MS = 10_000;
const CACHE_MAX = 500;
const META_MS = 10 * 60_000;

/**
 * The Clerk instance MCP clients sign in with: the configured one, while an owner from that instance is linked.
 * Null: OAuth is off for /mcp, and only the static tokens get in.
 */
export function mcpIssuer(): string | null {
  const issuer = issuerFromKey(resolved.clerkPublishableKey() || DEFAULT_CLERK_PUBLISHABLE_KEY);
  return issuer && owner()?.issuer === issuer ? issuer : null;
}

let fetchImpl: typeof fetch = (...args) => fetch(...args);
const answers = new Map<string, { at: number; sub: string | null }>();
let asMetadata: { issuer: string; at: number; body: Promise<unknown> } | null = null;

/** For tests: the fetch that reaches Clerk, and a clean cache. */
export function setOAuthFetch(f?: typeof fetch) {
  fetchImpl = f ?? ((...args) => fetch(...args));
  answers.clear();
  asMetadata = null;
  jwks = null;
}

/** Clerk did not answer, so a token could not be checked either way. */
export class ClerkUnreachable extends Error {}

/** The user Clerk's userinfo names for `token`, or null when Clerk refuses it. */
async function userinfoSub(issuer: string, token: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchImpl(`${issuer}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    throw new ClerkUnreachable(`Cannot reach Clerk (${(err as Error).message})`);
  }
  if (res.status >= 500) throw new ClerkUnreachable(`Clerk answered HTTP ${res.status}`);
  if (!res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { sub?: unknown };
  return typeof body.sub === 'string' && body.sub ? body.sub : null;
}

let jwks: { issuer: string; at: number; keys: Map<string, Jwk> } | null = null;

/** The instance's signing key for `kid`, reading the JWKS again once for a kid it has not seen (a key rotation). */
async function keyFor(issuer: string, kid: string, now: number): Promise<Jwk | null> {
  if (jwks?.issuer === issuer && now - jwks.at < META_MS && jwks.keys.has(kid)) return jwks.keys.get(kid)!;
  let res: Response;
  try {
    res = await fetchImpl(`${issuer}/.well-known/jwks.json`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    throw new ClerkUnreachable(`Cannot reach Clerk (${(err as Error).message})`);
  }
  if (!res.ok) throw new ClerkUnreachable(`Clerk answered HTTP ${res.status}`);
  const { keys = [] } = (await res.json().catch(() => ({}))) as { keys?: Jwk[] };
  jwks = { issuer, at: now, keys: new Map(keys.filter((k) => k.kid).map((k) => [k.kid!, k])) };
  return jwks.keys.get(kid) ?? null;
}

/** Clerk's userinfo answer for a token, cached briefly. */
async function cachedSub(issuer: string, token: string, now: number): Promise<string | null> {
  const key = createHash('sha256').update(`${issuer}\n${token}`).digest('hex');
  const hit = answers.get(key);
  if (hit && now - hit.at < (hit.sub ? OK_MS : NO_MS)) return hit.sub;
  const sub = await userinfoSub(issuer, token);
  if (answers.size >= CACHE_MAX) for (const [k, v] of answers) if (now - v.at >= OK_MS) answers.delete(k);
  if (answers.size < CACHE_MAX) answers.set(key, { at: now, sub });
  return sub;
}

/**
 * This install's /mcp resource URLs, from configuration only, never from what a request names: the configured public
 * URL, this machine's Connect hostname, and loopback on this port for a client on this machine.
 */
export function mcpResources(): string[] {
  const out = new Set<string>([`http://127.0.0.1:${config.port}/mcp`, `http://localhost:${config.port}/mcp`]);
  const configured = resolved.mcpPublicUrl();
  if (configured) out.add(`${configured}/mcp`);
  const connect = connectHostname();
  if (connect) out.add(`https://${connect}/mcp`);
  return [...out];
}

/**
 * Whether `token` is a Clerk OAuth access token for this install's owner, bound to this install (mcp-token.ts).
 * Null while OAuth is off. Throws ClerkUnreachable when Clerk could not be asked. Records the client it names.
 */
export async function mcpTokenVerdict(token: string, now = Date.now()): Promise<Verdict | null> {
  const issuer = mcpIssuer();
  const ownerSub = owner()?.sub;
  if (!issuer || !ownerSub || !token) return null;
  const verdict = await verifyMcpToken(token, {
    issuer,
    ownerSub,
    resources: mcpResources(),
    clientStatus: mcpClients.status,
    allowOpaque: process.env.OMNI_MCP_ALLOW_OPAQUE === '1',
    keyFor: (kid) => keyFor(issuer, kid, now),
    userinfoSub: (t) => cachedSub(issuer, t, now),
    now,
  });
  // Seen, never approved: an audience match lets that token in, and only Ben's approval lets in the client's tokens that lack one.
  if (verdict.ok && verdict.client && verdict.via !== 'opaque') mcpClients.seen(verdict.client, verdict.via);
  else if (!verdict.ok && verdict.kind === 'unbound' && verdict.client) mcpClients.seen(verdict.client, null);
  return verdict;
}

/**
 * The address a client reached this server on, from configuration and the Host it named, never X-Forwarded-*:
 * the configured public URL for its hostname, https for the Connect and tailnet names, http for loopback.
 */
export function publicBase(c: Context): string {
  const url = new URL(c.req.url);
  const host = c.req.header('host') || url.host;
  const name = hostnameOf(host).toLowerCase().replace(/\.$/, '');
  const configured = resolved.mcpPublicUrl();
  if (configured && name === mcpPublicHost()) return configured;
  if (viaConnect(name) || viaTailnet(name)) return `https://${host}`;
  return `${url.protocol}//${host}`;
}

/** The metadata URL a 401 from /mcp points clients at. */
export const resourceMetadataUrl = (c: Context) => `${publicBase(c)}/.well-known/oauth-protected-resource/mcp`;

const hostnameOf = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
};

// Public documents every client may read, browser-based ones (the MCP Inspector) included.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'mcp-protocol-version' };

/** Clerk's authorization server metadata, read at most every ten minutes. */
function clerkMetadata(issuer: string, now = Date.now()): Promise<unknown> {
  if (asMetadata?.issuer === issuer && now - asMetadata.at < META_MS) return asMetadata.body;
  const body = fetchImpl(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(10_000) }).then((r) => {
    if (!r.ok) throw new ClerkUnreachable(`Clerk answered HTTP ${r.status}`);
    return r.json();
  });
  asMetadata = { issuer, at: now, body };
  body.catch(() => (asMetadata = null));
  return body;
}

/**
 * /.well-known: the protected resource metadata for /mcp, and Clerk's authorization server metadata again, for
 * clients on the 2025-03-26 MCP spec that look for it on the server they connect to. Both 404 while OAuth is off.
 */
export const oauthMetadataApi = new Hono();

oauthMetadataApi.use('*', async (c, next) => {
  if (!mcpHostAllowed(hostnameOf(c.req.header('host') ?? new URL(c.req.url).host))) return c.json({ error: 'Forbidden: host not allowed' }, 403);
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  await next();
  for (const [k, v] of Object.entries(CORS)) c.res.headers.set(k, v);
});

const protectedResource = (c: Context) => {
  const issuer = mcpIssuer();
  if (!issuer) return c.json({ error: 'Google sign-in for MCP is off: link a Google account in Settings, Sharing & access' }, 404);
  return c.json({
    resource: `${publicBase(c)}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Omni',
  });
};
oauthMetadataApi.get('/oauth-protected-resource', protectedResource);
oauthMetadataApi.get('/oauth-protected-resource/mcp', protectedResource);

const authorizationServer = async (c: Context) => {
  const issuer = mcpIssuer();
  if (!issuer) return c.json({ error: 'Google sign-in for MCP is off' }, 404);
  try {
    return c.json(await clerkMetadata(issuer));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
};
oauthMetadataApi.get('/oauth-authorization-server', authorizationServer);
oauthMetadataApi.get('/oauth-authorization-server/mcp', authorizationServer);
