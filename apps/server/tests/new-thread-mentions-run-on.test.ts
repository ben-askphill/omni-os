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

// A new thread starts on the machine picked in the composer's Machine chip, whatever its first message @mentions. Ben
// writes on Mac Air, the hub, with the chip on Box A, and mentions Studio B (then Studio B and Mini C) for tasks the
// agent should hand off. The thread is made on the hub, goes out to Box A and starts there, and its agent reads one
// Machine mention item per machine with that machine's device id. A mentioned machine that is offline does not stop the
// start: only the agent's later delegate to it fails, and the delegate tool says why.

const ROOT = join(import.meta.dirname, '../../..');
const relay = new MemoryTransport();
const NODE = {
  air: { id: 'nAir', dns: 'mac-air.tail1234.ts.net' },
  boxA: { id: 'nA', dns: 'box-a.tail1234.ts.net' },
  studioB: { id: 'nB', dns: 'studio-b.tail1234.ts.net' },
  miniC: { id: 'nC', dns: 'mini-c.tail1234.ts.net' },
};
type Name = keyof typeof NODE;
const T = { timeout: 45_000 };
const AT = new Date('2026-11-21T12:00:00.000Z');
// The channel's folder, at the same path on every machine.
const shared = mkdtempSync(join(tmpdir(), 'omni-mention-runon-'));
afterAll(() => rmSync(shared, { recursive: true, force: true }));

const macs = {} as Record<Name, Mac>;
let boxTokenPath: (threadId: string) => string;
let boxServer: Server;
const clients: McpClient[] = [];

/** `self`'s Tailscale view: every other machine up, except those listed as offline. */
const tailnetOf = (self: Name, offline: Partial<Record<Name, string>> = {}) =>
  tailscaleStatus(
    NODE[self],
    (Object.keys(NODE) as Name[]).filter((n) => n !== self).map((n) => ({ ...NODE[n], online: !(n in offline), ...(offline[n] && { lastSeen: offline[n] }) })),
  );

const all = () => Object.values(macs);
const syncAll = async (rounds = 2) => {
  for (let n = 0; n < rounds; n++) for (const m of all()) await m.sync();
};

