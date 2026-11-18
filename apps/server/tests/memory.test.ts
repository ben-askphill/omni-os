import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { MemoryTransport, type Change } from '../sync/transport.ts';
import { rawPublicKey } from '../sync/signing.ts';
import { keyOf, signAs } from './sync-sign.ts';

// Channel learnings (memory-api.ts, db/repos/memories.ts): the user adds and approves, an agent only proposes and only
// for its own channel (the Conductor for any), approved lessons reach every thread in that channel's prompt and no
// other channel's, and the rows sync to the other machines as a signed action entity.

const r = await startRunner();
const { app } = await import('../app.ts');
const { buildSystemPrompt } = await import('../runner/prompts.ts');
const { isActionChange } = await import('../sync/verify.ts');
const sync = await import('../sync/worker.ts');
const { db, channels, memories } = r.db;

channels.create({ id: 'acme', name: 'Acme', kind: 'client', use_worktree: 0 } as never);
channels.create({ id: 'globex', name: 'Globex', kind: 'client', use_worktree: 0 } as never);

const call = async (method: string, path: string, body?: unknown, caller?: string) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(caller && { 'x-omni-thread': caller }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

let n = 0;
function thread(channel: string, role: string | null = null) {
  const id = `mem${++n}`;
  db.prepare('INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, channel, `T${n}`, 'done', id, r.tmp, 'manual', role);
  return id;
}
const feed: any[] = [];
r.bus.on('feed', (e: any) => feed.push(e));

describe('the learnings API', () => {
  it('saves what the user adds as approved, and lists a channel with proposals first', async () => {
    const added = await call('POST', '/memory', { channel: 'acme', text: '  Quote prices   without VAT. ' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ channel_id: 'acme', role: null, text: 'Quote prices without VAT.', status: 'approved', proposed_by: 'user', source_thread_id: null });
    expect(feed).toContainEqual({ type: 'memory', channel_id: 'acme' });

    const builder = thread('acme', 'builder');
    const proposed = await call('POST', '/memory', { channel: 'acme', text: 'Run the theme check before pushing.' }, builder);
    expect(proposed.body).toMatchObject({ status: 'proposed', proposed_by: 'agent', source_thread_id: builder });

    const list = await call('GET', '/memory?channel=acme');
    expect(list.body.waiting).toBe(1);
    expect(list.body.learnings.map((m: any) => m.status)).toEqual(['proposed', 'approved']);
  });

  it("keeps an agent to its own channel, while the Conductor proposes for any", async () => {
    const builder = thread('acme', 'builder');
    expect((await call('POST', '/memory', { channel: 'globex', text: 'Acme uses Klaviyo.' }, builder)).status).toBe(403);
    const conductor = thread('conductor', 'conductor');
    expect((await call('POST', '/memory', { channel: 'globex', text: 'Globex writes in British English.' }, conductor)).body.status).toBe('proposed');
    expect((await call('POST', '/memory', { channel: 'globex', text: 'x' }, 'no-such-thread')).status).toBe(403);
  });

  it('lets only the user approve, edit or delete', async () => {
    const builder = thread('acme', 'builder');
    const { body: m } = await call('POST', '/memory', { channel: 'acme', text: 'Ask before touching checkout.' }, builder);
    expect((await call('PATCH', `/memory/${m.id}`, { approve: true }, builder)).status).toBe(403);
    expect((await call('DELETE', `/memory/${m.id}`, undefined, builder)).status).toBe(403);

    const approved = await call('PATCH', `/memory/${m.id}`, { approve: true });
    expect(approved.body).toMatchObject({ status: 'approved' });
    expect(approved.body.approved_at).toBeTruthy();
    // Editing a proposal is the user's word on it, so it approves it too.
    const { body: p } = await call('POST', '/memory', { channel: 'acme', text: 'Draft' }, builder);
    expect((await call('PATCH', `/memory/${p.id}`, { text: 'Draft in Dutch.' })).body).toMatchObject({ text: 'Draft in Dutch.', status: 'approved' });
    expect((await call('DELETE', `/memory/${p.id}`)).status).toBe(200);
    expect(memories.get(p.id)).toBeNull();
  });

  it('masks secrets and refuses bad input', async () => {
    const { body } = await call('POST', '/memory', { channel: 'acme', text: 'The staging key is sk-abcdefghijklmnopqrstuvwxyz123456.' });
    expect(body.text).toBe('The staging key is [masked].');
    expect((await call('POST', '/memory', { channel: 'acme', text: '' })).status).toBe(400);
    expect((await call('POST', '/memory', { channel: 'nope', text: 'x' })).status).toBe(404);
    expect((await call('GET', '/memory?channel=nope')).status).toBe(404);
    expect((await call('PATCH', '/memory/nope', { approve: true })).status).toBe(404);
  });
});

describe('the prompt', () => {
  it("gives a thread its own channel's approved lessons, never another channel's or a proposal", () => {
    const acme = buildSystemPrompt(r.thread(thread('acme')), channels.get('acme')!);
    expect(acme).toContain('## Recent learnings in this channel');
    expect(acme).toContain('- Quote prices without VAT.');
    expect(acme).not.toContain('Run the theme check before pushing.');
    expect(acme).not.toContain('British English');
    const globex = buildSystemPrompt(r.thread(thread('globex')), channels.get('globex')!);
    expect(globex).not.toContain('Quote prices');
    expect(globex).not.toContain('## Recent learnings');
  });
});

describe('learnings across machines', () => {
  const relay = new MemoryTransport();
  let k = 0;
  const at = () => new Date(Date.now() + 1_000 + k++).toISOString();
  const change = (id: string, data: unknown, op: Change['op'] = 'upsert'): Change => ({ machine_id: 'mac-b', entity: 'memory', entity_id: id, op, data, ts: at() });
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id, channel_id: 'acme', role: null, text: 'From the other machine.', status: 'approved', proposed_by: 'user', source_thread_id: null,
    created_at: at(), updated_at: at(), approved_at: at(), ...over,
  });

  it('is an action entity, so only a signed change from a trusted machine applies', () => {
    expect(isActionChange({ entity: 'memory', entity_id: 'x' })).toBe(true);
  });

  it('sends what this machine writes, applies a signed row, holds an unsigned one and drops one that does not parse', async () => {
    const worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    await sync.setActiveWorker(worker);
    const mine = memories.create({ channel_id: 'acme', text: 'Sent from A.', status: 'approved', proposed_by: 'user' });
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(relay.changes.find((c) => c.entity === 'memory' && c.entity_id === mine.id)?.data).toMatchObject({ text: 'Sent from A.', channel_id: 'acme' });

    const device = signAs({ machine_id: 'mac-b', entity: 'kv', entity_id: 'devices.mac-b', op: 'upsert', ts: at(), data: { value: { id: 'mac-b', name: 'Mac B', tailscale: null, signKey: rawPublicKey(keyOf('mac-b')), at: at() } } });
    await relay.push([device, change('unsigned', row('unsigned'))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(memories.get('unsigned')).toBeNull();

    feed.length = 0;
    await relay.push([signAs(change('from-b', row('from-b'))), signAs(change('bad', row('bad', { text: '', status: 'maybe' })))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(memories.get('from-b')).toMatchObject({ text: 'From the other machine.', status: 'approved', channel_id: 'acme' });
    expect(memories.get('bad')).toBeNull();
    expect(feed).toContainEqual({ type: 'memory', channel_id: 'acme' });

    await relay.push([signAs(change('from-b', null, 'delete'))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(memories.get('from-b')).toBeNull();
  });
});
