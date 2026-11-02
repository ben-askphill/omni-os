// /api/auth: pairing a browser, Google sign-in for new devices, and the Mac app's check that the server on the port
// is this install's Omni. requestGuard has checked the token or a device session before any of these run, except
// GET /auth/proof, GET /auth/desktop-pair, the sign-in routes (SIGN_IN_ROUTES) and POST /auth/app-pairings/redeem.
// desktop-pair is the Linux app's window: a loopback GET with no proxy, and the token never appears in the URL.
// App pairing (app-pairing.ts) gives a native app its own revocable session; push-tokens.ts keeps its push token.
import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { apiToken, cookieName, proofFor, sessionCookieName } from './api-token.ts';
import { mintPairing, PairingError, redeemPairing } from './app-pairing.ts';
import { clerkConfig } from './clerk.ts';
import { connectMethod } from './connect/service.ts';
import {
  browserName,
  listSessions,
  owner,
  pollFlow,
  revokeSession,
  sessionIsLive,
  SignInError,
  startFlow,
  unlinkOwner,
  type FlowOutcome,
  type PollResult,
} from './google-auth.ts';
import { PushPreferencesBody, readPushPreferences, updatePushPreferences } from './push-preferences.ts';
import { deletePushToken, pushRegistration, PushTokenBody, setPushToken } from './push-tokens.ts';
import { clientKey, desktopPairAllowed, viaConnect } from './request-guard.ts';

export const authApi = new Hono();

/** 200 when the request carried the token: the Web UI asks this to decide whether to show the pairing screen. */
authApi.get('/', (c) => c.json({ ok: true }));

/**
 * Called with `Authorization: Bearer <token>`: hands the browser the token as an HttpOnly, SameSite=Strict cookie
 * on /api, so page scripts never hold it and EventSource and <img> requests carry it.
 */
const overHttps = (c: Context) => new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
const cookieOptions = (c: Context) => ({ path: '/api', httpOnly: true, sameSite: 'Strict' as const, secure: overHttps(c), maxAge: 400 * 24 * 3600 });

function pairCookie(c: Context) {
  setCookie(c, cookieName(), apiToken(), cookieOptions(c));
}

/** Only a request that carries the install's token trades it for the cookie: a device session must never turn into the token it was issued instead of. */
const tokenOnlyCookie = (c: Context) =>
  c.get('omniAuth')?.via === 'token' ? null : c.json({ error: "Forbidden: only the install's token can pair a browser" }, 403);

authApi.post('/pair', (c) => {
  const refused = tokenOnlyCookie(c);
  if (refused) return refused;
  pairCookie(c);
  return c.json({ ok: true });
});

/** The Linux app's first navigation. Sets the same cookie as /pair, then sends the window to the Web UI. */
authApi.get('/desktop-pair', (c) => {
  if (!desktopPairAllowed(c)) return c.json({ error: 'Forbidden: desktop pairing is only from this machine' }, 403);
  pairCookie(c);
  return c.redirect('/');
});

/** HMAC-SHA256 of `omni-proof:<port>:<nonce>` keyed with the token: proves this server, on this port, holds it, without revealing it. */
authApi.get('/proof', (c) => {
  const nonce = c.req.query('nonce') ?? '';
  if (!/^[0-9a-f]{32,128}$/i.test(nonce)) return c.json({ error: 'nonce: 32 to 128 hex characters' }, 400);
  return c.json({ proof: proofFor(nonce) });
});

// ---------- Google sign-in ----------

const signInError = (c: Context, err: unknown) => {
  if (err instanceof SignInError) return c.json({ error: err.message }, err.status);
  throw err;
};

/** Linking and unlinking the owner take the install's token: a device that signed in cannot hand the install to another account. */
const tokenOnly = (c: Context) =>
  c.get('omniAuth')?.via === 'token' ? null : c.json({ error: 'Forbidden: only a device paired with the token can change the linked Google account' }, 403);

/**
 * Open: whether the pairing screen offers Google sign-in, and, on this machine's Connect hostname only, Omni Connect
 * (the relay, this machine's id and hostname). Says nothing about who the owner is.
 */
