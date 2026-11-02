// GET /api/capabilities: what this server offers a client and how the request got in. A native app reads it after
// pairing to learn what to turn on. Add a field when a client needs to know before it tries.
import { Hono } from 'hono';
import { PAIRING_TTL_MS } from './app-pairing.ts';
import { pushDelivery } from './push-sender.ts';

export const capabilitiesApi = new Hono();

capabilitiesApi.get('/', (c) => {
  const auth = c.get('omniAuth');
  const session = auth?.via === 'session' ? auth : null;
  return c.json({
    api: 1,
    auth: { via: auth?.via === 'session' ? 'session' : 'token', method: session?.method ?? null, sessionId: session?.session ?? null },
    pairing: { app: true, codeTtlSeconds: PAIRING_TTL_MS / 1000 },
    push: { registration: true, delivery: pushDelivery() },
    streams: { sse: true, closeOnRevoke: true },
  });
});
