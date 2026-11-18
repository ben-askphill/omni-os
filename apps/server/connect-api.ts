// /api/connect: Omni Connect (apps/server/connect/service.ts, docs/adr/0009-omni-connect.md). Settings turns it on
// and off and lists the machines. mint and health are the relay's signed requests, and redeem is a browser trading a
// one-time code: those three take no token (CONNECT_OPEN_ROUTES in request-guard.ts) and prove themselves instead.
import { Hono, type Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { sessionCookieName } from './api-token.ts';
import { browserName, setCookiePath } from './google-auth.ts';
import { answerHealth, answerMint, ConnectError, connectMachines, connectStatus, disableConnect, enableConnect, redeemCode } from './connect/service.ts';

export const connectApi = new Hono();

const failed = (c: Context, err: unknown) => {
  if (err instanceof ConnectError) return c.json({ error: err.message }, err.status);
  throw err;
};

const run = (fn: (c: Context) => Promise<Response>) => async (c: Context) => {
  try {
    return await fn(c);
  } catch (err) {
    return failed(c, err);
  }
};

connectApi.get('/', run(async (c) => c.json(await connectStatus())));
connectApi.post('/enable', run(async (c) => c.json(await enableConnect())));
connectApi.post('/disable', run(async (c) => c.json(await disableConnect())));
connectApi.get('/machines', run(async (c) => c.json({ machines: await connectMachines() })));

const requestBody = async (c: Context) => ((await c.req.json().catch(() => null)) as { request?: unknown } | null)?.request;

connectApi.post('/mint', run(async (c) => c.json({ response: await answerMint(await requestBody(c)) })));
connectApi.post('/health', run(async (c) => c.json({ response: await answerHealth(await requestBody(c)) })));

/**
 * A browser's code and proof become a session cookie, like the last poll of a Google sign-in. Omni Connect is HTTPS,
 * so the cookie is Secure and stays on /api (browser-session.ts).
 */
connectApi.post(
  '/redeem',
  run(async (c) => {
    const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
    const session = redeemCode(body?.code, c.req.header('dpop'), `${browserName(c.req.header('user-agent'))} via Omni Connect`);
    setCookiePath(session.id, '/api');
    setCookie(c, sessionCookieName(), session.token, { path: '/api', httpOnly: true, sameSite: 'Strict', secure: true, maxAge: 400 * 24 * 3600 });
    return c.json({ ok: true, api: '/api' });
  }),
);
