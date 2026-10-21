import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { hostAllowed, requestGuard } from '../request-guard.ts';

// requestGuard in front of /api: what a cross-site page or a DNS-rebinding domain sends is refused,
// what the Web UI (same origin, or through vite), the Mac app, the MCP and curl send gets through.

const app = new Hono();
app.use('*', requestGuard);
app.all('*', (c) => c.json({ ok: true }));

const send = (headers: Record<string, string>, init: RequestInit = {}) =>
  app.request('http://127.0.0.1:4747/api/threads', { method: 'POST', body: '{"prompt":"x"}', ...init, headers: { host: '127.0.0.1:4747', ...headers } });

describe('requestGuard', () => {
  it('lets the Mac app, the MCP and curl through: JSON, no Origin', async () => {
    expect((await send({ 'content-type': 'application/json' })).status).toBe(200);
    expect((await send({}, { method: 'GET', body: undefined })).status).toBe(200);
  });

  it('lets the Web UI through on its own origin, through vite and through tailscale serve', async () => {
    const same = { origin: 'http://127.0.0.1:4747', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
    expect((await send(same)).status).toBe(200);
    expect((await send({ ...same, host: 'localhost:4748', origin: 'http://localhost:4748' })).status).toBe(200);
    expect((await send({ ...same, host: 'bens-mac.tail1234.ts.net', origin: 'https://bens-mac.tail1234.ts.net' })).status).toBe(200);
    const multipart = { ...same, 'content-type': 'multipart/form-data; boundary=x' };
    expect((await send(multipart, { body: '--x--' })).status).toBe(200);
  });

  it('refuses the no-cors text/plain POST from the report', async () => {
    const res = await send({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain;charset=UTF-8' });
    expect(res.status).toBe(403);
  });

  it('refuses a foreign Origin even without Sec-Fetch-Site (older Safari, Firefox)', async () => {
    expect((await send({ origin: 'https://evil.example', 'content-type': 'application/json' })).status).toBe(403);
    expect((await send({ origin: 'null', 'content-type': 'application/json' })).status).toBe(403);
    // Another local server on a different port is another origin.
    expect((await send({ origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' })).status).toBe(403);
  });

  it('refuses a cross-site form post without an Origin header', async () => {
    const res = await send({ 'sec-fetch-site': 'cross-site', 'content-type': 'multipart/form-data; boundary=x' }, { body: '--x--' });
    expect(res.status).toBe(403);
  });

  it('refuses text/plain and form-urlencoded bodies from any client', async () => {
    expect((await send({ 'content-type': 'text/plain' })).status).toBe(415);
    expect((await send({ 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
  });

  it('refuses a DNS-rebinding Host, reads included', async () => {
    const rebound = { host: 'rebind.evil.example:4747', origin: 'http://rebind.evil.example:4747', 'sec-fetch-site': 'same-origin' };
    expect((await send(rebound, { method: 'GET', body: undefined })).status).toBe(403);
    expect((await send({ ...rebound, 'content-type': 'application/json' })).status).toBe(403);
  });

  it('does not take X-Forwarded-Host for a host outside the allowlist', async () => {
    const res = await send({ origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'content-type': 'application/json' });
    expect(res.status).toBe(403);
  });
});

describe('hostAllowed', () => {
  it('takes loopback, the tailnet and the extras', () => {
    for (const h of ['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1', 'bens-mac.tail1234.ts.net', 'bens-mac.tail1234.ts.net.', '100.64.0.1', '100.127.255.255']) {
      expect(hostAllowed(h, []), h).toBe(true);
    }
    expect(hostAllowed('omni.lan', ['omni.lan'])).toBe(true);
  });

  it('refuses everything else', () => {
    for (const h of ['', 'evil.example', 'ts.net.evil.example', 'localhost.evil.example', '100.128.0.1', '100.63.0.1', '192.168.1.20', '0.0.0.0']) {
      expect(hostAllowed(h, []), h).toBe(false);
    }
  });
});
