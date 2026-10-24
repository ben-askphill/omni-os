// /api/auth: pairing a browser with the install token, signing in with Google (apps/server/sign-in.ts), and the Mac
// app's check that the server on the port is this install's Omni. requestGuard has checked the token or session before
// any of these run, except the routes it leaves open (GET /proof, GET /google, POST /google/start and /google/finish),
// and Google's redirect back, which app.ts routes ahead of the guard to `googleCallback`.
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { apiToken, cookieName, proofFor, sessionCookieName } from './api-token.ts';
import { config } from './config.ts';
import { auth } from './db.ts';
import { SignInError } from './google.ts';
import { hostAndOwner, hostnameOf, isHttps, requestHost, setSessionCookie } from './request-guard.ts';
import { allowlist, availability, configured, finishSignIn, pending, receiveCallback, startSignIn } from './sign-in.ts';

export const authApi = new Hono();

/** Ties a sign-in to the browser that started it. Lax, so Google's redirect back (a top-level GET) carries it. */
const bindingCookie = () => `omni_signin_${config.port}`;
const BINDING_PATH = '/api/auth/google';

const hostname = (c: Context) => hostnameOf(requestHost(c));
const origin = (c: Context) => `${isHttps(c) ? 'https' : 'http'}://${requestHost(c)}`;

const failed = (c: Context, err: unknown) => {
  if (err instanceof SignInError) return c.json({ error: err.message }, err.status);
  throw err;
};

/**
 * 200 when the request carried the token or a live session: the Web UI asks this to decide whether to show the pairing
 * screen, and Settings shows who is signed in and who may sign in.
 */
authApi.get('/', (c) => {
  const access = c.get('access')!;
  const session = access.via === 'session' ? access.session : null;
  return c.json({
    ok: true,
    via: access.via,
    user: session ? { email: session.user.email, name: session.user.name } : null,
    device: session ? session.device : null,
    google: { loopback: configured('loopback'), broker: configured('broker'), allowedEmails: allowlist().emails, allowedHd: allowlist().hd },
  });
});

/**
 * Called with `Authorization: Bearer <token>`: hands the browser the token as an HttpOnly, SameSite=Strict cookie
 * on /api, so page scripts never hold it and EventSource and <img> requests carry it. Never for a session: a signed-in
 * browser would keep the token after its session was revoked.
 */
authApi.post('/pair', (c) => {
  if (c.get('access')?.via !== 'token') return c.json({ error: "Pair with this install's token." }, 403);
  setCookie(c, cookieName(), apiToken(), { path: '/api', httpOnly: true, sameSite: 'Strict', secure: isHttps(c), maxAge: 400 * 24 * 3600 });
  return c.json({ ok: true });
});

/** Signs this browser or Mac out: its session's device is revoked, and the browser loses both cookies. */
authApi.post('/signout', (c) => {
  const access = c.get('access')!;
  if (access.via === 'session') auth.revokeDevice(access.session.device.id);
  deleteCookie(c, sessionCookieName(), { path: '/api' });
  deleteCookie(c, cookieName(), { path: '/api' });
  return c.json({ ok: true });
});

/**
 * Settings > Devices: every browser and Mac signed in with Google that can still get in, most recently seen first,
 * with the one asking marked `current`. The install token is not a device.
 */
authApi.get('/devices', (c) => {
  const access = c.get('access')!;
  const current = access.via === 'session' ? access.session.device.id : null;
  return c.json(
    auth.devices().map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      email: d.email,
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      expiresAt: d.expires_at,
      current: d.id === current,
    })),
  );
});

/** Revokes one device: its session stops working at once. Revoking the browser that asks signs it out as well. */
authApi.delete('/devices/:id', (c) => {
  const access = c.get('access')!;
  if (!auth.revokeDevice(c.req.param('id'))) return c.json({ error: 'No such signed-in device.' }, 404);
  const current = access.via === 'session' && access.session.device.id === c.req.param('id');
  if (current) deleteCookie(c, sessionCookieName(), { path: '/api' });
  return c.json({ ok: true, current });
});

