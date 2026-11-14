// /mcp: the external Omni MCP server (apps/mcp/external/) over Streamable HTTP, for clients that reach Omni by URL
// rather than starting a process here: claude.ai, ChatGPT, Grok, or Cursor and Claude Code on another machine.
//
// Three ways in:
// - Google sign-in through Clerk (mcp-oauth.ts): a Clerk OAuth access token for this install's owner, bound to this
//   install by its audience or an approved client (mcp-token.ts), as `Authorization: Bearer`. A 401 names the protected resource metadata, so claude.ai, ChatGPT and other OAuth
//   clients find Clerk and sign in by themselves. On only while a Google account is linked (Settings, Sharing & access).
// - data/mcp-token, apart from the API token: the URL goes into other companies' connector settings, and rotating it
//   (delete the file, restart) must not unpair every browser. As a Bearer header, or in the path as /mcp/<mcp-token>
//   for a client that only takes a URL.
// - The API token, as a header only, never in the path.
// Its tools then call /api in-process with the API token, so every request still passes requestGuard.
//
// No Tailscale login check: the Cloudflare Tunnel that claude.ai, ChatGPT and Grok reach the Mac through carries none.
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { callOver } from '@omni/mcp/external/tools.ts';
import { mcpHttp } from '@omni/mcp/external/http.ts';
import { apiToken, loadToken, tokenMatches } from './api-token.ts';
import { paths } from './config.ts';
import { ClerkUnreachable, mcpIssuer, mcpTokenVerdict, resourceMetadataUrl } from './mcp-oauth.ts';
import { mcpHostAllowed } from './request-guard.ts';

export const mcpTokenPath = () => join(paths.data, 'mcp-token');

let cached: string | null = null;

/** The connector token, made on first use. OMNI_MCP_TOKEN wins, for tests and throwaway servers. */
export function mcpToken(): string {
  cached ??= loadToken(mcpTokenPath(), { OMNI_TOKEN: process.env.OMNI_MCP_TOKEN });
  return cached;
}

const digest = (s: string) => createHash('sha256').update(s).digest();
const mcpTokenMatches = (given: string | undefined) => !!given && timingSafeEqual(digest(given), digest(mcpToken()));

const hostnameOf = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
};

const refuse = (message: string, status: 401 | 403 | 503, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * The 401 for /mcp. With Google sign-in on, its challenge names the resource metadata (RFC 9728), which is how an
 * OAuth client learns to sign in with Clerk; `invalid_token` tells one holding a stale token to sign in again.
 */
function challenge(c: Context, sentToken: boolean, why?: string) {
  const oauth = !!mcpIssuer();
  const params = [...(sentToken ? ['error="invalid_token"'] : []), ...(oauth ? [`resource_metadata="${resourceMetadataUrl(c)}"`] : [])];
  const how = oauth ? 'sign in with the Google account linked to this Omni, or send' : 'send';
  const message = why ? `Unauthorized: ${why}` : `Unauthorized: ${how} this install's MCP token (data/mcp-token) as a Bearer header or in the URL as /mcp/<token>`;
  return refuse(message, 401, {
    'www-authenticate': params.length ? `Bearer ${params.join(', ')}` : 'Bearer',
  });
}

/** The router for /mcp, whose tools reach /api through `request` (app.request, in-process). */
export function mcpApi(request: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const call = callOver(async (path, init) =>
    request(path, { ...init, headers: { ...init.headers, host: '127.0.0.1', authorization: `Bearer ${apiToken()}` } }),
  );
  const answer = mcpHttp(call);
  const router = new Hono();

  router.all('/:token?', async (c) => {
    // DNS rebinding: a page on an attacker's name pointed at this Mac. cloudflared keeps the tunnel's public name
    // (integrations.mcpPublicUrl), tailscale serve the .ts.net one.
    if (!mcpHostAllowed(hostnameOf(c.req.header('host') ?? new URL(c.req.url).host))) return refuse('Forbidden: host not allowed', 403);
    // claude.ai and ChatGPT call from their servers with no Origin. A browser page on another site would send one.
    const origin = c.req.header('origin');
    if (origin !== undefined && !mcpHostAllowed(hostnameOf(origin.replace(/^[a-z]+:\/\//i, '')))) return refuse('Forbidden: origin not allowed', 403);
    const inPath = c.req.param('token');
    if (inPath !== undefined) {
      // A URL holds only the MCP token: never the API token, and never an OAuth token, which a header carries.
      if (!mcpTokenMatches(inPath)) return refuse("Unauthorized: that is not this install's MCP token", 401, { 'www-authenticate': 'Bearer' });
      return answer(c.req.raw);
    }
    const bearer = c.req.header('authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
    if (mcpTokenMatches(bearer) || tokenMatches(bearer)) return answer(c.req.raw);
    if (bearer) {
      try {
        const verdict = await mcpTokenVerdict(bearer, c);
        if (verdict?.ok) return answer(c.req.raw);
        // A real owner token for a client this install does not take: say why, so the client's user can approve or reconnect.
        if (verdict && verdict.kind !== 'invalid') return challenge(c, true, verdict.reason);
      } catch (err) {
        if (err instanceof ClerkUnreachable) return refuse(`Could not check the sign-in: ${err.message}. Try again shortly`, 503, { 'retry-after': '10' });
        throw err;
      }
    }
    return challenge(c, !!bearer);
  });

  return router;
}
