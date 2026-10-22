// /api/auth: pairing a browser, and the Mac app's check that the server on the port is this install's Omni.
// requestGuard has checked the token before any of these run, except GET /auth/proof, which never sees it.
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { apiToken, cookieName, proofFor } from './api-token.ts';

export const authApi = new Hono();

/** 200 when the request carried the token: the Web UI asks this to decide whether to show the pairing screen. */
authApi.get('/', (c) => c.json({ ok: true }));

/**
 * Called with `Authorization: Bearer <token>`: hands the browser the token as an HttpOnly, SameSite=Strict cookie
 * on /api, so page scripts never hold it and EventSource and <img> requests carry it.
 */
authApi.post('/pair', (c) => {
  const https = new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
  setCookie(c, cookieName(), apiToken(), { path: '/api', httpOnly: true, sameSite: 'Strict', secure: https, maxAge: 400 * 24 * 3600 });
  return c.json({ ok: true });
});

/** HMAC-SHA256 of `omni-proof:<nonce>` keyed with the token. Proves the server holds the token without revealing it. */
authApi.get('/proof', (c) => {
  const nonce = c.req.query('nonce') ?? '';
  if (!/^[0-9a-f]{32,128}$/i.test(nonce)) return c.json({ error: 'nonce: 32 to 128 hex characters' }, 400);
  return c.json({ proof: proofFor(nonce) });
});
