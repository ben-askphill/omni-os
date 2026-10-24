// Google's half of sign-in (apps/server/sign-in.ts): the authorization URL, the code exchange and the ID token check.
// Scopes openid email profile only, so Omni never gets access to anything in the Google account, and it keeps no
// Google token once the ID token is checked. The endpoints move with env vars only, for tests and the QA stack
// (packages/test-fixtures/fake-google.mjs).
import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';

export const googleEndpoints = () => ({
  auth: process.env.OMNI_GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: process.env.OMNI_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  jwks: process.env.OMNI_GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs',
});

/** Google's ID tokens name either. */
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** How far apart Google's clock and this Mac's may be. */
const SKEW_S = 60;
const TIMEOUT_MS = 10_000;

/** A sign-in that cannot go on. `message` is shown to the person as it is. */
export class SignInError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409 | 410 | 502 = 400,
  ) {
    super(message);
  }
}

export const randomSecret = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
/** PKCE S256: the challenge Google sees for the verifier only Omni holds. */
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export function authorizationUrl(p: { clientId: string; redirectUri: string; state: string; nonce: string; verifier: string; hd?: string }) {
  const url = new URL(googleEndpoints().auth);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: 'openid email profile',
    state: p.state,
    nonce: p.nonce,
    code_challenge: pkceChallenge(p.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
    ...(p.hd ? { hd: p.hd } : {}),
  }).toString();
  return url.toString();
}

/** Trades the authorization code for Google's ID token. The access token that comes with it is dropped. */
export async function exchangeCode(p: { code: string; clientId: string; clientSecret: string | null; redirectUri: string; verifier: string }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code_verifier: p.verifier,
    ...(p.clientSecret ? { client_secret: p.clientSecret } : {}),
  });
  let res: Response;
  try {
    res = await fetch(googleEndpoints().token, { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new SignInError('Could not reach Google to finish signing in. Try again.', 502);
  }
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.id_token) {
    const why = json.error_description || json.error || `HTTP ${res.status}`;
    throw new SignInError(`Google did not finish the sign-in (${why}). Try again.`, 502);
  }
  return json.id_token;
}

export type IdClaims = {
  iss: string;
  aud: string | string[];
  azp?: string;
  sub: string;
  email: string;
  email_verified: boolean | string;
  exp: number;
  iat: number;
  nonce?: string;
  name?: string;
  hd?: string;
};

let jwks: { keys: Map<string, KeyObject>; until: number; url: string } | null = null;

async function loadKeys() {
  const url = googleEndpoints().jwks;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new SignInError('Could not reach Google to check the sign-in. Try again.', 502);
  }
  const unreadable = () => new SignInError('Could not load Google’s signing keys. Try again.', 502);
  if (!res.ok) throw unreadable();
  const keys = new Map<string, KeyObject>();
  try {
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    for (const k of body.keys ?? []) if (k.kid && k.kty === 'RSA') keys.set(k.kid, createPublicKey({ key: k, format: 'jwk' }));
  } catch {
    throw unreadable();
  }
  const maxAge = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 3600);
  jwks = { keys, until: Date.now() + Math.min(maxAge, 86_400) * 1000, url };
  return keys;
}

/** The key Google signed with: from the cached set, or a fresh one when the cache is old or the key is new to it (rotation). */
async function keyFor(kid: string) {
  const fresh = jwks && jwks.url === googleEndpoints().jwks && jwks.until > Date.now();
  const cached = fresh ? jwks!.keys.get(kid) : undefined;
  return cached ?? (await loadKeys()).get(kid);
}

const decodePart = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/**
 * Google's ID token, checked: RS256 signed by a key in Google's JWKS, issued by Google, for `audience` (the client id
 * the sign-in used, and its `azp` when there are several), not expired, carrying the nonce this sign-in sent, and for
 * a verified address.
 */
export async function verifyIdToken(jwt: string, expect: { audience: string; nonce: string; nowMs?: number }): Promise<IdClaims> {
  const bad = () => new SignInError('Google’s answer did not check out. Try signing in again.', 403);
  const parts = jwt.split('.');
  if (parts.length !== 3) throw bad();
  let header: { alg?: string; kid?: string };
  let claims: IdClaims;
  try {
    header = decodePart(parts[0]);
    claims = decodePart(parts[1]);
  } catch {
    throw bad();
  }
  if (header.alg !== 'RS256' || !header.kid) throw bad();
  const key = await keyFor(header.kid);
  if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw bad();
  const now = Math.floor((expect.nowMs ?? Date.now()) / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!ISSUERS.includes(claims.iss) || !aud.includes(expect.audience)) throw bad();
  // OpenID Connect: with more than one audience, the party it was issued to must be named, and be this client.
  if (aud.length > 1 && claims.azp !== expect.audience) throw bad();
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < now || (typeof claims.iat === 'number' && claims.iat - SKEW_S > now)) {
    throw new SignInError('That Google sign-in has expired. Try again.', 403);
  }
  if (!claims.nonce || claims.nonce !== expect.nonce) throw bad();
  if (!claims.sub || !claims.email) throw bad();
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new SignInError(`Google has not verified ${claims.email}, so it cannot sign in.`, 403);
  }
  return claims;
}
