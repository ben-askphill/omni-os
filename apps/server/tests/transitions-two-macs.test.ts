import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// A relocate through the transition service's four routes, between two Macs: a Take over asked on B and cancelled
// there, then a handoff from A read and cancelled on A before B picks it up. Two real servers in one process with fake
// claude and one in-memory relay (as takeover-two-macs.test.ts); the records the moves write are the handoff kv
// records, so a Mac on an older build sees the same thing it always did.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'mac-a.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'mac-b.tail1234.ts.net' };
const MAC_A = { id: 'mac-a', name: 'Mac A' };
const MAC_B = { id: 'mac-b', name: 'Mac B' };
const shared = mkdtempSync(join(tmpdir(), 'omni-transitions-shop-'));
afterAll(() => rmSync(shared, { recursive: true, force: true }));
afterAll(async () => {
  for (const m of [a, b]) {
    for (const t of m.db.threads.running().filter((r) => m.runner.isLive(r.id))) {
      await m.json(`/threads/${t.id}/stop`, { body: {} });
      await waitFor(() => !m.runner.isLive(t.id), 'the turn to stop');
      await m.files.turnFinished(t.id);
    }
  }
}, 30_000);
const T = { timeout: 30_000 };

let a: Mac;
let b: Mac;
let id: string;

const sessionFile = (m: Mac, t: { cwd: string; session_id: string }) =>
  join(m.home, '.claude', 'projects', m.files.claudeProjectDir(t.cwd), `${t.session_id}.jsonl`);
const write = (path: string, body: string) => (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, body));
const preview = (m: Mac, req: object) => m.json(`/threads/${id}/transitions/preview`, { body: req });
const create = (m: Mac, req: object) => m.json(`/threads/${id}/transitions`, { body: req });
const read = (m: Mac, tid: string) => m.json(`/threads/${id}/transitions/${tid}`);
const cancel = (m: Mac, tid: string) => m.json(`/threads/${id}/transitions/${tid}/cancel`, { body: {} });
const request = (m: Mac) => m.db.kv.get<any>(`handoff.request.${id}`);
const offer = (m: Mac) => m.db.kv.get<any>(`handoff.offer.${id}`);
const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
};

beforeAll(async () => {
  a = await bootMac('mac-a', 'Mac A', relay);
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shared, notes: '' });
  const t = await a.runner.createThread({ channel: 'shop', prompt: 'TOOL:60000 audit the checkout', title: 'Audit the checkout' });
  id = t.id;
  await a.untilTool(id);
  write(sessionFile(a, a.thread(id)), '{"type":"user","from":"mac-a"}\n');

  b = await bootMac('mac-b', 'Mac B', relay);
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await a.sync();
}, 60_000);

describe('a Take over asked on B', () => {
  let tid: string;

  it('previews from both sides', async () => {
    expect((await preview(b, { kind: 'relocate', to: 'here' })).body).toEqual({ kind: 'relocate', from: MAC_A, to: MAC_B, blocked: null, running: true, takeover: true });
    expect((await preview(a, { kind: 'relocate', to: 'mac-b' })).body).toEqual({ kind: 'relocate', from: MAC_A, to: MAC_B, blocked: null, running: true, takeover: false });
    expect((await preview(a, { kind: 'relocate', to: 'here' })).body).toMatchObject({ takeover: true, blocked: 'This thread is on this Mac already.' });
    expect((await preview(b, { kind: 'relocate', to: 'mac-a' })).body).toMatchObject({ takeover: false, blocked: 'This thread is on Mac A. Take it over instead.' });
  });

  it('is the request record, read as requested', async () => {
    const res = await create(b, { kind: 'relocate', to: 'here' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'relocate', thread_id: id, state: 'requested', error: null, from: MAC_A, to: MAC_B, handoff: { requested: true, state: { phase: 'requested' } } });
    tid = res.body.id;
    expect(request(b)).toMatchObject({ id: tid, by: MAC_B, from: MAC_A, state: 'pending' });
    expect((await read(b, tid)).body).toMatchObject({ id: tid, state: 'requested' });
    // Asked once, however often Ben clicks.
    const again = await create(b, { kind: 'relocate', to: 'here' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('This thread is already on its way between Macs.');
  });

  it('is cancelled before A answers, so A keeps its turn', T, async () => {
    const res = await cancel(b, tid);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: tid, state: 'cancelled', error: null });
    expect(request(b)).toMatchObject({ id: tid, state: 'cancelled' });
    expect((await read(b, tid)).body.state).toBe('cancelled');
    await both();
    expect(offer(a)).toBeUndefined();
    expect(a.runner.isLive(id)).toBe(true);
    // A and B's transitions are each their own: A never heard of B's as a transition, only as the record.
    expect((await read(a, tid)).status).toBe(404);
  });
});

describe('a handoff from A', () => {
  let tid: string;

  it('is the offer record, read through its phases', T, async () => {
    const res = await create(a, { kind: 'relocate', to: 'mac-b' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'relocate', state: 'preparing', from: MAC_A, to: MAC_B, handoff: { outgoing: true, state: { phase: 'preparing' } } });
    tid = res.body.id;
    expect(offer(a)).toMatchObject({ id: tid, from: MAC_A, to: MAC_B });
    const out = await waitFor(() => offer(a)?.state === 'offered' && offer(a), 'the offer to go out', 20_000);
    expect(out.id).toBe(tid);
    expect((await read(a, tid)).body).toMatchObject({ id: tid, state: 'offered', error: null, thread: { status: 'stopped' } });
  });

  it('is cancelled on A before B picks it up, and the old cancel route agrees', T, async () => {
    const res = await cancel(a, tid);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: tid, state: 'cancelled' });
    expect(offer(a)).toMatchObject({ id: tid, state: 'cancelled' });
    expect((await read(a, tid)).body.state).toBe('cancelled');
    // Cancelling twice changes nothing.
    expect((await cancel(a, tid)).body.state).toBe('cancelled');
    expect((await a.json(`/threads/${id}/handoff/cancel`, { body: {} })).body.thread.id).toBe(id);
    await both();
    expect(b.thread(id).status).toBe('stopped');
    expect(b.runner.isLive(id)).toBe(false);
  });
});