/** HMAC-SHA256 of `omni-proof:<port>:<nonce>` keyed with the token: proves this server, on this port, holds it, without revealing it. */
authApi.get('/proof', (c) => {
  const nonce = c.req.query('nonce') ?? '';
  if (!/^[0-9a-f]{32,128}$/i.test(nonce)) return c.json({ error: 'nonce: 32 to 128 hex characters' }, 400);
  return c.json({ proof: proofFor(nonce) });
});

/** Open: whether a browser here can sign in with Google, so the pairing screen knows whether to offer it. */
authApi.get('/google', (c) => c.json(availability(hostname(c), c.get('access')?.via === 'token')));

const startInput = z.object({ client: z.enum(['web', 'mac']).default('web'), deviceName: z.string().trim().max(80).optional() });

/** Open: a new sign-in and the Google URL to open. The Mac app gets a claim secret; a browser, the binding cookie. */
authApi.post('/google/start', async (c) => {
  const parsed = startInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Send {"client":"web"} or {"client":"mac"}.' }, 400);
  try {
    const started = await startSignIn({
      client: parsed.data.client,
      deviceName: parsed.data.deviceName,
      userAgent: c.req.header('user-agent') ?? '',
      origin: origin(c),
      hostname: hostname(c),
      trusted: c.get('access')?.via === 'token',
    });
    const { secret, ...rest } = started;
    if (parsed.data.client === 'mac') return c.json({ ...rest, claim: secret });
    setCookie(c, bindingCookie(), secret, { path: BINDING_PATH, httpOnly: true, sameSite: 'Lax', secure: isHttps(c), maxAge: 600 });
    return c.json(rest);
  } catch (err) {
    return failed(c, err);
  }
});

const finishInput = z.object({ attempt: z.string().min(1).max(100), claim: z.string().max(200).optional() });

/**
 * Open: finishes a sign-in for the client that started it. 202 while Google has not sent the browser back. A browser
 * gets the session cookie and loses the token cookie, so revoking it signs it out, and a session it held before is
 * revoked, so no device is left behind that nobody holds. The Mac app gets its credential.
 */
authApi.post('/google/finish', async (c) => {
  const parsed = finishInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Send {"attempt": "..."}.' }, 400);
  const mac = parsed.data.claim !== undefined;
  const access = c.get('access');
  if (mac && access?.via !== 'token') return c.json({ error: 'The Mac app finishes signing in with the install token.' }, 403);
  try {
    const done = await finishSignIn(parsed.data.attempt, mac ? { client: 'mac', secret: parsed.data.claim } : { client: 'web', secret: getCookie(c, bindingCookie()) });
    if (!done) return c.json({ pending: true }, 202);
    const body = { ok: true, user: done.user, device: { id: done.device.id, name: done.device.name, kind: done.device.kind }, claimed: done.claimed };
    if (mac) return c.json({ ...body, credential: done.credential, expiresAt: done.expiresAt });
    if (access?.via === 'session') auth.revokeDevice(access.session.device.id);
    deleteCookie(c, bindingCookie(), { path: BINDING_PATH });
    deleteCookie(c, cookieName(), { path: '/api' });
    setSessionCookie(c, done.credential, done.expiresAt);
    return c.json(body);
  } catch (err) {
    if (!mac && !pending(parsed.data.attempt)) deleteCookie(c, bindingCookie(), { path: BINDING_PATH });
    return failed(c, err);
  }
});

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const page = (message: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Omni sign-in</title><style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;max-width:28rem;margin:20vh auto;padding:0 16px}</style>
<p>${escape(message)}</p><p><a href="/">Back to Omni</a></p>`;

/**
 * GET /api/auth/google/callback: Google sends the browser back here on a loopback Host, and the broker does from
 * anywhere else. It comes from another site by design, so it skips requestGuard's cross-site and token checks, and has
 * only what proves the sign-in: the attempt's state, the browser's binding cookie (or the Mac app's claim, later), one
 * use, ten minutes. The Host and Tailscale owner checks still apply.
 */
export const googleCallback = (c: Context) => {
  const refused = hostAndOwner(c);
  if (refused) return refused;
  c.header('cache-control', 'no-store');
  c.header('referrer-policy', 'no-referrer');
  try {
    return c.redirect(receiveCallback(c.req.query(), getCookie(c, bindingCookie())), 302);
  } catch (err) {
    if (err instanceof SignInError) return c.html(page(err.message), err.status);
    throw err;
  }
};
