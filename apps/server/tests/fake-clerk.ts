import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

// A Clerk instance in memory, as a fetch: its OpenID and OAuth metadata, JWKS, device authorization, token and userinfo
// endpoints. accessToken() hands out an opaque OAuth access token, as an MCP client gets after signing in.
// Tests approve or deny a pending sign-in by hand. ID tokens are signed with a real RSA key, so ClerkClient's
// signature check runs for real. Nothing here reaches the network.

export const FAKE_ISSUER = 'https://fake-walrus.clerk.accounts.dev';
export const FAKE_CLIENT_ID = 'omni-test-client';
/** The publishable key that names FAKE_ISSUER. */
export const FAKE_PUBLISHABLE_KEY = `pk_test_${Buffer.from('fake-walrus.clerk.accounts.dev$').toString('base64')}`;

type Who = { sub: string; email?: string; name?: string };
type Pending = { userCode: string; state: 'pending' | 'denied' | Who };

export function fakeClerk(opts: { interval?: number; issuer?: string; clientId?: string } = {}) {
  const issuer = opts.issuer ?? FAKE_ISSUER;
  const clientId = opts.clientId ?? FAKE_CLIENT_ID;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'key-1';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map<string, Pending>();
  const accessTokens = new Map<string, Who>();
  const calls: string[] = [];

  /** An RS256 JWT over claims, with this instance's key unless `key` says otherwise. */
  const sign = (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid }, key = privateKey) => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const body = `${enc(header)}.${enc(claims)}`;
    return `${body}.${createSign('RSA-SHA256').update(body).sign(key).toString('base64url')}`;
  };

  const idToken = (who: Who, extra: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return sign({ iss: issuer, aud: clientId, sub: who.sub, email: who.email, name: who.name, iat: now, exp: now + 3600, ...extra });
  };

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.pathname);
    if (url.origin !== issuer) throw new TypeError(`fake Clerk: unexpected ${url.href}`);
    const form = new URLSearchParams(String(init?.body ?? ''));
    switch (url.pathname) {
      case '/.well-known/openid-configuration':
        return json({
          issuer,
          token_endpoint: `${issuer}/oauth/token`,
          device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
          jwks_uri: `${issuer}/.well-known/jwks.json`,
        });
      case '/.well-known/oauth-authorization-server':
        return json({
          issuer,
          authorization_endpoint: `${issuer}/oauth/authorize`,
          token_endpoint: `${issuer}/oauth/token`,
          registration_endpoint: `${issuer}/oauth/register`,
          code_challenge_methods_supported: ['S256'],
        });
      case '/oauth/userinfo': {
        const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
        const who = accessTokens.get(token);
        if (!who) return json({ errors: [{ code: 'oauth_fetch_user_error' }] }, 401);
        return json({ sub: who.sub, email: who.email, name: who.name });
      }
      case '/.well-known/jwks.json':
        return json({ keys: [jwk] });
      case '/oauth/device_authorization': {
        if (form.get('client_id') !== clientId) return json({ error: 'invalid_client' }, 401);
        const deviceCode = randomBytes(16).toString('hex');
        const userCode = `${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}`.toUpperCase();
        codes.set(deviceCode, { userCode, state: 'pending' });
        return json({
          device_code: deviceCode,
          user_code: userCode,
          verification_uri: `${issuer}/oauth/device`,
          verification_uri_complete: `${issuer}/oauth/device?user_code=${userCode}`,
          expires_in: 600,
          interval: opts.interval ?? 1,
        });
      }
      case '/oauth/token': {
        const p = codes.get(form.get('device_code') ?? '');
        if (!p || form.get('client_id') !== clientId) return json({ error: 'invalid_grant' }, 400);
        if (p.state === 'pending') return json({ error: 'authorization_pending' }, 400);
        if (p.state === 'denied') return json({ error: 'access_denied' }, 400);
        codes.delete(form.get('device_code')!);
        return json({ access_token: 'opaque', token_type: 'bearer', id_token: idToken(p.state) });
      }
    }
    return json({ error: 'not_found' }, 404);
  };

  /** Approve the pending sign-in showing `userCode`, as `who`. */
  const approve = (userCode: string, who: Who) => {
    for (const p of codes.values()) if (p.userCode === userCode) p.state = who;
  };
  const deny = (userCode: string) => {
    for (const p of codes.values()) if (p.userCode === userCode) p.state = 'denied';
  };

  /** A new OAuth access token for `who`, opaque like Clerk's. revoke() makes userinfo refuse it. */
  const accessToken = (who: Who) => {
    const token = `oat_${randomBytes(16).toString('hex')}`;
    accessTokens.set(token, who);
    return token;
  };
  const revoke = (token: string) => accessTokens.delete(token);

  /** A new JWT OAuth access token for `who`, issued to `client`, with `aud` when given. Userinfo answers for it too. */
  const jwtAccessToken = (who: Who, opts: { client?: string; aud?: string | string[]; exp?: number } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const token = sign({ iss: issuer, sub: who.sub, jti: randomBytes(8).toString('hex'), client_id: opts.client ?? 'client_dcr', ...(opts.aud ? { aud: opts.aud } : {}), iat: now, exp: opts.exp ?? now + 3600 });
    accessTokens.set(token, who);
    return token;
  };

  return { issuer, clientId, fetch, approve, deny, sign, idToken, accessToken, jwtAccessToken, revoke, calls, privateKey, jwk };
}
