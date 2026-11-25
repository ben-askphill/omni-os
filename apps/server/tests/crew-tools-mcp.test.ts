import { afterAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { png } from './png.ts';
import { startRunner } from './runner-boot.ts';
import { MemoryTransport } from '../sync/transport.ts';

// The Conductor's crew tools (apps/mcp/omni.ts: get_crew_role, save_crew_role, reset_crew_role, plan slice S7) as the
// Conductor calls them: its own omni server, started from the config Omni writes for its thread, against the real API
// over HTTP. The crew guard (apps/server/crew-guard.ts) and the locks (CREW_LOCKS in apps/server/crew.ts) decide every
// write, and the shipped files are the test's own, so nothing reads or writes the repo's crew/.

const h = await startRunner({ HOME: mkdtempSync(join(tmpdir(), 'omni-crew-tools-home-')) });
const { app } = await import('../app.ts');
const { serve } = await import('@hono/node-server');
const { buildMcpConfig } = await import('../sandbox.ts');
const { getCrew } = await import('../crew.ts');
const sync = await import('../sync/worker.ts');
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
await once(server, 'listening');
const omniUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const { db, events } = h.db;

const shipped = mkdtempSync(join(tmpdir(), 'omni-crew-tools-shipped-'));
h.paths.crew = shipped;
const ship = (id: string, text: string) => writeFileSync(join(shipped, `${id}.md`), text);
ship('conductor', '---\nname: Conductor\nchannel: conductor\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nRoute everything.\n');
ship('usage-scan', '---\nname: Usage scan\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nScan.\n');
ship('reviewer', '---\nname: Reviewer\nmodel: auto\nreview: true\n---\nReview the PR.\n');
ship('builder', '---\nname: Builder\ndescription: Writes code.\nmodel: auto\n---\nYou write and ship code.\n');
const ownPath = (id: string) => join(h.paths.personalCrew, `${id}.md`);

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
/** A thread as a role, with the first message Ben sent it. */
function thread(role: string, o: { automation?: string } = {}) {
  const id = `crew-tools-${++n}`;
  db.prepare(`INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source, role, automation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, 'scratch', `Thread ${n}`, 'done', id, h.tmp, o.automation ? 'automation' : 'manual', role, o.automation ?? null,
  );
  events.add(id, 'user', { text: 'We need a role for store migrations.', source: o.automation ? 'manual' : 'ben' });
  return id;
}
const benAgrees = (id: string) => events.add(id, 'user', { text: 'Yes, make it.', source: 'ben' });

/** The omni server the thread's role gets, started the way a harness starts it (apps/server/sandbox.ts). */
async function connect(threadId: string) {
  const role = getCrew(h.db.threads.get(threadId)!.role);
  const cfg = buildMcpConfig({ threadId, channel: h.db.channels.get('scratch')!, browserBusy: false, omniUrl, role });
  const s = cfg.mcpServers['omni'];
  if (!s) throw new Error(`role ${role?.id} gets no omni server`);
  const client = new McpClient(spawn(s.command, s.args, { env: { ...(process.env as Record<string, string>), ...s.env }, stdio: ['pipe', 'pipe', 'inherit'] }));
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

const settingsCrew = async () => (await (await app.request('/api/crew?all=1')).json()) as any[];

const migrations = {
  id: 'store-migrations',
  create: true,
  fields: { name: 'Store migrations', description: 'Moves a store onto Shopify: products, customers, redirects.', channel: 'scratch' },
  charter: 'You move stores onto Shopify. Dry run every import first and report the counts.',
};

describe('the Conductor crew tools', () => {
  const conductor = thread('conductor');

  it("are in the Conductor's tool list, with no tool to delete, hide or duplicate a role", T, async () => {
    const { tools } = (await (await connect(conductor)).request('tools/list')) as { tools: { name: string; description: string }[] };
    const names = tools.map((t) => t.name);
    for (const name of ['list_crew', 'get_crew_role', 'save_crew_role', 'reset_crew_role', 'send_to_grok_bot']) expect(names).toContain(name);
    expect(names.filter((t) => /crew/.test(t) && /delete|hide|duplicate/.test(t))).toEqual([]);
    expect(tools.find((t) => t.name === 'save_crew_role')!.description).toMatch(/^Create an agent or change one, only once .+ agreed in this thread/);
  });

  it('create a role once Ben agreed, with no powers, which list_crew and Settings > Crew then show and sync sends', T, async () => {
    const relay = new MemoryTransport();
    const worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    await sync.setActiveWorker(worker);
    const client = await connect(conductor);

    const early = await tool(client, 'save_crew_role', migrations);
    expect(early.isError).toBe(true);
    expect(early.body).toMatch(/^Not yet: propose the change to .+ in this thread, and save it once they agree\.$/);
    expect(existsSync(ownPath('store-migrations'))).toBe(false);

    benAgrees(conductor);
    const made = await tool(client, 'save_crew_role', migrations);
    expect(made.isError, made.body).toBe(false);
    expect(made.body).toMatchObject({
      id: 'store-migrations',
      name: 'Store migrations',
      kind: 'own',
      default_channel: 'scratch',
      powers: { mcp: [], delegate_only: false, delegatable: true, review: false },
      charters: { built_in: null, own: migrations.charter, effective: migrations.charter },
    });
    // The file names no power: a new role has the defaults every role has without one.
    expect(readFileSync(ownPath('store-migrations'), 'utf8')).toBe(
      `---\nname: Store migrations\ndescription: "Moves a store onto Shopify: products, customers, redirects."\nchannel: scratch\n---\n${migrations.charter}\n`,
    );

    const listed = await tool(client, 'list_crew');
    expect(listed.body).toContainEqual({ id: 'store-migrations', name: 'Store migrations', description: migrations.fields.description, default_channel: 'scratch' });
    expect((await settingsCrew()).find((r) => r.id === 'store-migrations')).toMatchObject({ kind: 'own', hidden: false, delegatable: true, review: false, mcp: [], delegateOnly: false });

    expect((await worker.syncNow()).error).toBeUndefined();
    const sent = relay.changes.filter((c) => c.entity === 'crew_file' && c.entity_id === 'store-migrations');
    expect(sent).toMatchObject([{ op: 'upsert', data: { markdown: readFileSync(ownPath('store-migrations'), 'utf8') } }]);
  });

  it("edit a role, add to a built-in's charter and reset the built-in", T, async () => {
    const client = await connect(conductor);
    const edited = await tool(client, 'save_crew_role', { id: 'store-migrations', fields: { description: 'Moves stores onto Shopify.' } });
    expect(edited.body).toMatchObject({ description: 'Moves stores onto Shopify.', charters: { own: migrations.charter } });

    const added = await tool(client, 'save_crew_role', { id: 'builder', charter: 'Run the linter before you push.' });
    expect(added.body).toMatchObject({ kind: 'edited', charter_mode: 'append', charters: { built_in: 'You write and ship code.', own: 'Run the linter before you push.' } });
    expect((await tool(client, 'get_crew_role', { id: 'builder' })).body.charters.effective).toBe('You write and ship code.\n\nRun the linter before you push.');

    expect((await tool(client, 'reset_crew_role', { id: 'builder' })).body).toMatchObject({ kind: 'shipped', charters: { own: null } });
    expect(existsSync(ownPath('builder'))).toBe(false);
    const own = await tool(client, 'reset_crew_role', { id: 'store-migrations' });
    expect(own).toMatchObject({ isError: true, body: 'Only an edited built-in agent can be reset.' });
    expect((await tool(client, 'save_crew_role', { id: 'builder' })).body).toMatch(/^Pass the fields, charter or charter_mode to change\.$/);
  });

  it("refuse every power, on a new role and on one that exists, and leave the files as they were", T, async () => {
    const client = await connect(conductor);
    const before = readFileSync(ownPath('store-migrations'), 'utf8');
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...migrations, id: 'router', fields: { name: 'Router', mcp: ['omni'] } }, /^mcp is .+'s to set, in Settings\. Leave it out of the save\.$/],
      [{ id: 'store-migrations', fields: { delegate_only: true } }, /^delegate_only is .+'s to set, in Settings\./],
      [{ id: 'store-migrations', fields: { delegatable: false } }, /^delegatable is .+'s to set, in Settings\./],
      [{ id: 'builder', fields: { review: true, mcp: ['omni'] } }, /^mcp, review are .+'s to set, in Settings\. Leave them out of the save\.$/],
      [{ id: 'reviewer', fields: { review: false } }, /^review is .+'s to set, in Settings\./],
    ];
    for (const [args, refusal] of cases) {
      const res = await tool(client, 'save_crew_role', args);
      expect(res.isError, JSON.stringify(args)).toBe(true);
      expect(res.body).toMatch(refusal);
    }
    expect(getCrew('router')).toBeUndefined();
    expect(readFileSync(ownPath('store-migrations'), 'utf8')).toBe(before);
    expect(existsSync(ownPath('builder'))).toBe(false);
    expect(existsSync(ownPath('reviewer'))).toBe(false);
  });

  it("keep the Conductor, usage-scan and reviewer locks, and refuse a reset that undoes Ben's powers", T, async () => {
    const client = await connect(conductor);
    // The Conductor's and usage-scan's locked fields are powers, so the guard refuses them before the lock does.
    expect((await tool(client, 'save_crew_role', { id: 'conductor', fields: { delegate_only: false } })).body).toMatch(/^delegate_only is /);
    expect((await tool(client, 'save_crew_role', { id: 'usage-scan', fields: { mcp: [] } })).body).toMatch(/^mcp is /);
    // usage-scan's charter can only be added to.
    const replace = await tool(client, 'save_crew_role', { id: 'usage-scan', charter: 'Scan less.', charter_mode: 'replace' });
    expect(replace).toMatchObject({ isError: true, body: expect.stringMatching(/^Add to the built-in only: the scan's steps come with each release\. Save your text as an addition/) });
    expect(existsSync(ownPath('usage-scan'))).toBe(false);
    // A reserved id is never a role of the user's own, and a role that exists is never made again.
    expect((await tool(client, 'save_crew_role', { ...migrations, id: 'reviewer', fields: { name: 'Mine' } })).body).toBe('An agent "reviewer" already exists.');
    expect((await tool(client, 'save_crew_role', migrations)).body).toBe('An agent "store-migrations" already exists.');
    // Adding to a locked role's charter is allowed, and every lock still holds after it.
    const added = await tool(client, 'save_crew_role', { id: 'conductor', charter: 'Reply in Dutch.' });
    expect(added.body).toMatchObject({ charter_mode: 'append', powers: { mcp: ['omni'], delegate_only: true, delegatable: false }, locks: { fields: { delegate_only: expect.any(String) } } });
    expect((await tool(client, 'reset_crew_role', { id: 'conductor' })).isError).toBe(false);

    // Ben gives the builder routing powers in his overlay: the Conductor's reset would undo them, so it is refused.
    expect((await app.request('/api/crew/builder', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: { mcp: ['omni'], delegate_only: true } }) })).status).toBe(200);
    expect((await tool(client, 'reset_crew_role', { id: 'builder' })).body).toMatch(/^Resetting Builder would change its mcp, delegate_only, which are .+'s to set\. Ask .+ to reset it in Settings\.$/);
    expect(getCrew('builder')).toMatchObject({ kind: 'edited', delegateOnly: true });
    expect((await app.request('/api/crew/builder/reset', { method: 'POST' })).status).toBe(200);
  });

  it('refuse a Conductor an automation started, and a role of Ben with the conductor tools', T, async () => {
    const run = thread('conductor', { automation: 'nightly' });
    benAgrees(run);
    const fromRun = await tool(await connect(run), 'save_crew_role', { ...migrations, id: 'nightly-role' });
    expect(fromRun.body).toMatch(/^This thread runs under the automation "nightly"/);

    expect((await app.request('/api/crew', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'dispatcher', fields: { name: 'Dispatcher', mcp: ['omni'], delegate_only: true } }) })).status).toBe(201);
    const dispatcher = thread('dispatcher');
    benAgrees(dispatcher);
    const fromDispatcher = await tool(await connect(dispatcher), 'save_crew_role', { ...migrations, id: 'dispatched-role' });
    expect(fromDispatcher.body).toMatch(/^Agents change from Settings, or from the Conductor once .+ agrees in its thread\.$/);
    expect(getCrew('nightly-role')).toBeUndefined();
    expect(getCrew('dispatched-role')).toBeUndefined();
  });

  it('say what an agent looks like, its default shape and color included', T, async () => {
    const client = await connect(conductor);
    // A built-in takes its own shape and the color paired with it (ADR 0021, D2).
    expect((await tool(client, 'get_crew_role', { id: 'builder' })).body.avatar).toEqual({ shows: 'character', shape: 'squircle', color: 'Amber' });
  });

  it("restyle an agent once Ben agreed: a shape, and a color by its name or hex", T, async () => {
    const client = await connect(conductor);
    const saved = await tool(client, 'save_crew_role', { id: 'store-migrations', fields: { avatar: { shape: 'droplet', bg: 'sky' } } });
    expect(saved.isError, saved.body).toBe(false);
    expect(saved.body.avatar).toEqual({ shows: 'character', shape: 'droplet', color: 'Sky' });
    expect(readFileSync(ownPath('store-migrations'), 'utf8')).toContain('avatar:\n  shape: droplet\n  bg: "#52cdfe"\n');
    expect((await settingsCrew()).find((r) => r.id === 'store-migrations').avatar).toEqual({ shape: 'droplet', bg: '#52cdfe' });

    // A hex outside the palette is the agent's own color; the shape stays as it was.
    const custom = await tool(client, 'save_crew_role', { id: 'store-migrations', fields: { avatar: { bg: '#3A7D5C' } } });
    expect(custom.body.avatar).toEqual({ shows: 'character', shape: 'droplet', color: '#3a7d5c' });
    // An empty string removes the key, so the shape's own color comes back.
    expect((await tool(client, 'save_crew_role', { id: 'store-migrations', fields: { avatar: { bg: '' } } })).body.avatar).toEqual({ shows: 'character', shape: 'droplet', color: 'Sky' });
  });

  it('refuse a shape or a color it does not know, with the ones it does, and an icon or photo, which stay Ben\'s', T, async () => {
    const client = await connect(conductor);
    const before = readFileSync(ownPath('store-migrations'), 'utf8');
    const shape = await tool(client, 'save_crew_role', { id: 'store-migrations', fields: { avatar: { shape: 'hexagon' } } });
    expect(shape).toMatchObject({ isError: true, body: expect.stringMatching(/^An avatar shape is one of circle, droplet, squircle, .*, bucket\.$/) });
    const color = await tool(client, 'save_crew_role', { id: 'store-migrations', fields: { avatar: { shape: 'cloud', bg: 'Crimson' } } });
    expect(color).toMatchObject({ isError: true, body: expect.stringMatching(/^"Crimson" is not an agent color\. Name one of Ink, Sky, Amber, .*, Peach, or give a hex like #52cdfe\.$/) });
    for (const avatar of [{ icon: 'icon:tool' }, { image: 'data:image/png;base64,AAAA' }]) {
      const res = await tool(client, 'save_crew_role', { id: 'store-migrations', fields: { avatar } });
      expect(res, JSON.stringify(avatar)).toMatchObject({ isError: true, body: expect.stringMatching(/An agent's icon, emoji and photo are .+'s to set, in Settings > Agents\. Send only shape and bg\./) });
    }
    expect(readFileSync(ownPath('store-migrations'), 'utf8')).toBe(before);
  });

  it('say when an icon or a photo Ben set shows instead of the character', T, async () => {
    const client = await connect(conductor);
    const settings = (path: string, body: unknown) => app.request(`/api/crew/store-migrations${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await settings('', { fields: { avatar: { icon: 'icon:tool', bg: '#ffdc4f' } } })).status).toBe(200);
    expect((await tool(client, 'get_crew_role', { id: 'store-migrations' })).body.avatar).toEqual({ shows: 'icon', shape: 'droplet', color: 'Sun' });
    expect((await settings('/avatar', { image: png(64, 64).url })).status).toBe(200);
    expect((await tool(client, 'get_crew_role', { id: 'store-migrations' })).body.avatar).toEqual({ shows: 'photo', shape: 'droplet', color: 'Sun' });
  });
});

