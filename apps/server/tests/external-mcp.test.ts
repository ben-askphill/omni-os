import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { FAKE_ISSUER, FAKE_PUBLISHABLE_KEY, fakeClerk } from './fake-clerk.ts';
import { startRunner } from './runner-boot.ts';

// The external Omni MCP server (apps/mcp/external/) as clients outside Omni reach it: /mcp over Streamable HTTP with
// the MCP token in the URL or a header, and the stdio entry started with plain `node`, both against the real API.

const MCP_TOKEN = 'mcp-test-token-0123456789abcdef0123456789abcd';
process.env.OMNI_MCP_TOKEN = MCP_TOKEN;
const API_TOKEN = process.env.OMNI_TOKEN!;

const h = await startRunner();
const { app } = await import('../app.ts');
const { ROOT } = await import('../config.ts');
const { serve } = await import('@hono/node-server');
const { linkOwner, unlinkOwner } = await import('../google-auth.ts');
const { setOAuthFetch } = await import('../mcp-oauth.ts');
const T = { timeout: 30_000 };

const make = (title: string, status = 'done') =>
  h.db.threads.create({ id: randomUUID(), channel_id: 'scratch', title, status, role: null, model: null, session_id: randomUUID(), cwd: h.paths.data, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null } as any);

let rpcId = 0;
/** One JSON-RPC request to /mcp. `headers` replaces the API token tests/setup.ts would add; '' sends none. */
const post = (path: string, method: string, params: unknown = {}, headers: Record<string, string> = {}) =>
  app.request(`http://127.0.0.1:4747${path}`, {
    method: 'POST',
    headers: { host: '127.0.0.1:4747', 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: '', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });

const tool = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await post(`/mcp/${MCP_TOKEN}`, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  const { result } = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  const raw = result.content[0].text;
  return { isError: !!result.isError, raw, body: result.isError ? null : JSON.parse(raw) };
};

describe('/mcp: who gets in', () => {
  const init = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } };

  it('takes the MCP token in the URL or as a Bearer header, and the API token only as a header', async () => {
    expect((await post(`/mcp/${MCP_TOKEN}`, 'initialize', init)).status).toBe(200);
    expect((await post('/mcp', 'initialize', init, { authorization: `Bearer ${MCP_TOKEN}` })).status).toBe(200);
    expect((await post('/mcp', 'initialize', init, { authorization: `Bearer ${API_TOKEN}` })).status).toBe(200);
    expect((await post(`/mcp/${API_TOKEN}`, 'initialize', init)).status).toBe(401);
  });

  it('refuses no token or a wrong one with 401 and a Bearer challenge', async () => {
    const none = await post('/mcp', 'initialize', init);
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toBe('Bearer');
    expect((await post('/mcp/nope', 'initialize', init)).status).toBe(401);
    expect((await post('/mcp', 'initialize', init, { authorization: 'Bearer nope' })).status).toBe(401);
  });

  it('refuses a host outside the allowed names and a cross-site origin, token or not', async () => {
    expect((await post(`/mcp/${MCP_TOKEN}`, 'initialize', init, { host: 'evil.example' })).status).toBe(403);
    expect((await post(`/mcp/${MCP_TOKEN}`, 'initialize', init, { origin: 'https://evil.example' })).status).toBe(403);
    // tailscale serve keeps the MagicDNS name.
    expect((await post(`/mcp/${MCP_TOKEN}`, 'initialize', init, { host: 'mac.tail1234.ts.net', 'x-forwarded-for': '100.101.1.2' })).status).toBe(200);
  });

  it("takes the Cloudflare Tunnel's name once integrations.mcpPublicUrl names it, and /api still refuses it", async () => {
    const tunnel = { host: 'omni.example.com', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' };
    expect((await post(`/mcp/${MCP_TOKEN}`, 'initialize', init, tunnel)).status).toBe(403);
    process.env.OMNI_MCP_PUBLIC_URL = 'https://Omni.Example.com/';
    try {
      expect((await post(`/mcp/${MCP_TOKEN}`, 'initialize', init, tunnel)).status).toBe(200);
      expect((await post('/mcp', 'initialize', init, { ...tunnel, authorization: `Bearer ${MCP_TOKEN}` })).status).toBe(200);
      expect((await post(`/mcp/${MCP_TOKEN}`, 'initialize', init, { ...tunnel, host: 'other.example.com' })).status).toBe(403);
      // An ingress that forwards every path still opens nothing else: /api answers only to its own names.
      const api = await app.request('http://127.0.0.1:4747/api/threads', { headers: { ...tunnel, authorization: `Bearer ${API_TOKEN}` } });
      expect(api.status).toBe(403);
    } finally {
      delete process.env.OMNI_MCP_PUBLIC_URL;
    }
  });

  it('is stateless: GET and DELETE answer 405', async () => {
    const get = await app.request(`http://127.0.0.1:4747/mcp/${MCP_TOKEN}`, { headers: { host: '127.0.0.1:4747', accept: 'text/event-stream' } });
    expect(get.status).toBe(405);
  });
});