authApi.get('/methods', async (c) =>
  c.json({ google: !!clerkConfig() && !!owner(), connect: viaConnect(URL.parse(`http://${c.req.header('host') ?? ''}`)?.hostname ?? '') ? await connectMethod() : null }),
);

/** The linked account, if any, and how this request got in. */
const sessionOf = (c: Context) => {
  const auth = c.get('omniAuth');
  return auth?.via === 'session' ? auth : null;
};

authApi.get('/account', (c) => {
  const o = owner();
  const config = clerkConfig();
  return c.json({
    available: !!config,
    issuer: config?.issuer ?? null,
    owner: o && { email: o.email, name: o.name, linkedAt: o.linkedAt },
    via: c.get('omniAuth')?.via ?? 'none',
    sessionMethod: sessionOf(c)?.method ?? null,
  });
});

const StartBody = z.object({ client: z.enum(['browser', 'app']).default('browser'), name: z.string().trim().max(100).optional() }).prefault({});

/** Open: starts a device's sign-in as the owner. A browser gets a cookie when it is done; an app gets a token. */
authApi.post('/google/start', async (c) => {
  const body = StartBody.parse(await c.req.json().catch(() => ({})));
  const name = body.name || (body.client === 'browser' ? browserName(c.req.header('user-agent')) : 'App');
  try {
    return c.json(await startFlow('device', { name, kind: body.client }));
  } catch (err) {
    return signInError(c, err);
  }
});

/** Starts linking the Google account that signs in as this install's owner. */
authApi.post('/google/link', async (c) => {
  const refused = tokenOnly(c);
  if (refused) return refused;
  try {
    return c.json(await startFlow('link', { name: browserName(c.req.header('user-agent')), kind: 'browser' }));
  } catch (err) {
    return signInError(c, err);
  }
});

const PollBody = z.object({ flow: z.string().min(1).max(100), secret: z.string().min(1).max(200) });

/** What a poll answers. A signed-in browser gets its session as a cookie and never sees the token; an app gets the token. */
function pollAnswer(c: Context, r: PollResult) {
  if (r.state === 'signed_in') {
    if (r.kind === 'browser') {
      setCookie(c, sessionCookieName(), r.session.token, cookieOptions(c));
      return c.json({ state: r.state });
    }
    return c.json({ state: r.state, token: r.session.token });
  }
  if (r.state === 'linked') return c.json({ state: r.state, owner: { email: r.owner.email, name: r.owner.name, linkedAt: r.owner.linkedAt } });
  return c.json(r satisfies Exclude<FlowOutcome, { state: 'signed_in' | 'linked' }> | { state: 'pending' });
}

/** Open, but only the client that started the flow holds its secret. */
authApi.post('/google/poll', async (c) => {
  const body = PollBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Send {flow, secret}' }, 400);
  try {
    return pollAnswer(c, await pollFlow(body.data.flow, body.data.secret));
  } catch (err) {
    return signInError(c, err);
  }
});

/** Unlinks the owner and ends every device's session. */
authApi.delete('/google', (c) => {
  const refused = tokenOnly(c);
  if (refused) return refused;
  unlinkOwner();
  return c.json({ ok: true });
});

/** The devices signed in with Google, most recently used first. `current` marks the one asking. */
authApi.get('/devices', (c) => {
  const auth = c.get('omniAuth');
  const current = auth?.via === 'session' ? auth.session : null;
  return c.json({ devices: listSessions().map((d) => ({ ...d, current: d.id === current })) });
});

/** A paired app may end its own session. Ending another device's takes the token or a Google session. */
authApi.delete('/devices/:id', (c) => {
  const id = c.req.param('id');
  const session = sessionOf(c);
  if (session?.method === 'pairing' && session.session !== id) return c.json({ error: 'Forbidden: a paired app can only sign itself out' }, 403);
  return revokeSession(id) ? c.json({ ok: true }) : c.json({ error: 'No such device' }, 404);
});

