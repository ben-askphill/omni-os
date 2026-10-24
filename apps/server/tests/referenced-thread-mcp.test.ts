import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { newContext } from '@omni/shared/message-context.ts';
import { referenceBody, threadReference } from '@omni/shared/message-context-thread.ts';
import { startRunner } from './runner-boot.ts';

// read_referenced_thread as an agent calls it: the omni-threads server, started from the config Omni writes for a
// thread, talking to the real API over HTTP. The same tool is registered by the conductor's server (apps/mcp/omni.ts).

const h = await startRunner();
const { app } = await import('../app.ts');
const { serve } = await import('@hono/node-server');
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
await once(server, 'listening');
const port = (server.address() as AddressInfo).port;
const { buildMcpConfig } = await import('../sandbox.ts');
const { stampThreadReferences } = await import('../message-context/thread-reference.ts');
const { PAGE_ROWS_MAX } = await import('../thread-history.ts');
const clients: Client[] = [];
afterAll(async () => {
  for (const c of clients) await c.close();
  server.close();
  server.closeAllConnections();
});
const T = { timeout: 30_000 };

const make = (title: string) =>
  h.db.threads.create({ id: randomUUID(), channel_id: 'scratch', title, status: 'done', role: null, model: null, session_id: randomUUID(), cwd: h.paths.data, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null });

/** A client of the thread's own omni-threads server, started the way a harness starts it. */
async function connect(threadId: string) {
  const channel = h.db.channels.get('scratch')!;
  const cfg = buildMcpConfig({ threadId, channel, browserBusy: false, omniUrl: `http://127.0.0.1:${port}` });
  const s = cfg.mcpServers['omni-threads'];
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: s.command, args: s.args, env: { ...(process.env as Record<string, string>), ...s.env } }));
  clients.push(client);
  return client;
}
const callTool = async (client: Client, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name: 'read_referenced_thread', arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  return { isError: !!r.isError, body: JSON.parse(r.content[0].text) as any };
};

describe('read_referenced_thread', () => {
  const from = make('Asking');
  const to = make('A long one');
  for (let i = 0; i < 120; i++) h.db.events.add(to.id, i % 2 ? 'assistant_text' : 'user', { text: `message ${i}` });
  const stamped = stampThreadReferences(from.id, [newContext(threadReference, referenceBody({ id: to.id, title: to.title, channel: 'scratch', channel_name: 'Scratch' }, 'scratch', new Date()), '')]);
  if (!stamped.ok) throw new Error(stamped.error);
  h.db.events.add(from.id, 'user', { text: 'read it', context: stamped.value });

  it('is the only tool the thread gets, with its limits in the description', T, async () => {
    const client = await connect(from.id);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['read_referenced_thread']);
    expect(tools[0].description).toContain('at most 100 messages and 60,000 characters');
    expect(tools[0].description).toContain('cut at 8,000 characters');
  });

  it('returns a bounded page and pages back with its cursor', T, async () => {
    const client = await connect(from.id);
    const first = await callTool(client, { thread_id: to.id });
    expect(first.isError).toBe(false);
    expect(first.body.rows).toHaveLength(40);
    expect(first.body.rows.at(-1).text).toBe('message 119');
    const older = await callTool(client, { thread_id: to.id, before: first.body.older, limit: PAGE_ROWS_MAX });
    expect(older.body.rows.at(-1).text).toBe('message 79');
    expect(older.body.rows).toHaveLength(80);
    expect(older.body.older).toBeNull();
  });

  it('says unavailable, as an error, for a thread nothing referenced and for one that is gone', T, async () => {
    const client = await connect(from.id);
    const stranger = make('Never referenced');
    const none = await callTool(client, { thread_id: stranger.id });
    expect(none).toMatchObject({ isError: true, body: { state: 'unavailable', reason: 'not_referenced' } });
    const gone = make('Gone');
    const s = stampThreadReferences(from.id, [newContext(threadReference, referenceBody({ id: gone.id, title: gone.title, channel: 'scratch', channel_name: 'Scratch' }, 'scratch', new Date()), '')]);
    if (!s.ok) throw new Error(s.error);
    h.db.events.add(from.id, 'user', { text: 'again', context: s.value });
    h.db.db.prepare('DELETE FROM threads WHERE id = ?').run(gone.id);
    expect(await callTool(client, { thread_id: gone.id })).toMatchObject({ isError: true, body: { state: 'unavailable', reason: 'missing' } });
  });

  it('explains a bad call and an unknown asking thread instead of throwing', T, async () => {
    const client = await connect(from.id);
    const both = await callTool(client, { thread_id: to.id, before: 5, after: 3 });
    expect(both).toMatchObject({ isError: true, body: { state: 'unavailable', message: 'Pass before or after, not both.' } });
    const lone = await connect(randomUUID());
    expect(await callTool(lone, { thread_id: to.id })).toMatchObject({ isError: true, body: { state: 'unavailable', message: 'not found' } });
  });
});
