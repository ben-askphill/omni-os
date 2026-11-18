import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { MemoryTransport, type Change } from '../sync/transport.ts';
import { rawPublicKey } from '../sync/signing.ts';
import { signAs } from './sync-sign.ts';

// Crew roles across machines and agents (plan slice S2). The user's crew files go to the other machines as a signed
// action entity, last writer wins; hiding stays on one machine. And an agent thread's write to /api/crew goes through
// the crew guard: only the Conductor saves or resets a role, never its powers, only after Ben answered in its thread
// (and its own calls never count as his answer), never under an automation, and never deletes or hides one.

const home = mkdtempSync(join(tmpdir(), 'omni-crew-sync-home-'));
const r = await startRunner({ HOME: home });
const { app } = await import('../app.ts');
const { paths } = await import('../config.ts');
const { getCrew } = await import('../crew.ts');
const sync = await import('../sync/worker.ts');
const { SEED_TS } = await import('../db.ts');
const { db, events } = r.db;

const shipped = mkdtempSync(join(tmpdir(), 'omni-crew-sync-shipped-'));
paths.crew = shipped;
const ship = (id: string, text: string) => writeFileSync(join(shipped, `${id}.md`), text);
const ownPath = (id: string) => join(paths.personalCrew, `${id}.md`);
ship('conductor', '---\nname: Conductor\nchannel: conductor\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nRoute everything.\n');
ship('usage-scan', '---\nname: Usage scan\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nScan.\n');
ship('builder', '---\nname: Builder\nmodel: auto\n---\nYou write and ship code.\n');
// Written by hand before this machine synced crew files: the first sync sends it once, as a seed.
mkdirSync(paths.personalCrew, { recursive: true });
writeFileSync(ownPath('by-hand'), '---\nname: By hand\n---\nMade in an editor.\n');

