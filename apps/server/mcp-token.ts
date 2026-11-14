// Which Clerk access tokens /mcp takes (PRD #667, finding S1). Every Omni install shares one Clerk instance by default,
// and any app can register an OAuth client there. A token Clerk issued to that app for Ben names Ben as its subject,
// so the subject alone does not make a token Omni's. A token gets in only when it is also bound to this install:
// - a JWT whose audience names this install's /mcp resource (RFC 8707), or
// - a JWT issued to an OAuth client Ben approved (Settings, or POST /api/mcp/clients/:id/approve).
// An opaque token names no client Omni can read without Clerk's secret key, so it is refused unless
// OMNI_MCP_ALLOW_OPAQUE=1 brings back the old subject-only check.
//
// verifyMcpToken is the whole decision. It takes everything it needs as arguments, so its tests need no db or network.
import { createPublicKey, createVerify, type JsonWebKeyInput } from 'node:crypto';

export type Jwk = JsonWebKeyInput['key'] & { kid?: string };

/**
 * A client's status in the local list (mcp-clients.ts): approved by Ben, bound (only its tokens that name this install
 * got in), pending (refused, waiting for approval) or removed.
 */
export type ClientStatus = 'approved' | 'bound' | 'pending' | 'removed';

export interface VerifyInput {
  /** The Clerk issuer MCP sign-in uses. */
  issuer: string;
  /** The linked owner's Clerk user id. */
  ownerSub: string;
  /** This install's /mcp resource URLs. A JWT whose `aud` names one is bound to it. */
  resources: readonly string[];
  /** A client's status in the local list, or null when Omni has never seen it. */
  clientStatus: (clientId: string) => ClientStatus | null;
  /** Take an opaque token on the subject alone, as before PRD #667. */
  allowOpaque: boolean;
  /** The instance's public key for a kid, or null. */
  keyFor: (kid: string) => Promise<Jwk | null>;
  /** The user Clerk's userinfo names for the token, or null when Clerk refuses it. Catches revoked JWTs too. */
  userinfoSub: (token: string) => Promise<string | null>;
  now?: number;
}

export type Verdict =
  | { ok: true; client: string | null; via: 'audience' | 'client' | 'opaque' }
  | { ok: false; reason: string; client: string | null; kind: 'invalid' | 'unbound' | 'removed' | 'opaque' };

const SKEW_S = 60;

const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();

type Decoded = { header: { alg?: string; kid?: string }; claims: Record<string, unknown>; signed: string; sig: Buffer };

/** Splits a JWT, or null when the token is not one (Clerk's opaque tokens). */
export function decodeJwt(token: string): Decoded | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[\w-]+$/.test(p))) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') return null;
    return { header, claims, signed: `${parts[0]}.${parts[1]}`, sig: Buffer.from(parts[2], 'base64url') };
  } catch {
    return null;
  }
}

const refuse = (kind: Extract<Verdict, { ok: false }>['kind'], reason: string, client: string | null = null): Verdict => ({ ok: false, kind, reason, client });

/** Whether `token` may use /mcp. Throws only when `keyFor` or `userinfoSub` throws (Clerk out of reach). */
export async function verifyMcpToken(token: string, input: VerifyInput): Promise<Verdict> {
  const jwt = decodeJwt(token);
  if (!jwt) {
    if (!input.allowOpaque)
      return refuse(
        'opaque',
        'This sign-in gave the client an opaque Clerk token, which Omni cannot tie to this install. Use the MCP token (data/mcp-token), or reconnect once the Clerk instance issues JWT access tokens',
      );
    const sub = await input.userinfoSub(token);
    return sub && sub === input.ownerSub ? { ok: true, client: null, via: 'opaque' } : refuse('invalid', 'Clerk does not name the owner for this token');
  }
  const { header, claims } = jwt;
  if (header.alg !== 'RS256' || !header.kid) return refuse('invalid', 'Access token is not RS256');
  const jwk = await input.keyFor(header.kid);
  if (!jwk) return refuse('invalid', 'Access token signed with an unknown key');
  let valid = false;
  try {
    valid = createVerify('RSA-SHA256').update(jwt.signed).verify(createPublicKey({ key: jwk, format: 'jwk' }), jwt.sig);
  } catch {
    valid = false;
  }
  if (!valid) return refuse('invalid', 'Access token signature does not match');
  const now = (input.now ?? Date.now()) / 1000;
  if (claims.iss !== input.issuer) return refuse('invalid', 'Access token from another issuer');
  if (typeof claims.exp !== 'number' || claims.exp < now - SKEW_S) return refuse('invalid', 'Access token expired');
  if (typeof claims.nbf === 'number' && claims.nbf > now + SKEW_S) return refuse('invalid', 'Access token not valid yet');
  if (typeof claims.sub !== 'string' || claims.sub !== input.ownerSub) return refuse('invalid', "Access token is not for this Omni's owner");
  const clientClaim = claims.client_id ?? claims.azp;
  const client = typeof clientClaim === 'string' && clientClaim ? clientClaim : null;
  const status = client ? input.clientStatus(client) : null;
  if (status === 'removed') return refuse('removed', `The OAuth client ${client} was removed from this Omni. Approve it again in Settings to reconnect`, client);
  const aud = (Array.isArray(claims.aud) ? claims.aud : [claims.aud]).filter((a): a is string => typeof a === 'string').map(norm);
  const mine = new Set(input.resources.map(norm));
  let via: 'audience' | 'client' | null = null;
  if (aud.some((a) => mine.has(a))) via = 'audience';
  else if (status === 'approved') via = 'client';
  if (!via) {
    return refuse(
      'unbound',
      client
        ? `The OAuth client ${client} is not approved for this Omni. Approve it in Settings, Sharing & access, then reconnect`
        : 'Access token names neither this Omni nor an OAuth client. Reconnect the client',
      client,
    );
  }
  // A signature cannot say the token was revoked since. Clerk's userinfo can, and answers for JWTs too.
  const sub = await input.userinfoSub(token);
  if (sub !== input.ownerSub) return refuse('invalid', 'Clerk no longer accepts this token', client);
  return { ok: true, client, via };
}