describe('/mcp: the tools', () => {
  it('lists the external tools and none of the Conductor-only ones', async () => {
    const res = await post(`/mcp/${MCP_TOKEN}`, 'tools/list');
    const { result } = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(result.tools.map((t) => t.name).sort()).toEqual(
      [
        'create_folder', 'delete_folder', 'get_thread', 'list_automations', 'list_channels', 'list_crew', 'list_folders', 'list_harnesses', 'list_pull_requests', 'list_threads', 'message_thread',
        'read_thread', 'rename_folder', 'run_automation', 'search_threads', 'set_automation_enabled', 'start_thread', 'stop_thread', 'switch_thread_run', 'update_thread',
      ].sort(),
    );
  });

  it('lists channels and threads through /api', T, async () => {
    const t = make('An external one');
    expect((await tool('list_channels')).body.map((c: any) => c.id)).toContain('scratch');
    expect((await tool('list_threads', { channel: 'scratch' })).body.map((x: any) => x.id)).toContain(t.id);
    expect((await tool('list_pull_requests')).body).toEqual({ prs: [], failed: [] });
  });

  it('reads a thread conversation a page at a time, and says not found for an unknown thread', T, async () => {
    const t = make('Talky');
    for (let i = 0; i < 60; i++) h.db.events.add(t.id, i % 2 ? 'assistant_text' : 'user', { text: `line ${i}` });
    const page = await tool('read_thread', { thread_id: t.id });
    expect(page.body.rows).toHaveLength(40);
    expect(page.body.rows.at(-1).text).toBe('line 59');
    const older = await tool('read_thread', { thread_id: t.id, before: page.body.older });
    expect(older.body.rows[0].text).toBe('line 0');
    expect(older.body.older).toBeNull();
    const missing = await tool('read_thread', { thread_id: randomUUID() });
    expect(missing).toMatchObject({ isError: true, raw: expect.stringContaining('not found') });
  });

  it('starts a thread and waits for its reply with get_thread', T, async () => {
    const started = await tool('start_thread', { channel: 'scratch', prompt: 'say hi', harness: 'claude-code' });
    expect(started.isError).toBe(false);
    const got = await tool('get_thread', { thread_id: started.body.id, wait_seconds: 20 });
    expect(got.body).toMatchObject({ id: started.body.id, still_working: false });
    expect(got.body.status).not.toMatch(/queued|running/);
  });

  it('renames, pins and marks a thread done, and refuses an empty update', T, async () => {
    const t = make('Finished', 'failed');
    const r = await tool('update_thread', { thread_id: t.id, title: 'Wrapped up', pinned: true, done: true });
    expect(r.body).toMatchObject({ id: t.id, title: 'Wrapped up', pinned: true });
    expect(h.db.threads.get(t.id)!.done_at).toBeTruthy();
    expect(await tool('update_thread', { thread_id: t.id })).toMatchObject({ isError: true, raw: expect.stringContaining('Nothing to change') });
  });

  it('creates, lists, renames and deletes folders, and files threads by folder name', T, async () => {
    const made = await tool('create_folder', { channel: 'scratch', name: 'Launch' });
    expect(made.body).toMatchObject({ name: 'Launch', channel: 'scratch', existing: false });
    // Again, in other case: the same folder back, not "Launch 2".
    expect((await tool('create_folder', { channel: 'scratch', name: 'launch' })).body).toMatchObject({ id: made.body.id, existing: true });

    const t = make('To file');
    // An unknown folder name is refused unless create_folder says to make it.
    expect(await tool('update_thread', { thread_id: t.id, folder: 'Later' })).toMatchObject({ isError: true, raw: expect.stringContaining('has no folder "Later"') });
    expect((await tool('update_thread', { thread_id: t.id, folder: '  LAUNCH ' })).body.folder_id).toBe(made.body.id);
    const later = await tool('update_thread', { thread_id: t.id, folder: 'Later', create_folder: true });
    expect(later.body.folder_id).not.toBe(made.body.id);

    const listed = await tool('list_folders', { channel: 'scratch' });
    expect(listed.body.find((f: any) => f.name === 'Later')).toMatchObject({ threads: 1, recent: ['To file'] });
    expect((await tool('rename_folder', { folder_id: made.body.id, name: 'Launch week' })).body.name).toBe('Launch week');

    const gone = await tool('delete_folder', { folder_id: later.body.folder_id });
    expect(gone.body).toMatchObject({ threads_moved_out: 1 });
    expect(h.db.threads.get(t.id)!.folder_id).toBeNull();
    expect((await tool('update_thread', { thread_id: t.id, folder: 'Launch week' })).body.folder_id).toBe(made.body.id);
    expect((await tool('update_thread', { thread_id: t.id, folder: '' })).body.folder_id).toBeNull();
  });

  it('lists automations', T, async () => {
    const r = await tool('list_automations');
    expect(r.isError).toBe(false);
    expect(Array.isArray(r.body)).toBe(true);
  });
});