/** A machine_mention as the composer makes it from a picked `@` menu row. */
const mention = (row: any) => newContext(machineMention, mentionBody({ id: row.machine.id, name: row.name, reachability: row.machine.reachability, lastSeen: row.machine.lastSeen }, AT), '');
/** The `@` menu's machine rows in the new-thread composer of a Conductor thread, on the hub. */
const machineRows = async () => ((await macs.air.json('/mentions?channel=scratch&role=conductor&q=')).body as any[]).filter((r) => r.kind === 'machine');
const row = async (name: string) => (await machineRows()).find((r) => r.name === name)!;
const threadCount = (m: Mac) => (m.db.db.prepare('SELECT COUNT(*) AS n FROM threads').get() as { n: number }).n;

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
  async tool(name: string, args: Record<string, unknown>) {
    const r = (await this.request('tools/call', { name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    return { isError: !!r.isError, raw: r.content[0].text };
  }
  close() {
    this.child.kill('SIGTERM');
  }
}

/** The omni MCP server as a thread on Box A gets it: over HTTP against Box A, with the token of that thread's turn. */
async function boxOmni(threadId: string) {
  const client = new McpClient(
    spawn(join(ROOT, 'node_modules/.bin/tsx'), [join(ROOT, 'apps/mcp/omni.ts')], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        OMNI_URL: `http://127.0.0.1:${(boxServer.address() as AddressInfo).port}`,
        OMNI_TOKEN_FILE: boxTokenPath(threadId),
        OMNI_USER: 'Ben',
        OMNI_THREAD_ID: threadId,
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    }),
  );
  clients.push(client);
  await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  return client;
}

beforeAll(async () => {
  macs.air = await bootMac('mac-air', 'Mac Air', relay);
  macs.air.tailnet(tailnetOf('air'));
  macs.air.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shared, notes: '' });
  macs.boxA = await bootMac('box-a', 'Box A', relay);
  // Box A's own modules, before the next boot loads fresh copies.
  ({ threadTokenPath: boxTokenPath } = await import('../config.ts'));
  const { serve } = await import('@hono/node-server');
  boxServer = serve({ fetch: macs.boxA.app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
  await once(boxServer, 'listening');
  macs.boxA.tailnet(tailnetOf('boxA'));
  macs.studioB = await bootMac('studio-b', 'Studio B', relay);
  macs.studioB.tailnet(tailnetOf('studioB'));
  macs.miniC = await bootMac('mini-c', 'Mini C', relay);
  macs.miniC.tailnet(tailnetOf('miniC'));
  for (const m of all()) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await syncAll();
}, 90_000);

afterAll(async () => {
  for (const c of clients) c.close();
  boxServer?.close();
  boxServer?.closeAllConnections();
  for (const m of all()) {
    for (const t of m.db.threads.running().filter((r) => m.runner.isLive(r.id))) {
      await m.json(`/threads/${t.id}/stop`, { body: {} });
      await waitFor(() => !m.runner.isLive(t.id), 'the turn to stop');
      await m.files.turnFinished(t.id);
    }
  }
}, 30_000);

/**
 * Start a Conductor thread on the hub with the chip on `device` and `mentions` in the first message, then wait for it
 * to start on `runsOn`. Returns its id, its first message as `runsOn` recorded it and the text its Claude read.
 */
async function start(prompt: string, device: string, mentions: MessageContext[], runsOn: Mac) {
  const res = await macs.air.json('/threads', { body: { channel: 'scratch', role: 'conductor', prompt, device, context: mentions } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const id = res.body.id as string;
  if (runsOn !== macs.air) {
    expect(macs.air.db.assignments.get(id)).toMatchObject({ machine: runsOn.id, routed: true });
    expect(macs.air.runner.isLive(id)).toBe(false);
    await syncAll();
  }
  await waitFor(() => runsOn.runner.isLive(id), `the thread to start on ${runsOn.name}`, 20_000);
  const first = (await waitFor(() => runsOn.byKind(id, 'user').find((e) => e.p.text === prompt)?.p, 'its first message', 15_000)) as { text: string; context?: MessageContext[] };
  // Every machine's fake claude logs to the stdin log of the machine booted last (one process.env), so read them all.
  const read = await waitFor(() => all().flatMap((m) => m.claudeTexts(id)).find((t) => t.includes(prompt)), 'the text its Claude read', 15_000);
  for (const m of all()) if (m !== runsOn) expect(m.runner.isLive(id), `${m.name} runs nothing`).toBe(false);
  return { id, first, read };
}

const idsOf = (records: MessageContext[] | undefined) => (records ?? []).map((r) => [r.kind, r.label, (r.body as any).machine]);

describe('a new thread whose first message @mentions other machines', () => {
  it('starts on the chip\'s machine, not the one it mentions, and its agent reads the mention with the device id', T, async () => {
    const prompt = 'TOOL:60000 @Studio B build the collection page';
    const { first, read } = await start(prompt, 'box-a', [mention(await row('Studio B'))], macs.boxA);
    expect(idsOf(first.context)).toEqual([['machine_mention', '@Studio B', 'studio-b']]);
    expect(read).toContain('wrote @Studio B for the machine "Studio B" (device id studio-b).');
    expect(read).toContain('pass device "studio-b" to delegate or continue_thread');
  });

  it('starts on the chip\'s machine with two mentions, each with its own device id', T, async () => {
    const prompt = 'TOOL:60000 @Studio B build the page, @Mini C run the tests';
    const { first, read } = await start(prompt, 'box-a', [mention(await row('Studio B')), mention(await row('Mini C'))], macs.boxA);
    expect(idsOf(first.context)).toEqual([
      ['machine_mention', '@Studio B', 'studio-b'],
      ['machine_mention', '@Mini C', 'mini-c'],
    ]);
    expect(read).toContain('(device id studio-b)');
    expect(read).toContain('(device id mini-c)');
  });

  it('names the machine the agent runs on when Ben mentions it', T, async () => {
    const prompt = 'TOOL:60000 @Box A check the disk, @Mac Air open the PR';
    const { read } = await start(prompt, 'box-a', [mention(await row('Box A')), mention(await row('Mac Air'))], macs.boxA);
    // Worked out where the thread runs: Box A is the agent's own machine there, not the hub.
    expect(read).toContain('(device id box-a), the machine you run on.');
    expect(read).toContain('(device id mac-air).');
    expect(read).not.toContain('(device id mac-air), the machine you run on');
  });

  it('starts on this machine when the chip says so, with the mentions of two others', T, async () => {
    const prompt = 'TOOL:60000 @Studio B build it, @Mini C test it';
    const { id, first } = await start(prompt, 'here', [mention(await row('Studio B')), mention(await row('Mini C'))], macs.air);
    expect(macs.air.db.assignments.get(id)?.routed ?? false).toBe(false);
    expect(idsOf(first.context)).toEqual([
      ['machine_mention', '@Studio B', 'studio-b'],
      ['machine_mention', '@Mini C', 'mini-c'],
    ]);
  });

  it('shows the first message with its mentions on the hub while the other machine has not started it', async () => {
    const prompt = '@Studio B write the release notes';
    const res = await macs.air.json('/threads', { body: { channel: 'scratch', role: 'conductor', prompt, device: 'box-a', context: [mention(await row('Studio B'))] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const opening = (await macs.air.json(`/threads/${res.body.id}`)).body.opening;
    expect(opening.text).toBe(prompt);
    expect(idsOf(opening.context)).toEqual([['machine_mention', '@Studio B', 'studio-b']]);
  });
});

describe('a mentioned machine that is offline', () => {
  it('does not stop the start; only the delegate to it fails, and the tool says why', T, async () => {
    const lastSeen = '2026-11-21T08:00:00Z';
    for (const n of ['air', 'boxA'] as const) macs[n].tailnet(tailnetOf(n, { studioB: lastSeen }));
    try {
      const studio = await row('Studio B');
      expect(studio.machine).toMatchObject({ reachability: 'offline', lastSeen: '2026-11-21T08:00:00.000Z' });
      const prompt = 'TOOL:60000 @Studio B render the frames';
      const { id, first, read } = await start(prompt, 'box-a', [mention(studio)], macs.boxA);
      expect(idsOf(first.context)).toEqual([['machine_mention', '@Studio B', 'studio-b']]);
      expect(read).toContain('Tailscale saw it offline, last seen 2026-11-21T08:00:00.000Z');

      // The agent on Box A hands the task to Studio B as the mention says: the delegate is refused with why, and
      // nothing is made, there or anywhere else.
      const before = all().map(threadCount);
      const omni = await boxOmni(id);
      const res = await omni.tool('delegate', { channel: 'shop', role: 'builder', harness: 'claude-code', title: 'Frames', prompt: 'render the frames', device: 'studio-b' });
      expect(res.isError, res.raw).toBe(true);
      expect(res.raw).toContain('Studio B is offline on Tailscale, last seen');
      expect(all().map(threadCount)).toEqual(before);
      // The thread itself runs on, on Box A.
      expect(macs.boxA.runner.isLive(id)).toBe(true);
      expect(macs.boxA.thread(id).status).toBe('running');
    } finally {
      for (const n of ['air', 'boxA'] as const) macs[n].tailnet(tailnetOf(n));
    }
  });
});

describe("a new thread the chip's machine could not take", () => {
  it('keeps its first message with the mentions here, and Resume hands them to the agent', T, async () => {
    const prompt = 'TOOL:60000 @Studio B tag the release';
    const res = await macs.air.json('/threads', { body: { channel: 'scratch', role: 'conductor', prompt, device: 'box-a', context: [mention(await row('Studio B'))] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = res.body.id as string;
    const offer = macs.air.db.kv.get<any>(`handoff.offer.${id}`);
    expect(offer).toMatchObject({ fresh: true, queued: [prompt], to: { id: 'box-a' } });
    expect(idsOf(offer.context)).toEqual([['machine_mention', '@Studio B', 'studio-b']]);

    // Box A answers the offer as one that cannot take it does, before it would pick it up.
    macs.boxA.db.kv.set(`handoff.reply.${id}`, { offer: offer.id, at: new Date().toISOString(), state: 'failed', error: 'stand-in' });
    await syncAll();
    await waitFor(() => macs.air.thread(id).status === 'stopped', 'the hub to keep the first message');
    expect(macs.boxA.runner.isLive(id)).toBe(false);

    const kept = macs.air.db.messageRequests.byRequestId(id, `handoff-back:${offer.id}:0`)!;
    expect(idsOf(kept.context ?? undefined)).toEqual([['machine_mention', '@Studio B', 'studio-b']]);
    expect((await macs.air.json(`/threads/${id}/requests/resume`, { body: {} })).status).toBe(200);
    await waitFor(() => macs.air.runner.isLive(id), 'the thread to run on the hub');
    const first = (await waitFor(() => macs.air.byKind(id, 'user').find((e) => e.p.text === prompt)?.p, 'its first message', 15_000)) as { context?: MessageContext[] };
    expect(idsOf(first.context)).toEqual([['machine_mention', '@Studio B', 'studio-b']]);
    const read = await waitFor(() => all().flatMap((m) => m.claudeTexts(id)).find((t) => t.includes(prompt)), 'the text its Claude read', 15_000);
    expect(read).toContain('pass device "studio-b" to delegate or continue_thread');
  });
});
