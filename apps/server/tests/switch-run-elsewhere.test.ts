import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// A run switch Ben makes on one machine for a thread another machine runs: Mac A is the hub he looks at, Box B runs the
// thread. The pick is the thread's for its next turn on B, whether B is mid-turn (it waits for the turn, as a pick
// made on B would) or between turns with its last process still warm. Two real servers in one process with fake claude
// and one in-memory relay; a machine hears of the other only on sync.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'mac-a.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'box-b.tail1234.ts.net' };
const shared = mkdtempSync(join(tmpdir(), 'omni-switch-elsewhere-'));
afterAll(() => rmSync(shared, { recursive: true, force: true }));
const T = { timeout: 30_000 };
const claude = { harness: 'claude-code', model: 'claude-sonnet-5-5' };

let a: Mac;
let b: Mac;

const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
};

afterAll(async () => {
  for (const m of [a, b]) {
    for (const t of m.db.threads.running().filter((r) => m.runner.isLive(r.id))) {
      await m.json(`/threads/${t.id}/stop`, { body: {} });
      await waitFor(() => !m.runner.isLive(t.id), 'the turn to stop');
      await m.files.turnFinished(t.id);
    }
  }
}, 30_000);

beforeAll(async () => {
  a = await bootMac('mac-a', 'Mac A', relay);
  await (await import('../harness/catalog-service.ts')).loadCatalog();
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shared, notes: '' });
  // B keeps a finished turn's process warm, as every install does, so its next turn could reuse it.
  b = await bootMac('box-b', 'Box B', relay, { OMNI_KEEPALIVE_SECONDS: '600' });
  await (await import('../harness/catalog-service.ts')).loadCatalog();
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await a.sync();
}, 60_000);

/** A thread made on A that runs on B, its first turn running there and seen running on A. */
async function runningOnB(prompt: string) {
  const res = await a.json('/threads', { body: { channel: 'shop', prompt, device: 'box-b', ...claude, effort: 'high' } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const id = res.body.id as string;
  await both();
  await waitFor(() => b.runner.isLive(id), 'the thread to start on B');
  await b.untilTool(id);
  for (let n = 0; n < 5 && a.thread(id).status !== 'running'; n++) await both();
  expect(a.thread(id).status).toBe('running');
  return id;
}

const lastSpawn = (id: string) => b.spawns(id).at(-1)!;

describe('a run switch on the hub for a thread another machine runs', () => {
  it('waits for the turn there, and the next turn runs at the new effort', async () => {
    const id = await runningOnB('TOOL:2500 audit the checkout');
    expect(lastSpawn(id).effort).toBe('high');

    const res = await a.json(`/threads/${id}/run`, { body: { ...claude, effort: 'low' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The hub shows the pick as waiting for the turn, as it does for a thread that runs here.
    expect(res.body).toMatchObject({ effort: 'high', queued_harness: 'claude-code', queued_effort: 'low' });

    // B takes the pick while its turn runs, and keeps it through its own writes of the row.
    await both();
    expect(b.thread(id)).toMatchObject({ status: 'running', effort: 'high', queued_effort: 'low' });
    await b.untilResults(id, 1);
    expect(b.thread(id)).toMatchObject({ effort: 'low', queued_harness: null });
    // The hub hears that it applied.
    for (let n = 0; n < 5 && a.thread(id).queued_harness; n++) await both();
    expect(a.thread(id)).toMatchObject({ effort: 'low', queued_harness: null });

    const reply = await a.json(`/threads/${id}/messages`, { body: { prompt: 'and the cart drawer', request_id: 'after-pick' } });
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect(reply.body.forwarded_to).toBe('Box B');
    await both();
    await b.untilResults(id, 2);
    expect(b.spawns(id)).toHaveLength(2);
    expect(lastSpawn(id)).toMatchObject({ effort: 'low', resume: true });
  }, T.timeout);

  it('drops the pick on the other machine when Ben keeps the run before the turn ends', async () => {
    const id = await runningOnB('TOOL:4000 audit the header');
    expect((await a.json(`/threads/${id}/run`, { body: { ...claude, effort: 'low' } })).body.queued_effort).toBe('low');
    await both();
    expect(b.thread(id).queued_effort).toBe('low');

    const kept = await a.json(`/threads/${id}/run`, { body: { ...claude, effort: 'high' } });
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(kept.body).toMatchObject({ effort: 'high', queued_harness: null });
    await both();
    expect(b.thread(id)).toMatchObject({ effort: 'high', queued_harness: null });
    await b.untilResults(id, 1);
    expect(b.thread(id).effort).toBe('high');
  }, T.timeout);

  it('refuses a run the hub catalog does not offer, and leaves the thread as it was', async () => {
    const id = await runningOnB('TOOL:2500 audit the footer');
    const res = await a.json(`/threads/${id}/run`, { body: { ...claude, effort: 'ultra' } });
    expect(res.status).toBe(400);
    expect(a.thread(id).queued_harness).toBeNull();
    await both();
    expect(b.thread(id).queued_harness).toBeNull();
    await b.untilResults(id, 1);
  }, T.timeout);

  it('applies a pick that reaches the other machine after its turn ended', async () => {
    const id = await runningOnB('TOOL:1500 audit the menu');
    const res = await a.json(`/threads/${id}/run`, { body: { ...claude, effort: 'low' } });
    expect(res.body.queued_effort).toBe('low');
    // B ends the turn before it hears of the pick, and its process stays warm.
    await b.untilResults(id, 1);
    expect(b.runner.isLive(id)).toBe(true);

    for (let n = 0; n < 5 && (b.thread(id).effort !== 'low' || a.thread(id).queued_harness); n++) await both();
    expect(b.thread(id)).toMatchObject({ effort: 'low', queued_harness: null });
    expect(a.thread(id)).toMatchObject({ effort: 'low', queued_harness: null });
    // The hub's ledger says the switch it made applied.
    expect(a.db.transitions.latest(id, 'reconfigure')).toMatchObject({ state: 'applied' });
    await waitFor(() => !b.runner.isLive(id), 'the warm process from the old run to close on B');

    expect((await a.json(`/threads/${id}/messages`, { body: { prompt: 'and the footer links', request_id: 'late-pick' } })).body.forwarded_to).toBe('Box B');
    await both();
    await b.untilResults(id, 2);
    expect(lastSpawn(id)).toMatchObject({ effort: 'low', resume: true });
  }, T.timeout);

  it('closes the warm process there when the effort changed between turns', async () => {
    const id = await runningOnB('TOOL:300 audit the search');
    await b.untilResults(id, 1);
    // The turn is over and its process stays warm on B.
    expect(b.runner.isLive(id)).toBe(true);
    for (let n = 0; n < 5 && a.thread(id).status === 'running'; n++) await both();

    const res = await a.json(`/threads/${id}/run`, { body: { ...claude, effort: 'medium' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ effort: 'medium', queued_harness: null });
    const reply = await a.json(`/threads/${id}/messages`, { body: { prompt: 'and the filters', request_id: 'between-turns' } });
    expect(reply.body.forwarded_to).toBe('Box B');
    await both();
    await b.untilResults(id, 2);
    expect(b.spawns(id)).toHaveLength(2);
    expect(lastSpawn(id)).toMatchObject({ effort: 'medium', resume: true });
  }, T.timeout);
});