/** Signs this device out: ends its own session and drops the cookie. */
authApi.post('/signout', (c) => {
  const auth = c.get('omniAuth');
  if (auth?.via === 'session') revokeSession(auth.session);
  deleteCookie(c, sessionCookieName(), { path: '/api' });
  return c.json({ ok: true });
});

// ---------- app pairing ----------

const firstIssue = (err: z.ZodError) => err.issues[0]?.message ?? 'Invalid request';

const pairingError = (c: Context, err: unknown) => {
  if (!(err instanceof PairingError)) throw err;
  if (err.retryAfter) c.header('Retry-After', String(err.retryAfter));
  return c.json({ error: err.message }, err.status);
};

const MintBody = z.object({}).prefault({});
const RedeemBody = z.object({
  code: z.string().min(1, 'code is required').max(200, 'code is too long'),
  name: z
    .string()
    .trim()
    .min(1, 'name is required')
    .max(100, 'name is at most 100 characters')
    .regex(/^[^\u0000-\u001f\u007f]+$/, 'name has control characters'),
});

/**
 * A one-time code for pairing a native app: 5 minutes, single use. Only a device holding the install's token may mint
 * one. A session (an app's, or a Google sign-in's) could otherwise mint a replacement that outlives its own revoke
 * or the Google account being unlinked.
 */
authApi.post('/app-pairings', async (c) => {
  if (c.get('omniAuth')?.via !== 'token') return c.json({ error: "Forbidden: only a device holding the install's token can pair an app" }, 403);
  if (!MintBody.safeParse(await c.req.json().catch(() => ({}))).success) return c.json({ error: 'Send {} or no body' }, 400);
  try {
    return c.json(mintPairing());
  } catch (err) {
    return pairingError(c, err);
  }
});

/** Open: the app spends its code for a session token. The install's token is never in the answer. */
authApi.post('/app-pairings/redeem', async (c) => {
  const body = RedeemBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: firstIssue(body.error) }, 400);
  try {
    return c.json(redeemPairing(body.data.code, body.data.name, clientKey(c)));
  } catch (err) {
    return pairingError(c, err);
  }
});

// ---------- push token ----------

/** The app session making the request, or the refusal for anyone else: a push token belongs to one app install's session. */
function appSession(c: Context) {
  const session = sessionOf(c);
  return session?.kind === 'app' ? { session: session.session } : { refused: c.json({ error: 'Forbidden: a push token belongs to an app session. Pair the app first' }, 403) };
}

authApi.put('/push-token', async (c) => {
  const who = appSession(c);
  if (who.refused) return who.refused;
  const body = PushTokenBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: firstIssue(body.error) }, 400);
  // The session may have ended while the body was read, after the guard checked it. Nothing awaits between this and the write.
  if (!sessionIsLive(who.session) || !setPushToken(who.session, body.data)) return c.json({ error: 'Unauthorized: this session has ended' }, 401);
  return c.json({ ok: true });
});

/** What is registered for this session. The token is not echoed. */
authApi.get('/push-token', (c) => {
  const who = appSession(c);
  if (who.refused) return who.refused;
  const r = pushRegistration(who.session);
  return c.json(r ? { registered: true, ...r } : { registered: false });
});

authApi.delete('/push-token', (c) => {
  const who = appSession(c);
  if (who.refused) return who.refused;
  deletePushToken(who.session);
  return c.json({ ok: true });
});

// ---------- push preferences ----------

/** Which alerts this device gets. Every kind is on until the device turns one off. */
authApi.get('/push-preferences', (c) => {
  const who = appSession(c);
  if (who.refused) return who.refused;
  return c.json(readPushPreferences(who.session));
});

/** Turn kinds on or off. Sends only the kinds that change; the response is the full set. */
authApi.put('/push-preferences', async (c) => {
  const who = appSession(c);
  if (who.refused) return who.refused;
  const body = PushPreferencesBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: firstIssue(body.error) }, 400);
  const next = updatePushPreferences(who.session, body.data);
  if (!next) return c.json({ error: 'Unauthorized: this session has ended' }, 401);
  return c.json(next);
});