// Agents are "agents" in every other tool (seat_agents, message_thread's `agents`), so Conductors called delegate with
// `agent` and get_crew_role with `role` and got a schema error back (tool-failure triage, 2026-11-25). Both now take it.
describe('the agent id under the name a Conductor reaches for', () => {
  const conductor = thread('conductor');

  it('get_crew_role reads the agent from id, role or agent, and asks for one when none is given', T, async () => {
    const client = await connect(conductor);
    for (const args of [{ id: 'builder' }, { role: 'builder' }, { agent: 'builder' }]) {
      const res = await tool(client, 'get_crew_role', args);
      expect(res.isError, JSON.stringify(args)).toBe(false);
      expect(res.body.id).toBe('builder');
    }
    expect(await tool(client, 'get_crew_role', {})).toMatchObject({ isError: true, body: expect.stringMatching(/Name the agent/) });
  });

  it('delegate runs the thread as the agent passed as agent, as it does for role', T, async () => {
    const client = await connect(conductor);
    const made = await tool(client, 'delegate', { channel: 'scratch', agent: 'builder', prompt: 'Goal: say hi. Done when: you said it. Proof back: the word.' });
    expect(made.isError, JSON.stringify(made.body)).toBe(false);
    expect(made.body.role).toBe('builder');
    expect(h.db.threads.get(made.body.thread_id)?.role).toBe('builder');
    expect(await tool(client, 'delegate', { channel: 'scratch', prompt: 'Goal: nothing.' })).toMatchObject({ isError: true, body: expect.stringMatching(/Name the agent/) });
  });
});
