import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newContext, type MessageContext } from '@omni/shared/message-context.ts';
import { machineMention, mentionBody } from '@omni/shared/message-context-machine.ts';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Machine mentions (packages/shared/message-context-machine.ts): in the Conductor's composer Ben @mentions Box B for one
// task and Mac A for another. The `@` menu lists both machines, the message carries a machine_mention record for
// each with its id, the Conductor reads that id in its context block, and its delegate calls (the real omni MCP
// server, over HTTP against Mac A, with a thread token as a harness gets one) run each task on the machine mentioned
// for it. A mentioned machine that is offline fails its delegate; nothing runs anywhere else.

const ROOT = join(import.meta.dirname, '../../..');
const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'mac-a.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'box-b.tail1234.ts.net' };
const T = { timeout: 30_000 };
const CONDUCTOR = 'conductor-thread';
// The channel's folder, at the same path on both machines.
const shared = mkdtempSync(join(tmpdir(), 'omni-mentions-shop-'));
afterAll(() => rmSync(shared, { recursive: true, force: true }));

let a: Mac;
let b: Mac;
let server: Server;
let omni: McpClient;
/** A Conductor turn starting: its spawn's token, which the MCP reads from the file. A turn that ended revoked its own. */
let newTurn: () => void;
let memberToken: (id: string) => string;
let harnessText: typeof import('../message-context/project.ts').harnessText;