const call = async (method: string, path: string, body?: unknown, caller?: string) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(caller && { 'x-omni-thread': caller }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

let n = 0;
function thread(o: { role?: string | null; automation?: string | null; parent?: string | null; source?: string } = {}) {
  const id = `c${++n}`;
  db.prepare(
    `INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source, role, automation, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 'inbox', `Thread ${n}`, 'done', id, r.tmp, o.source ?? 'manual', o.role ?? null, o.automation ?? null, o.parent ?? null);
  return id;
}

describe('agent writes to /api/crew', () => {
  const conductor = thread({ role: 'conductor' });
  events.add(conductor, 'user', { text: 'Make the builder run the linter before it pushes.', source: 'ben' });
  const builder = thread({ role: 'builder', source: 'conductor', parent: conductor });
  const plain = thread();
  const scan = thread({ role: 'usage-scan' });
  const run = thread({ role: 'conductor', source: 'automation', automation: 'nightly' });
  const below = thread({ role: 'builder', source: 'conductor', parent: run });
  for (const t of [scan, run, below]) {
    events.add(t, 'user', { text: 'Start.', source: 'manual' });
    events.add(t, 'user', { text: 'Yes, save it.', source: 'ben' });
  }
  const edit = { charter: 'Run the linter before you push.' };

  it('refuses every thread but the Conductor, whatever Ben said in it', async () => {
    for (const caller of [builder, plain, below, 'no-such-thread']) {
      const { status, body } = await call('PUT', '/crew/builder', edit, caller);
      expect(status).toBe(403);
      expect(body.error).toMatch(/^(Crew roles change from Settings|This thread runs under the automation)/);
    }
    expect((await call('PUT', '/crew/builder', edit, scan)).body.error).toBe('A usage scan cannot change crew roles.');
    expect((await call('POST', '/crew', { id: 'from-agent', fields: { name: 'From an agent' } }, builder)).status).toBe(403);
    expect(existsSync(ownPath('builder'))).toBe(false);
    expect(getCrew('from-agent')).toBeUndefined();
  });

  it('refuses a Conductor that an automation started', async () => {
    const { status, body } = await call('PUT', '/crew/builder', edit, run);
    expect(status).toBe(403);
    expect(body.error).toMatch(/automation "nightly"/);
  });

  it('holds the Conductor until Ben answers in its thread, then lets it save and reset', async () => {
    const early = await call('PUT', '/crew/builder', edit, conductor);
    expect(early.status).toBe(403);
    expect(early.body.error).toMatch(/^Not yet: propose the change to .+ in this thread, and save it once they agree\.$/);
    expect(existsSync(ownPath('builder'))).toBe(false);

    events.add(conductor, 'user', { text: 'Yes, do it.', source: 'ben' });
    const saved = await call('PUT', '/crew/builder', edit, conductor);
    expect(saved.status).toBe(200);
    expect(getCrew('builder')?.charter).toBe('You write and ship code.\n\nRun the linter before you push.');
    expect((await call('POST', '/crew/builder/reset', undefined, conductor)).status).toBe(200);
    expect(existsSync(ownPath('builder'))).toBe(false);
  });

  it('never lets an agent delete, hide or show a role', async () => {
    await call('POST', '/crew', { id: 'scratch', fields: { name: 'Scratch' } });
    for (const [method, path, body] of [
      ['DELETE', '/crew/scratch', undefined],
      ['POST', '/crew/builder/hidden', { hidden: true }],
      ['POST', '/crew/builder/hidden', { hidden: false }],
    ] as const) {
      const res = await call(method, path, body, conductor);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/(deletes|hides or shows) crew roles, in Settings\.$/);
    }
    expect(getCrew('scratch')).toBeDefined();
    expect(getCrew('builder')?.hidden).toBe(false);
    expect((await call('DELETE', '/crew/scratch')).status).toBe(200);
  });

  it("never counts the Conductor's own calls as Ben's answer", async () => {
    const self = thread({ role: 'conductor' });
    events.add(self, 'user', { text: 'Tidy up the builder charter.', source: 'ben' });
    // Its comments tool and a message it sends to its own thread are recorded as its own, not Ben's.
    expect((await call('POST', `/threads/${self}/published/comments`, { url: 'https://claude.ai/artifact/abc123' }, self)).status).toBe(200);
    expect((await call('POST', `/threads/${self}/messages`, { prompt: 'Yes, save it.', from: 'ben', wake_cold: true }, self)).status).toBe(200);
    const sources = (db.prepare(`SELECT source FROM message_requests WHERE thread_id = ? ORDER BY seq`).all(self) as { source: string }[]).map((r) => r.source);
    expect(sources).toEqual(['conductor', 'conductor']);
    // Nor can it answer a question for Ben.
    const answered = await call('POST', `/threads/${self}/questions/q1/answer`, { answers: [{ 'Save it?': 'Yes' }] }, self);
    expect(answered.status).toBe(403);
    expect(answered.body.error).toMatch(/answers a question, on its card\.$/);
    const res = await call('PUT', '/crew/builder', edit, self);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/^Not yet/);
  });

  it("never lets the Conductor set a role's powers, or a role with the conductor tools edit roles", async () => {
    const powers = await call('PUT', '/crew/builder', { fields: { mcp: ['omni'] } }, conductor);
    expect(powers.status).toBe(403);
    expect(powers.body.error).toMatch(/^mcp is .+'s to set, in Settings\. Leave it out of the save\.$/);
    expect((await call('PUT', '/crew/builder', { fields: { delegate_only: true, delegatable: false } }, conductor)).body.error).toMatch(/^delegate_only, delegatable are /);
    expect((await call('POST', '/crew', { id: 'router', fields: { name: 'Router', mcp: ['omni'] } }, conductor)).status).toBe(403);
    const md = await call('PUT', '/crew/builder', { markdown: '---\nmcp: [omni]\n---\nRoute.\n' }, conductor);
    expect(md.status).toBe(403);
    expect(md.body.error).toMatch(/^Send the fields and charter to change, not the whole file/);
    expect(existsSync(ownPath('builder'))).toBe(false);

    // Ben gives his own router role the conductor tools: its threads still cannot edit roles.
    expect((await call('POST', '/crew', { id: 'dispatcher', fields: { name: 'Dispatcher', mcp: ['omni'], delegate_only: true } })).status).toBe(201);
    const dispatcher = thread({ role: 'dispatcher' });
    events.add(dispatcher, 'user', { text: 'Start.', source: 'ben' });
    events.add(dispatcher, 'user', { text: 'Yes.', source: 'ben' });
    expect((await call('PUT', '/crew/builder', edit, dispatcher)).status).toBe(403);
    await call('DELETE', '/crew/dispatcher');
  });

  it('a question the Conductor asked and Ben answered counts as his answer', async () => {
    const asked = thread({ role: 'conductor' });
    events.add(asked, 'user', { text: 'Tidy up the reviewer charter.', source: 'ben' });
    expect((await call('PUT', '/crew/builder', edit, asked)).status).toBe(403);
    events.add(asked, 'question_answer', { id: 'q1', answers: { 'Save this edit?': 'Yes' } });
    expect((await call('PUT', '/crew/builder', edit, asked)).status).toBe(200);
    await call('POST', '/crew/builder/reset');
  });
});

describe('crew files across machines', () => {
  const relay = new MemoryTransport();
  let worker: ReturnType<typeof sync.createSyncWorker>;
  let k = 0;
  const at = () => new Date(Date.now() + 1_000 + k++).toISOString();
  const file = (id: string, data: unknown, op: Change['op'] = 'upsert', ts = at()): Change => ({ machine_id: 'mac-b', entity: 'crew_file', entity_id: id, op, data, ts });
  const sent = (id: string) => relay.changes.filter((c) => c.entity === 'crew_file' && c.entity_id === id);

  it('sends a file written by hand once, as a seed', async () => {
    worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    await sync.setActiveWorker(worker);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(sent('by-hand')).toMatchObject([{ op: 'upsert', ts: SEED_TS, data: { markdown: '---\nname: By hand\n---\nMade in an editor.\n' } }]);
    // A second worker on the same data does not seed again.
    sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(sent('by-hand')).toHaveLength(1);
  });

  it('sends a save, a reset and a delete, and keeps hiding on this machine', async () => {
    await call('PUT', '/crew/builder', { fields: { model: 'opus' }, charter: 'Use pnpm.' });
    await call('POST', '/crew', { id: 'store-ops', fields: { name: 'Store ops' }, charter: 'Dry run first.' });
    await call('POST', '/crew/builder/hidden', { hidden: true });
    expect((await worker.syncNow()).error).toBeUndefined();
    expect((sent('builder').at(-1)!.data as any).markdown).toContain('model: opus');
    expect((sent('store-ops').at(-1)!.data as any).markdown).toContain('Dry run first.');

    await call('POST', '/crew/builder/hidden', { hidden: false });
    await call('POST', '/crew/builder/reset');
    await call('DELETE', '/crew/store-ops');
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(sent('builder').at(-1)!.op).toBe('delete');
    expect(sent('store-ops').at(-1)!.op).toBe('delete');
    expect(relay.changes.some((c) => c.entity === 'kv' && c.entity_id.includes('crew'))).toBe(false);
  });

  it('writes a file a trusted machine signed, and holds one nobody signed', async () => {
    const record = signAs({ machine_id: 'mac-b', entity: 'kv', entity_id: 'devices.mac-b', op: 'upsert', ts: at(), data: { value: { id: 'mac-b', name: "Ben's MacBook Pro", tailscale: null, signKey: rawPublicKey((await import('./sync-sign.ts')).keyOf('mac-b')), at: at() } } });
    const markdown = '---\nname: Researcher B\ndescription: From the other machine.\n---\nCite every source.\n';
    // Unsigned: a role is a prompt every later thread runs with, so a file nobody signed is held, never written.
    await relay.push([record, file('unsigned', { markdown })]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(existsSync(ownPath('unsigned'))).toBe(false);

    await relay.push([signAs(file('from-b', { markdown })), signAs(file('../evil', { markdown }))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(readFileSync(ownPath('from-b'), 'utf8')).toBe(markdown);
    expect(existsSync(join(paths.personalCrew, '..', 'evil.md'))).toBe(false);
    expect(getCrew('from-b')).toMatchObject({ name: 'Researcher B', kind: 'own', charter: 'Cite every source.' });

    // An overlay on a built-in lands as an overlay.
    await relay.push([signAs(file('builder', { markdown: '---\ncharter_mode: append\n---\nUse pnpm.\n' }))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(getCrew('builder')).toMatchObject({ kind: 'edited', charter: 'You write and ship code.\n\nUse pnpm.' });

    await relay.push([signAs(file('from-b', null, 'delete'))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(getCrew('from-b')).toBeUndefined();
  });

  it("never lets a seed replace this machine's own file", async () => {
    await relay.push([signAs(file('by-hand', { markdown: '---\nname: Theirs\n---\nOther text.\n' }, 'upsert', SEED_TS))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(getCrew('by-hand')?.name).toBe('By hand');
    // A real write from the other machine does replace it.
    await relay.push([signAs(file('by-hand', { markdown: '---\nname: Theirs\n---\nOther text.\n' }))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(getCrew('by-hand')?.name).toBe('Theirs');
  });
});
