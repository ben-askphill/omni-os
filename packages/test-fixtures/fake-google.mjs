#!/usr/bin/env node
// A stand-in for Google's OAuth and OpenID endpoints, for the server's tests and the QA stack (scripts/qa-stack.sh
// with QA_GOOGLE=1). Point the server at it with OMNI_GOOGLE_AUTH_URL, OMNI_GOOGLE_TOKEN_URL and OMNI_GOOGLE_JWKS_URL.
//
// - GET /o/oauth2/v2/auth: Google's consent page. With `login_hint` naming one of its accounts it sends the browser
//   straight back with a code; with `deny=1`, back with error=access_denied; otherwise it shows an account chooser.
// - POST /token: the code exchange, checked as Google checks it: the code once, the same client and redirect URI, the
//   PKCE verifier against the challenge, and the client secret when the client has one.
// - GET /oauth2/v3/certs: the JWKS its ID tokens verify against. A fresh RSA key each start.
//
// Run alone, `node fake-google.mjs [--port N]` prints {"url", "auth", "token", "jwks"} as one JSON line and stays up.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';

export const FAKE_ACCOUNTS = [
  { email: 'ada@example.com', name: 'Ada Lovelace', sub: '100000000000000000001', email_verified: true },
  { email: 'grace@example.org', name: 'Grace Hopper', sub: '100000000000000000002', email_verified: true, hd: 'example.org' },
  // An address on example.org that is not a Workspace account there: no hd claim, so allowedHd must not admit it.
  { email: 'outsider@example.org', name: 'Outsider', sub: '100000000000000000005', email_verified: true },
  { email: 'mallory@example.net', name: 'Mallory', sub: '100000000000000000003', email_verified: true },
  { email: 'unverified@example.com', name: 'Unverified', sub: '100000000000000000004', email_verified: false },
];

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const escape = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Starts the fake on `port` (0 picks a free one). `clients` maps a client id to its secret (null for none); empty
 * accepts any client id with no secret.
 */
export async function startFakeGoogle({ port = 0, host = '127.0.0.1', accounts = FAKE_ACCOUNTS, clients = {}, ttlSeconds = 3600 } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomBytes(8).toString('hex');
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  /** code -> what the consent page saw */
  const codes = new Map();
  const knownClient = (id) => Object.keys(clients).length === 0 || Object.hasOwn(clients, id);

  const signIdToken = (claims, key = privateKey, keyId = kid) => {
    const head = b64url({ alg: 'RS256', kid: keyId, typ: 'JWT' });
    const body = b64url(claims);
    return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
  };

  const idTokenFor = (account, clientId, nonce, now = Math.floor(Date.now() / 1000)) =>
    signIdToken({
      iss: 'https://accounts.google.com',
      azp: clientId,
      aud: clientId,
      sub: account.sub,
      email: account.email,
      email_verified: account.email_verified,
      name: account.name,
      ...(account.hd ? { hd: account.hd } : {}),
      ...(nonce ? { nonce } : {}),
      iat: now,
      exp: now + ttlSeconds,
    });

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'cache-control': 'no-store', ...headers });
    res.end(body);
  };
  const json = (res, status, body, headers = {}) => send(res, status, JSON.stringify(body), { 'content-type': 'application/json', ...headers });

  const consent = (url, res) => {
    const q = url.searchParams;
    const redirect = q.get('redirect_uri');
    if (q.get('response_type') !== 'code' || !redirect || !knownClient(q.get('client_id') ?? '') || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) {
      return send(res, 400, 'Error 400: invalid_request', { 'content-type': 'text/plain' });
    }
    const back = new URL(redirect);
    back.searchParams.set('state', q.get('state') ?? '');
    if (q.get('deny') === '1') {
      back.searchParams.set('error', 'access_denied');
      return send(res, 302, '', { location: back.toString() });
    }
    const account = accounts.find((a) => a.email === q.get('login_hint'));
    if (!account) {
      const pick = (params) => `?${new URLSearchParams([...q.entries(), ...Object.entries(params)]).toString()}`;
      const rows = accounts.map((a) => `<li><a href="${escape(pick({ login_hint: a.email }))}">${escape(a.name)}<br><small>${escape(a.email)}</small></a></li>`).join('');
      return send(
        res,
        200,
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in - Google Accounts (fake)</title>
<style>:root{color-scheme:light dark}body{font:15px/1.4 system-ui,sans-serif;max-width:26rem;margin:10vh auto;padding:0 16px}li{list-style:none;margin:8px 0}a{display:block;padding:10px 12px;border:1px solid #8884;border-radius:10px;text-decoration:none;color:inherit}</style>
<h1>Choose an account</h1><p>Fake Google for Omni's tests. Nothing here talks to Google.</p><ul>${rows}<li><a href="${escape(pick({ deny: '1' }))}">Cancel</a></li></ul>`,
        { 'content-type': 'text/html; charset=utf-8' },
      );
    }
    const code = `fake-code-${randomBytes(12).toString('base64url')}`;
    codes.set(code, { clientId: q.get('client_id'), redirectUri: redirect, challenge: q.get('code_challenge'), nonce: q.get('nonce'), account, used: false });
    back.searchParams.set('code', code);
    return send(res, 302, '', { location: back.toString() });
  };

  const exchange = async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const f = new URLSearchParams(raw);
    const grant = codes.get(f.get('code') ?? '');
    const bad = (description) => json(res, 400, { error: 'invalid_grant', error_description: description });
    if (f.get('grant_type') !== 'authorization_code') return json(res, 400, { error: 'unsupported_grant_type' });
    if (!grant || grant.used) return bad('Malformed auth code.');
    grant.used = true;
    if (f.get('client_id') !== grant.clientId) return json(res, 401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });
    const secret = clients[grant.clientId];
    if (secret && f.get('client_secret') !== secret) return json(res, 401, { error: 'invalid_client', error_description: 'Unauthorized' });
    if (f.get('redirect_uri') !== grant.redirectUri) return json(res, 400, { error: 'redirect_uri_mismatch', error_description: 'Bad Request' });
    const verifier = f.get('code_verifier') ?? '';
    if (createHash('sha256').update(verifier).digest('base64url') !== grant.challenge) return bad('Invalid code verifier.');
    return json(res, 200, {
      access_token: `fake-access-${randomBytes(8).toString('hex')}`,
      expires_in: 3599,
      token_type: 'Bearer',
      scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
      id_token: idTokenFor(grant.account, grant.clientId, grant.nonce),
    });
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake-google');
    if (req.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') return consent(url, res);
    if (req.method === 'POST' && url.pathname === '/token') return void exchange(req, res);
    if (req.method === 'GET' && url.pathname === '/oauth2/v3/certs') return json(res, 200, { keys: [jwk] }, { 'cache-control': 'public, max-age=3600' });
    return json(res, 404, { error: 'not_found' });
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const base = `http://${host}:${server.address().port}`;
  return {
    url: base,
    endpoints: { auth: `${base}/o/oauth2/v2/auth`, token: `${base}/token`, jwks: `${base}/oauth2/v3/certs` },
    accounts,
    /** An ID token for `account`, as the token endpoint would sign it. Tests tamper with it to check the verifier. */
    idTokenFor,
    signIdToken,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const at = process.argv.indexOf('--port');
  const fake = await startFakeGoogle({ port: at > 0 ? Number(process.argv[at + 1]) : 0 });
  console.log(JSON.stringify({ url: fake.url, ...fake.endpoints }));
}