/** Just enough of an MCP client over stdio (newline-delimited JSON-RPC). */
class StdioClient {
  private id = 0;
  private waiting = new Map<number, (r: any) => void>();
  constructor(private child: ChildProcess) {
    createInterface({ input: child.stdout! }).on('line', (line) => {
      const msg = JSON.parse(line);
      this.waiting.get(msg.id)?.(msg);
    });
  }
  request(method: string, params: unknown = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 20_000);
      this.waiting.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  close() {
    this.child.kill('SIGTERM');
  }
}

describe('stdio entry', () => {
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
  const clients: StdioClient[] = [];
  afterAll(() => {
    for (const c of clients) c.close();
    server.close();
    server.closeAllConnections();
  });

  const connect = async (env: Record<string, string>) => {
    if (!server.listening) await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    // Plain node, the way npm run mcp:config tells a client to start it: no tsx.
    const child = spawn(process.execPath, [join(ROOT, 'apps/mcp/external/stdio.ts')], {
      env: { PATH: process.env.PATH ?? '', OMNI_URL: `http://127.0.0.1:${port}`, ...env },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const client = new StdioClient(child);
    clients.push(client);
    await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    return client;
  };

  it('runs under plain node and calls the API with OMNI_TOKEN', T, async () => {
    const t = make('Seen over stdio');
    const client = await connect({ OMNI_TOKEN: API_TOKEN });
    const r = await client.request('tools/call', { name: 'list_threads', arguments: { channel: 'scratch', limit: 100 } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0].text).map((x: any) => x.id)).toContain(t.id);
  });

  it('answers a call with the API error when it has no usable token', T, async () => {
    const client = await connect({ OMNI_TOKEN_FILE: join(h.paths.data, 'no-such-token') });
    const r = await client.request('tools/call', { name: 'list_channels', arguments: {} });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Unauthorized/);
  });
});

