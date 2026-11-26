import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { OmniMcp } from './omni-mcp.ts';

// The Conductor's rerun_failed_checks tool (apps/mcp/omni.ts, #684), started the way a harness starts the omni server,
// against a fake API that records each request and answers with canned bodies.
const seen: { method: string; url: string; body: any }[] = [];

const channels = [
  { id: 'shop', name: 'Shop', github_repo: 'acme/shop', folders: [] },
  { id: 'notes', name: 'Notes', github_repo: null, folders: [] },
];

function answer(method: string, url: string): [number, unknown] {
  if (method === 'GET' && url === '/api/channels') return [200, channels];
  if (method === 'POST' && url === '/api/channels/shop/prs/12/rerun-failed') return [200, { runs: [{ id: '200', ok: true }], skipped: 1 }];
  if (method === 'POST' && url === '/api/channels/shop/prs/7/rerun-failed') return [409, { error: 'No checks are failing.' }];
  return [404, { error: `no fake for ${method} ${url}` }];
}

let api: Server;
let omni: OmniMcp;

const tool = async (args: Record<string, unknown>) => {
  seen.length = 0;
  const r = (await omni.request('tools/call', { name: 'rerun_failed_checks', arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const raw = r.content[0].text;
  let body: any = raw;
  try {
    body = JSON.parse(raw);
  } catch {}
  return { isError: !!r.isError, body, requests: seen.map((s) => `${s.method} ${s.url}`) };
};

beforeAll(async () => {
  api = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, body: data ? JSON.parse(data) : undefined });
      const [status, body] = answer(req.method!, req.url!);
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  omni = await OmniMcp.start({ PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: base, OMNI_TOKEN: 'test-token', OMNI_USER: 'Ben' });
  await omni.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
}, 30_000);

afterAll(() => {
  omni?.close();
  api?.close();
});

describe('rerun_failed_checks', () => {
  it("finds the channel by its repo and answers each run's outcome", async () => {
    const r = await tool({ repo: 'Acme/Shop', number: 12 });
    expect(r.isError).toBe(false);
    expect(r.body).toEqual({ runs: [{ id: '200', ok: true }], skipped: 1 });
    expect(r.requests).toEqual(['GET /api/channels', 'POST /api/channels/shop/prs/12/rerun-failed']);
  });

  it('takes a channel id without listing channels', async () => {
    const r = await tool({ channel: 'shop', number: 12 });
    expect(r.requests).toEqual(['POST /api/channels/shop/prs/12/rerun-failed']);
  });

  it('answers a refusal with why, not an error', async () => {
    const r = await tool({ channel: 'shop', number: 7 });
    expect(r.isError).toBe(false);
    expect(r.body).toEqual({ done: false, why: 'No checks are failing.' });
  });

  it('names the repos it knows when none matches, and needs repo or channel', async () => {
    const r = await tool({ repo: 'acme/blog', number: 3 });
    expect(r.isError).toBe(true);
    expect(r.body).toContain('No channel has acme/blog as its GitHub repo. Channels with a repo: acme/shop.');
    const none = await tool({ number: 3 });
    expect(none.isError).toBe(true);
    expect(none.body).toContain('Pass repo (owner/name) or channel.');
    expect(none.requests).toEqual([]);
  });
});
