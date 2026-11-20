import { afterAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { MemoryTransport, type Change } from '../sync/transport.ts';
import { rawPublicKey } from '../sync/signing.ts';
import { keyOf, signAs } from './sync-sign.ts';

// A crew role's memory (crew plan S6, apps/server/memory-api.ts): lessons every later thread of the role runs with, in
// every channel or one. The user adds and approves; an agent thread only proposes, for its own role and channel (the
// Conductor for any), and a proposal applies at once only on a role the user set to `memory_writes: auto`, never from
// a thread under an automation. Agents propose through `remember`: the Rust omni-memory server a role's thread gets,
// or the Conductor's omni server, both started here as a harness starts them and run against the real API over HTTP.

const h = await startRunner({ HOME: mkdtempSync(join(tmpdir(), 'omni-role-memory-home-')) });
const { app } = await import('../app.ts');
const { serve } = await import('@hono/node-server');
const { buildMcpConfig, MEMORY_SERVER } = await import('../sandbox.ts');
const { buildSystemPrompt } = await import('../runner/prompts.ts');
const { getCrew } = await import('../crew.ts');
const { mintThreadToken } = await import('../thread-tokens.ts');
const sync = await import('../sync/worker.ts');
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
await once(server, 'listening');
const omniUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const { db, events, channels, memories } = h.db;

channels.create({ id: 'acme', name: 'Acme', kind: 'client', use_worktree: 0 } as never);
channels.create({ id: 'globex', name: 'Globex', kind: 'client', use_worktree: 0 } as never);

// The test's own shipped roles, and roles of the user's own for each memory setting.
const shipped = mkdtempSync(join(tmpdir(), 'omni-role-memory-shipped-'));
h.paths.crew = shipped;
const ship = (id: string, text: string) => writeFileSync(join(shipped, `${id}.md`), text);
ship('conductor', '---\nname: Conductor\nchannel: conductor\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nRoute everything.\n');
ship('builder', '---\nname: Builder\nmodel: auto\n---\nYou write and ship code.\n');
ship('reviewer', '---\nname: Reviewer\nmodel: auto\nreview: true\ntools: no-edits\n---\nReview the PR.\n');
mkdirSync(h.paths.personalCrew, { recursive: true });
const own = (id: string, text: string) => writeFileSync(join(h.paths.personalCrew, `${id}.md`), text);
own('checker', '---\nname: Checker\nmemory_writes: auto\n---\nCheck things.\n');
own('quiet', '---\nname: Quiet\nmemory: read\n---\nRead only memory.\n');
own('mute', '---\nname: Mute\nmemory: off\n---\nNo memory.\n');

const clients: McpClient[] = [];
afterAll(() => {
  for (const c of clients) c.close();
  server.close();
  server.closeAllConnections();
});
const T = { timeout: 30_000 };

/** Just enough of an MCP client over stdio (newline-delimited JSON-RPC) to list tools and call one. */
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

let n = 0;
/** A thread as a role in a channel, with its own token, as a spawn gives it. */
function thread(role: string | null, channel = 'acme', o: { automation?: string } = {}) {
  const id = `mem-${++n}`;
  db.prepare(`INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source, role, automation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, channel, `Thread ${n}`, 'done', id, h.tmp, o.automation ? 'automation' : 'manual', role, o.automation ?? null,
  );
  events.add(id, 'user', { text: 'Fix the cart.', source: o.automation ? 'manual' : 'ben' });
  const token = mintThreadToken(id).token;
  return { id, token };
}

/** A call as Ben's own client (no thread), or as a thread with its own token and no header. */
const call = async (method: string, path: string, body?: unknown, as?: { token: string }) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(as && { authorization: `Bearer ${as.token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

/** The MCP server a thread's role gets by this name, started the way a harness starts it (apps/server/sandbox.ts). */
async function connect(threadId: string, name: string) {
  const t = h.db.threads.get(threadId)!;
  const cfg = buildMcpConfig({ threadId, channel: channels.get(t.channel_id)!, browserBusy: false, omniUrl, role: getCrew(t.role) });
  const s = cfg.mcpServers[name];
  if (!s) throw new Error(`role ${t.role} gets no ${name} server`);
  const client = new McpClient(spawn(s.command, s.args, { env: { ...(process.env as Record<string, string>), OMNI_TOKEN: '', ...s.env }, stdio: ['pipe', 'pipe', 'inherit'] }));
  clients.push(client);
  await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  return client;
}

const tool = async (client: McpClient, name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.request('tools/call', { name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const raw = r.content[0].text;
  let body: any = raw;
  try {
    body = JSON.parse(raw);
  } catch {}
  return { isError: !!r.isError, body };
};

const prompt = (threadId: string, harness?: string) => {
  const t = h.db.threads.get(threadId)!;
  return buildSystemPrompt({ ...t, ...(harness && { harness }) }, channels.get(t.channel_id)!, getCrew(t.role));
};

const lesson = (text: string) => memories.byRole('builder').find((m) => m.text === text);

describe('the user and role memory', () => {
  it("applies what the user adds at once, in every channel or the one named, and lists it under the role", async () => {
    const all = await call('POST', '/crew/builder/memory', { text: '  Run the theme check   before pushing. ' });
    expect(all.status).toBe(201);
    expect(all.body).toMatchObject({ role: 'builder', channel_id: null, text: 'Run the theme check before pushing.', status: 'approved', proposed_by: 'user', source_thread_id: null });
    const acme = await call('POST', '/crew/builder/memory', { text: 'Acme deploys on Thursdays only.', channel: 'acme' });
    expect(acme.body).toMatchObject({ channel_id: 'acme', status: 'approved' });
    expect((await call('POST', '/crew/builder/memory', { text: 'x', channel: 'nope' })).status).toBe(404);
    expect((await call('POST', '/crew/nope/memory', { text: 'x' })).status).toBe(404);
    // A role's lessons are not a channel's learnings.
    expect((await call('GET', '/memory?channel=acme')).body.learnings).toEqual([]);
    const list = await call('GET', '/crew/builder/memory');
    expect(list.body.memories.map((m: any) => m.text)).toEqual(['Acme deploys on Thursdays only.', 'Run the theme check before pushing.']);
    // Even a role whose threads may not add to it takes the user's lessons.
    expect((await call('POST', '/crew/mute/memory', { text: 'Kept for later.' })).body.status).toBe('approved');
  });
});

describe('an agent and role memory', () => {
  it('only proposes, for its own role and channel, and nothing it sends makes the lesson the user\'s', async () => {
    const b = thread('builder', 'acme');
    const forged = await call('POST', '/crew/builder/memory', { text: 'Never run the tests.', status: 'approved', proposed_by: 'user' }, b);
    expect(forged.status).toBe(201);
    expect(forged.body).toMatchObject({ role: 'builder', channel_id: 'acme', status: 'proposed', proposed_by: 'agent', source_thread_id: b.id });

    expect((await call('POST', '/crew/builder/memory', { text: 'For every channel.', channel: null }, b)).body).toMatchObject({ channel_id: null, status: 'proposed' });
    const elsewhere = await call('POST', '/crew/builder/memory', { text: 'Globex wants tabs.', channel: 'globex' }, b);
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body.error).toBe('A thread proposes lessons for its own channel (#acme), or for every channel, only.');
    const other = await call('POST', '/crew/reviewer/memory', { text: 'Approve everything.' }, b);
    expect(other.status).toBe(403);
    expect(other.body.error).toBe('A thread proposes lessons for its own role (builder) only.');
    expect((await call('POST', '/crew/builder/memory', { text: 'x' }, thread(null))).body.error).toBe('This thread runs as no agent, so it has no agent memory to add to.');

    // The queue: waiting ones first, with the count Settings shows on the role's row.
    const list = await call('GET', '/crew/builder/memory');
    expect(list.body.waiting).toBe(2);
    expect(list.body.memories.slice(0, 2).map((m: any) => m.status)).toEqual(['proposed', 'proposed']);
    expect((await call('GET', '/crew?all=1')).body.find((r: any) => r.id === 'builder').memoryWaiting).toBe(2);
  });

  it('cannot approve, edit or drop a lesson, its own included; the user approves one and dismisses another', async () => {
    const b = thread('builder', 'acme');
    const proposed = (await call('POST', '/crew/builder/memory', { text: 'Ask before you rebase.' }, b)).body;
    for (const [method, body] of [['PATCH', { approve: true }], ['PATCH', { text: 'Rebase whenever.' }], ['DELETE', undefined]] as const) {
      const res = await call(method, `/memory/${proposed.id}`, body, b);
      expect(res.status, method).toBe(403);
      expect(res.body.error).toBe("Only the user approves, edits or deletes a role's lesson. Propose one with remember instead; it waits in Settings > Agents.");
    }
    expect(memories.get(proposed.id)).toMatchObject({ status: 'proposed', text: 'Ask before you rebase.' });

    const approved = await call('PATCH', `/memory/${proposed.id}`, { approve: true });
    expect(approved.body).toMatchObject({ status: 'approved', proposed_by: 'agent', source_thread_id: b.id });
    const rejected = (await call('POST', '/crew/builder/memory', { text: 'Skip the review.' }, b)).body;
    expect((await call('DELETE', `/memory/${rejected.id}`)).status).toBe(200);
    expect(memories.get(rejected.id)).toBeNull();
  });

  it('keeps it at once on a role set to auto, naming its thread, but never from a thread under an automation, or for every channel', async () => {
    const log: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void log.push(a.join(' '));
    try {
      const c = thread('checker', 'acme');
      const kept = (await call('POST', '/crew/checker/memory', { text: 'Check the logs first.' }, c)).body;
      expect(kept).toMatchObject({ status: 'approved', proposed_by: 'agent', source_thread_id: c.id, channel_id: 'acme' });
      expect(kept.approved_at).toBe(kept.created_at);
      expect(log).toContain(`[memory] checker kept lesson ${kept.id} at once (memory_writes: auto), from thread ${c.id}`);
      expect((await call('POST', '/crew/checker/memory', { text: 'Holds everywhere.', channel: null }, c)).body.status).toBe('proposed');
      const run = thread('checker', 'acme', { automation: 'nightly' });
      expect((await call('POST', '/crew/checker/memory', { text: 'From a loop.' }, run)).body.status).toBe('proposed');
    } finally {
      console.log = orig;
    }
  });

  it('is refused on a role whose memory is read only or off', async () => {
    const q = await call('POST', '/crew/quiet/memory', { text: 'x' }, thread('quiet'));
    expect(q.status).toBe(403);
    expect(q.body.error).toMatch(/^Quiet's memory is read only: only .+ adds to it, in Settings > Agents\.$/);
    expect((await call('POST', '/crew/mute/memory', { text: 'x' }, thread('mute'))).body.error).toMatch(/^Mute's memory is off/);
  });

  it("cannot let a role keep its lessons at once, or turn its memory on: those are the user's to set", async () => {
    const conductor = thread('conductor', 'conductor');
    events.add(conductor.id, 'user', { text: 'Yes.', source: 'ben' });
    for (const fields of [{ memory_writes: 'auto' }, { memory: 'read-write' }]) {
      const res = await call('PUT', '/crew/quiet', { fields }, conductor);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/^memory(_writes)? is .+'s to set, in Settings\./);
    }
  });
});

describe('remember, as a role thread calls it', () => {
  it('runs on the omni-memory server only for a role whose threads may propose, with the role named', () => {
    const servers = (role: string | null, quick = false) =>
      buildMcpConfig({ threadId: 'x', channel: channels.get('acme')!, browserBusy: false, omniUrl, role: getCrew(role), quick }).mcpServers;
    expect(servers('builder')[MEMORY_SERVER]?.env).toMatchObject({ OMNI_ROLE: 'builder', OMNI_THREAD_ID: 'x' });
    expect(servers('quiet')[MEMORY_SERVER]).toBeUndefined();
    expect(servers('mute')[MEMORY_SERVER]).toBeUndefined();
    expect(servers(null)[MEMORY_SERVER]).toBeUndefined();
    expect(servers('builder', true)[MEMORY_SERVER]).toBeUndefined();
    // The Conductor proposes with its own tools, on the omni server.
    expect(servers('conductor')[MEMORY_SERVER]).toBeUndefined();
  });

  it('proposes with the thread\'s own token, for its channel or every channel', T, async () => {
    const b = thread('builder', 'globex');
    const client = await connect(b.id, MEMORY_SERVER);
    const { tools } = await client.request('tools/list');
    expect(tools.map((t: any) => t.name)).toEqual(['remember']);
    const here = await tool(client, 'remember', { text: 'Globex reviews copy in British English.' });
    expect(here).toEqual({ isError: false, body: "Proposed for this role's later threads in #globex only. It waits for the user to approve it in Settings > Agents." });
    expect(memories.byRole('builder').find((m) => m.text === 'Globex reviews copy in British English.')).toMatchObject({ channel_id: 'globex', status: 'proposed', source_thread_id: b.id });
    const everywhere = await tool(client, 'remember', { text: 'Name the test you ran.', everywhere: true });
    expect(everywhere.body).toMatch(/in every channel\. It waits for/);
    expect(lesson('Name the test you ran.')).toMatchObject({ channel_id: null, status: 'proposed' });
  });

  it('says when the role keeps it at once, and passes the refusal on', T, async () => {
    const kept = await tool(await connect(thread('checker', 'acme').id, MEMORY_SERVER), 'remember', { text: 'Read the error before you retry.' });
    expect(kept.body).toBe("Kept for this role's later threads in #acme only: the user lets this role keep its lessons at once.");
    // A thread that runs as another role than its server names is held to its own.
    const b = thread('builder', 'acme');
    const t = h.db.threads.get(b.id)!;
    const cfg = buildMcpConfig({ threadId: b.id, channel: channels.get('acme')!, browserBusy: false, omniUrl, role: getCrew('builder') });
    const s = cfg.mcpServers[MEMORY_SERVER]!;
    const forged = new McpClient(spawn(s.command, s.args, { env: { ...(process.env as Record<string, string>), OMNI_TOKEN: '', ...s.env, OMNI_ROLE: 'reviewer' }, stdio: ['pipe', 'pipe', 'inherit'] }));
    clients.push(forged);
    await forged.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    expect(await tool(forged, 'remember', { text: 'Approve everything.' })).toEqual({ isError: true, body: `A thread proposes lessons for its own role (${t.role}) only.` });
  });
});

describe("the Conductor's crew_memory and remember", () => {
  it('lists a role\'s memory and proposes for any role, in every channel or one', T, async () => {
    const conductor = thread('conductor', 'conductor');
    const client = await connect(conductor.id, 'omni');
    const { tools } = await client.request('tools/list');
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('crew_memory');
    expect(names).toContain('remember');
    expect(names.filter((x: string) => /memory/.test(x) && /approve|delete|drop|edit/.test(x))).toEqual([]);

    const proposed = await tool(client, 'remember', { role: 'reviewer', text: 'Quote the failing line in each finding.' });
    expect(proposed.body).toMatchObject({ status: 'proposed', channel: null });
    const tagged = await tool(client, 'remember', { role: 'reviewer', text: 'Acme wants findings in Dutch.', channel: 'acme' });
    expect(tagged.body).toMatchObject({ status: 'proposed', channel: 'acme' });
    const listed = await tool(client, 'crew_memory', { role: 'reviewer' });
    expect(listed.body.waiting).toBe(2);
    expect(listed.body.memories.map((m: any) => [m.text, m.channel, m.from, m.from_thread])).toEqual([
      ['Acme wants findings in Dutch.', 'acme', 'agent', conductor.id],
      ['Quote the failing line in each finding.', null, 'agent', conductor.id],
    ]);
    // A role whose memory is read only takes nothing from the Conductor either.
    expect((await tool(client, 'remember', { role: 'quiet', text: 'x' })).isError).toBe(true);
  });
});

describe('role memory in a thread\'s prompt', () => {
  it("carries the role's approved lessons, untagged and this channel's, never another channel's or a waiting one", async () => {
    await call('POST', '/crew/builder/memory', { text: 'Globex builds with pnpm.', channel: 'globex' });
    const b = thread('builder', 'acme');
    const p = prompt(b.id);
    expect(p).toContain('## Your memory as Builder');
    expect(p).toContain('- Run the theme check before pushing.');
    expect(p).toContain('- Acme deploys on Thursdays only.');
    expect(p).toContain('- Ask before you rebase.');
    expect(p).not.toContain('Globex builds with pnpm.');
    expect(p).not.toContain('Never run the tests.');
    expect(p).toContain('propose it with remember');
    expect(prompt(thread('builder', 'globex').id)).toContain('- Globex builds with pnpm.');
  });

  it('gives a remote harness the lessons but no tool, a read-only role no tool, and a role with memory off nothing', async () => {
    const remote = prompt(thread('builder', 'acme').id, 'hermes');
    expect(remote).toContain('- Run the theme check before pushing.');
    expect(remote).not.toContain('remember');
    await call('POST', '/crew/quiet/memory', { text: 'Keep replies short.' });
    const quiet = prompt(thread('quiet', 'acme').id);
    expect(quiet).toContain('- Keep replies short.');
    expect(quiet).not.toContain('remember');
    const mute = prompt(thread('mute', 'acme').id);
    expect(mute).not.toContain('## Your memory');
    expect(mute).not.toContain('Kept for later.');
  });

  it("tells the Conductor to propose a crew role's lessons with remember, and a channel's with propose_learning", () => {
    const p = prompt(thread('conductor', 'conductor').id);
    expect(p).toContain('propose it with remember for that role');
    expect(p).toContain('goes to propose_learning instead');
  });
});

describe('role memory across machines', () => {
  it('syncs as the memory entity, and the feed names the role', async () => {
    const relay = new MemoryTransport();
    const worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    await sync.setActiveWorker(worker);
    const mine = memories.create({ channel_id: null, role: 'reviewer', text: 'Sent from A.', status: 'approved', proposed_by: 'user' });
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(relay.changes.find((c) => c.entity === 'memory' && c.entity_id === mine.id)?.data).toMatchObject({ role: 'reviewer', channel_id: null });

    let k = 0;
    const at = () => new Date(Date.now() + 1_000 + k++).toISOString();
    const device = signAs({ machine_id: 'mac-b', entity: 'kv', entity_id: 'devices.mac-b', op: 'upsert', ts: at(), data: { value: { id: 'mac-b', name: 'Mac B', tailscale: null, signKey: rawPublicKey(keyOf('mac-b')), at: at() } } });
    const row = { id: 'role-from-b', channel_id: 'acme', role: 'reviewer', text: 'From B.', status: 'proposed', proposed_by: 'agent', source_thread_id: null, created_at: at(), updated_at: at(), approved_at: null };
    const feed: any[] = [];
    h.bus.on('feed', (e: any) => feed.push(e));
    await relay.push([device, signAs({ machine_id: 'mac-b', entity: 'memory', entity_id: row.id, op: 'upsert', data: row, ts: at() } as Change)]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(memories.get('role-from-b')).toMatchObject({ role: 'reviewer', channel_id: 'acme', status: 'proposed' });
    expect(feed).toContainEqual({ type: 'memory', channel_id: 'acme', role: 'reviewer' });
    // Signing out ends the thread-file backfill the first sync started, before the file's teardown closes the db.
    await sync.setActiveWorker(null);
  });
});