describe('/mcp: Google sign-in through Clerk', () => {
  const clerk = fakeClerk();
  const OWNER = { sub: 'user_owner', email: 'ben@example.com', name: 'Ben' };
  const META = 'http://127.0.0.1:4747/.well-known/oauth-protected-resource/mcp';
  const get = (path: string, headers: Record<string, string> = {}) => app.request(`http://127.0.0.1:4747${path}`, { headers: { host: '127.0.0.1:4747', authorization: '', ...headers } });
  const listTools = (token: string, path = '/mcp') => post(path, 'tools/list', {}, { authorization: `Bearer ${token}` });
  const userinfoCalls = () => clerk.calls.filter((p) => p === '/oauth/userinfo').length;

  process.env.OMNI_CLERK_PUBLISHABLE_KEY = FAKE_PUBLISHABLE_KEY;
  setOAuthFetch(clerk.fetch as typeof fetch);
  afterAll(() => {
    unlinkOwner();
    setOAuthFetch();
    delete process.env.OMNI_CLERK_PUBLISHABLE_KEY;
  });

  it('is off until a Google account is linked: no metadata, and a plain Bearer challenge', async () => {
    unlinkOwner();
    expect((await get('/.well-known/oauth-protected-resource/mcp')).status).toBe(404);
    expect((await get('/.well-known/oauth-authorization-server')).status).toBe(404);
    const res = await post('/mcp', 'tools/list');
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    // An access token alone gets nothing while no owner is linked, and Clerk is not even asked.
    expect((await listTools(clerk.accessToken(OWNER))).status).toBe(401);
    expect(userinfoCalls()).toBe(0);
  });

  it('publishes the protected resource metadata, naming Clerk, at the root and under /mcp', async () => {
    linkOwner({ issuer: FAKE_ISSUER, ...OWNER });
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(await res.json()).toEqual({
        resource: 'http://127.0.0.1:4747/mcp',
        authorization_servers: [FAKE_ISSUER],
        scopes_supported: ['openid', 'profile', 'email'],
        bearer_methods_supported: ['header'],
        resource_name: 'Omni',
      });
    }
    // Through a Cloudflare Tunnel: the https public address the client used.
    process.env.OMNI_MCP_PUBLIC_URL = 'https://omni.example.com';
    try {
      const tunnel = await get('/.well-known/oauth-protected-resource/mcp', { host: 'omni.example.com', 'x-forwarded-proto': 'https', 'cf-connecting-ip': '203.0.113.9' });
      expect(((await tunnel.json()) as { resource: string }).resource).toBe('https://omni.example.com/mcp');
    } finally {
      delete process.env.OMNI_MCP_PUBLIC_URL;
    }
    expect((await get('/.well-known/oauth-protected-resource', { host: 'omni.example.com' })).status).toBe(403);
    expect((await get('/.well-known/oauth-protected-resource', { host: 'evil.example' })).status).toBe(403);
  });

  it("serves Clerk's authorization server metadata for clients on the older spec", async () => {
    const res = await get('/.well-known/oauth-authorization-server');
    expect(await res.json()).toMatchObject({ issuer: FAKE_ISSUER, registration_endpoint: `${FAKE_ISSUER}/oauth/register` });
  });

  it('answers a request with no token with a challenge naming the metadata, and a bad one with invalid_token', async () => {
    const none = await post('/mcp', 'tools/list');
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${META}"`);
    const bad = await listTools('oat_nope');
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toBe(`Bearer error="invalid_token", resource_metadata="${META}"`);
  });

  it("lets the owner's access token in, and asks Clerk once a minute, not once a request", async () => {
    const token = clerk.accessToken(OWNER);
    const before = userinfoCalls();
    const res = await listTools(token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: { tools: unknown[] } }).result.tools.length).toBe(20);
    expect((await listTools(token)).status).toBe(200);
    expect(userinfoCalls()).toBe(before + 1);
  });

  it("refuses another Google user's token, an owner token in the URL, and a revoked one", async () => {
    expect((await listTools(clerk.accessToken({ sub: 'user_stranger', email: 'eve@example.com' }))).status).toBe(401);
    expect((await post(`/mcp/${clerk.accessToken(OWNER)}`, 'tools/list')).status).toBe(401);
    const token = clerk.accessToken(OWNER);
    clerk.revoke(token);
    expect((await listTools(token)).status).toBe(401);
  });

  it('keeps the static tokens working alongside it', async () => {
    expect((await post(`/mcp/${MCP_TOKEN}`, 'tools/list')).status).toBe(200);
    expect((await listTools(MCP_TOKEN)).status).toBe(200);
    expect((await listTools(API_TOKEN)).status).toBe(200);
  });

  it('answers 503, not 401, when Clerk cannot be reached', async () => {
    setOAuthFetch((async () => {
      throw new TypeError('network down');
    }) as typeof fetch);
    const res = await listTools(clerk.accessToken(OWNER));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('10');
    setOAuthFetch(clerk.fetch as typeof fetch);
  });

  it('stops taking the token once the account is unlinked', async () => {
    const token = clerk.accessToken(OWNER);
    expect((await listTools(token)).status).toBe(200);
    unlinkOwner();
    expect((await listTools(token)).status).toBe(401);
  });
});