/** Just enough of an MCP client over stdio (newline-delimited JSON-RPC) to call a tool. */
class McpClient {
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

const tool = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await omni.request('tools/call', { name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const raw = r.content[0].text;
  let body: any = raw;
  try {
    body = JSON.parse(raw);
  } catch {}
  return { isError: !!r.isError, body, raw };
};

const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
};
const threadCount = (m: Mac) => (m.db.db.prepare('SELECT COUNT(*) AS n FROM threads').get() as { n: number }).n;
const AT = new Date('2026-11-19T12:00:00.000Z');
/** A machine_mention as the composer makes it from a picked `@` menu row. */
const mention = (row: any) => newContext(machineMention, mentionBody({ id: row.machine.id, name: row.name, reachability: row.machine.reachability, lastSeen: row.machine.lastSeen }, AT), '');
/** The user event of `prompt` in the Conductor, once the runner wrote it. */
const sentEvent = (prompt: string) =>
  waitFor(() => a.byKind(CONDUCTOR, 'user').find((e) => e.p.text === prompt)?.p as { text: string; context: MessageContext[] } | undefined, `the message "${prompt}"`, 15_000);
const machineRows = async (thread: string, q = '') => ((await a.json(`/mentions?thread=${thread}&q=${q}`)).body as any[]).filter((r) => r.kind === 'machine');

beforeAll(async () => {
  a = await bootMac('mac-a', 'Mac A', relay);
  // Mac A's own modules, before Box B boots its fresh copies.
  const { mintThreadToken } = await import('../thread-tokens.ts');
  const { threadTokenPath } = await import('../config.ts');
  ({ harnessText } = await import('../message-context/project.ts'));
  const { serve } = await import('@hono/node-server');
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shared, notes: '' });
  // Made the way sync records it, so Box B gets the parent of the thread it runs.
  a.db.threads.create({
    id: CONDUCTOR, channel_id: 'conductor', title: 'Conductor', status: 'done', role: 'conductor', model: null, session_id: CONDUCTOR,
    cwd: a.tmp, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
  a.db.threads.create({
    id: 'plain-thread', channel_id: 'scratch', title: 'Plain', status: 'done', role: null, model: null, session_id: 'plain-thread',
    cwd: a.tmp, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
  // The token file, as a harness gets it: each Conductor turn mints its own token into it.
  memberToken = (id) => mintThreadToken(id).token;
  newTurn = () => void memberToken(CONDUCTOR);
  newTurn();
  server = serve({ fetch: a.app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
  await once(server, 'listening');
  omni = new McpClient(
    spawn(join(ROOT, 'node_modules/.bin/tsx'), [join(ROOT, 'apps/mcp/omni.ts')], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, OMNI_TOKEN_FILE: threadTokenPath(CONDUCTOR), OMNI_USER: 'Ben', OMNI_THREAD_ID: CONDUCTOR },
      stdio: ['pipe', 'pipe', 'inherit'],
    }),
  );
  await omni.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });

  b = await bootMac('box-b', 'Box B', relay);
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await a.sync();
}, 60_000);

afterAll(async () => {
  omni?.close();
  server?.close();
  server?.closeAllConnections();
  for (const m of [a, b]) {
    for (const t of m.db.threads.running().filter((r) => m.runner.isLive(r.id))) {
      await m.json(`/threads/${t.id}/stop`, { body: {} });
      await waitFor(() => !m.runner.isLive(t.id), 'the turn to stop');
      await m.files.turnFinished(t.id);
    }
  }
}, 30_000);

describe('the @ menu in the Conductor', () => {
  it('lists every machine first, this one included, with whether it is up', async () => {
    expect(await machineRows(CONDUCTOR)).toEqual([
      { insert: 'Mac A', name: 'Mac A', detail: 'This machine', kind: 'machine', machine: { id: 'mac-a', here: true, reachability: 'online', lastSeen: null } },
      { insert: 'Box B', name: 'Box B', detail: 'Online', kind: 'machine', machine: { id: 'box-b', here: false, reachability: 'online', lastSeen: null } },
    ]);
    expect((await machineRows(CONDUCTOR, 'bo')).map((r) => r.name)).toEqual(['Box B']);
  });

  it('lists no machines in a thread that cannot delegate', async () => {
    expect(await machineRows('plain-thread')).toEqual([]);
  });
});

describe('a Conductor message that @mentions two machines', () => {
  let records: MessageContext[];

  it('carries a stamped record per machine, and the Conductor reads each id', T, async () => {
    const [here, box] = await machineRows(CONDUCTOR);
    const prompt = '@Box B build the POOWS collection page, @Mac A run the server tests';
    const res = await a.json(`/threads/${CONDUCTOR}/messages`, { body: { prompt, context: [mention(box), mention(here)] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    records = (await sentEvent(prompt)).context;
    expect(records.map((r) => [r.kind, r.label, (r.body as any).machine, (r.body as any).reachability])).toEqual([
      ['machine_mention', '@Box B', 'box-b', 'online'],
      ['machine_mention', '@Mac A', 'mac-a', 'online'],
    ]);
    // Stamped as the route sent it, not as the client said.
    expect((records[0].body as any).captured_at).not.toBe(AT.toISOString());
    const text = harnessText(prompt, records, a.thread(CONDUCTOR));
    expect(text).toContain('wrote @Box B for the machine "Box B" (device id box-b).');
    expect(text).toContain('wrote @Mac A for the machine "Mac A" (device id mac-a), the machine you run on.');
    expect(text).toContain('pass device "box-b" to seat_agents');
    expect(text).toContain('never run it on another machine instead');
  });

  it('runs each task on the machine mentioned for it', T, async () => {
    newTurn();
    const build = await tool('delegate', { channel: 'shop', role: 'builder', harness: 'claude-code', title: 'Collection page', prompt: 'TOOL:60000 build the POOWS collection page', device: (records[0].body as any).machine });
    expect(build.isError, build.raw).toBe(false);
    expect(build.body.machine).toEqual({ id: 'box-b', name: 'Box B', here: false });
    const tests = await tool('delegate', { channel: 'shop', role: 'builder', harness: 'claude-code', title: 'Server tests', prompt: 'TOOL:60000 run the server tests', device: (records[1].body as any).machine });
    expect(tests.isError, tests.raw).toBe(false);
    expect(tests.body.machine).toEqual({ id: 'mac-a', name: 'Mac A', here: true });

    // The build goes out to Box B and runs there; the tests run here on Mac A.
    expect(a.db.assignments.get(build.body.thread_id)).toMatchObject({ machine: 'box-b', routed: true });
    await waitFor(() => a.runner.isLive(tests.body.thread_id), 'the tests to start on Mac A');
    expect(a.runner.isLive(build.body.thread_id)).toBe(false);
    await both();
    await waitFor(() => b.runner.isLive(build.body.thread_id), 'the build to start on Box B');
    expect(b.thread(build.body.thread_id).parent_id).toBe(CONDUCTOR);
    expect(b.runner.isLive(tests.body.thread_id)).toBe(false);
  });
});

// The dashboard's composer (and a channel's) starts a thread: its `@` menu has the machines when the role it starts as
// can delegate, and the first message carries the mention the way a reply does.
describe('the new-thread composer', () => {
  const newRows = async (q: string) => ((await a.json(`/mentions?${q}`)).body as any[]).filter((r) => r.kind === 'machine');

  it('lists the machines when the thread starts as the Conductor, and none for a role that cannot delegate', async () => {
    expect((await newRows('channel=scratch&role=conductor&q=')).map((r) => [r.name, r.machine.id])).toEqual([
      ['Mac A', 'mac-a'],
      ['Box B', 'box-b'],
    ]);
    expect(await newRows('channel=scratch&q=')).toEqual([]);
    expect(await newRows('channel=scratch&role=builder&q=')).toEqual([]);
  });

  it('starts a thread whose first message carries the stamped mention with the device id', T, async () => {
    const box = (await newRows('channel=scratch&role=conductor&q=box'))[0];
    const prompt = '@Box B run the ingest';
    const res = await a.json('/threads', { body: { channel: 'scratch', role: 'conductor', prompt, context: [mention(box)] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = (res.body as any).id as string;
    const first = (await waitFor(() => a.byKind(id, 'user').find((e) => e.p.text === prompt)?.p, 'the first message', 15_000)) as { context: MessageContext[] };
    expect(first.context.map((r) => [r.kind, r.label, (r.body as any).machine])).toEqual([['machine_mention', '@Box B', 'box-b']]);
    expect((first.context[0].body as any).captured_at).not.toBe(AT.toISOString());
    expect(harnessText(prompt, first.context, a.thread(id))).toContain('pass device "box-b" to seat_agents');
    await a.json(`/threads/${id}/stop`, { body: {} });
  });

  it('refuses a first message that mentions a machine nobody knows, and makes no thread', async () => {
    const ghost = newContext(machineMention, mentionBody({ id: 'gone-1', name: 'Old Mac', reachability: 'online', lastSeen: null }, AT), '');
    const before = threadCount(a);
    const res = await a.json('/threads', { body: { channel: 'scratch', role: 'conductor', prompt: '@Old Mac do it', context: [ghost] } });
    expect(res).toMatchObject({ status: 400, body: { error: '@Old Mac: no synced machine has that id now. Remove the mention, then @mention the machine again.' } });
    expect(threadCount(a)).toBe(before);
  });
});

describe('a mentioned machine that cannot take the task', () => {
  it('shows as offline in the menu and on the record, and its delegate fails with nothing made', T, async () => {
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: false, lastSeen: '2026-11-19T08:00:00Z' }]));
    try {
      const box = (await machineRows(CONDUCTOR, 'box'))[0];
      expect(box).toMatchObject({ detail: 'Asleep or offline', machine: { reachability: 'offline', lastSeen: '2026-11-19T08:00:00.000Z' } });
      const res = await a.json(`/threads/${CONDUCTOR}/messages`, { body: { prompt: '@Box B render the frames', context: [mention(box)], mode: 'queue' } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const sent = await sentEvent('@Box B render the frames');
      expect(harnessText('@Box B render the frames', sent.context, a.thread(CONDUCTOR))).toContain('Tailscale saw it offline, last seen 2026-11-19T08:00:00.000Z');

      const before = threadCount(a);
      newTurn();
      const { isError, raw } = await tool('delegate', { channel: 'shop', role: 'builder', harness: 'claude-code', prompt: 'render the frames', device: 'box-b' });
      expect(isError).toBe(true);
      expect(raw).toContain('Box B is offline on Tailscale, last seen');
      expect(threadCount(a)).toBe(before);
    } finally {
      a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
    }
  });

  it('refuses a message that mentions a machine nobody knows', async () => {
    const ghost = newContext(machineMention, mentionBody({ id: 'gone-1', name: 'Old Mac', reachability: 'online', lastSeen: null }, AT), '');
    const res = await a.json(`/threads/${CONDUCTOR}/messages`, { body: { prompt: '@Old Mac do it', context: [ghost], mode: 'queue' } });
    expect(res).toMatchObject({ status: 400, body: { error: '@Old Mac: no synced machine has that id now. Remove the mention, then @mention the machine again.' } });
  });

  it("resolves this machine's own name to here", T, async () => {
    expect((await a.json('/devices/pick?device=mac%20a')).body).toEqual({ device: 'here', id: 'mac-a', name: 'Mac A', here: true, via: 'here' });
    expect((await a.json('/devices/pick?device=studio')).status).toBe(404);
  });
});


describe('seating a machine-pinned agent in #conductor', () => {
  const seatBuilder = (prompt: string, device?: string) => {
    newTurn();
    return tool('seat_agents', { agents: ['builder'], message: prompt, device });
  };
  const builder = () => a.db.members.of(CONDUCTOR, 'builder')!;
  const childFromSeat = async (parent: string, prompt: string) => {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${memberToken(parent)}` },
      // The same authenticated creation request as omni new, with the QA harness set explicitly.
      body: JSON.stringify({ parent_id: parent, channel: 'shop', role: 'builder', harness: 'claude-code', source: 'conductor', prompt }),
    });
    return { status: res.status, body: await res.json() };
  };

  it('refuses offline, unknown and paused devices before seating anyone', T, async () => {
    const before = threadCount(a);
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: false }]));
    try {
      const offline = await seatBuilder('do work there', 'box-b');
      expect(offline.isError).toBe(true);
      expect(offline.raw).toContain('Box B is offline on Tailscale');
    } finally {
      a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
    }
    const unknown = await seatBuilder('do work there', 'unknown-device');
    expect(unknown.isError).toBe(true);
    expect(unknown.raw).toContain('No synced machine has the id or name "unknown-device"');
    a.db.kv.set('sync.enabled', false);
    try {
      const paused = await seatBuilder('do work there', 'box-b');
      expect(paused.isError).toBe(true);
      expect(paused.raw).toContain('Sync is paused on this machine');
    } finally {
      a.db.kv.set('sync.enabled', true);
    }
    expect(builder()).toBeUndefined();
    expect(threadCount(a)).toBe(before);
  });

  it('seats Builder in the Conductor and runs the thread it opens on the selected device', T, async () => {
    const result = await seatBuilder('THINK:300 build in #shop', 'box-b');
    expect(result.isError, result.raw).toBe(false);
    expect(result.body).toMatchObject({ thread_id: CONDUCTOR, members: [{ agent: 'builder' }] });
    const member = builder();
    await waitFor(() => a.runner.isLive(member.session_thread), 'the seated Builder to start');
    expect(member.device).toBe('box-b');
    const child = await childFromSeat(member.session_thread, 'THINK:1000 Build on Box B');
    expect(child.status, JSON.stringify(child.body)).toBe(200);
    const id = child.body.id;
    expect(a.db.assignments.get(id)).toMatchObject({ machine: 'box-b', routed: true });
    expect(a.runner.isLive(id)).toBe(false);
    await both();
    await waitFor(() => b.byKind(id, 'user').length, 'the client thread to run on Box B');
    expect(b.thread(id).parent_id).toBe(member.session_thread);
    await waitFor(() => b.thread(id).status === 'done', 'the client thread to finish');
    await both();
    await waitFor(() => a.byKind(CONDUCTOR, 'crew_report').some((e) => e.p.thread_id === id), 'the report to reach Builder in the Conductor');
    await waitFor(() => a.thread(member.session_thread).status === 'done', 'the seated Builder to finish its report');
  });

  it('uses the existing seat and sends locally when the next brief leaves device out', T, async () => {
    const previous = builder().session_thread;
    const result = await seatBuilder('TOOL:60000 work in #shop');
    expect(result.isError, result.raw).toBe(false);
    expect(builder()).toMatchObject({ session_thread: previous, device: null });
    await waitFor(() => a.runner.isLive(previous), 'the unpinned Builder to start');
    const child = await childFromSeat(previous, 'THINK:1000 Build on Mac A');
    expect(child.status, JSON.stringify(child.body)).toBe(200);
    await waitFor(() => a.byKind(child.body.id, 'user').length, 'the client thread to run on Mac A');
    expect(a.db.assignments.get(child.body.id)?.machine).toBe('mac-a');
  });

  it('re-briefs a working seat on this machine whether the brief names it or leaves the device out', T, async () => {
    const pinned = await seatBuilder('TOOL:3000 work here', 'mac-a');
    expect(pinned.isError, pinned.raw).toBe(false);
    expect(builder().device).toBe('mac-a');
    const unpinned = await seatBuilder('TOOL:3000 change of plan');
    expect(unpinned.isError, unpinned.raw).toBe(false);
    expect(builder().device).toBeNull();
    const moved = await seatBuilder('work on Box B', 'box-b');
    expect(moved.isError).toBe(true);
    expect(moved.raw).toContain('Builder is still working in this thread');
    expect(builder().device).toBeNull();
  });

  it('refuses a remote machine that announced it paused sync', T, async () => {
    expect((await b.json('/sync/disable', { body: {} })).status).toBe(200);
    await a.sync();
    const result = await seatBuilder('work on Box B', 'box-b');
    expect(result.isError).toBe(true);
    expect(result.raw).toContain('Sync is paused on Box B');
    expect(builder().device).toBeNull();
  });
});
