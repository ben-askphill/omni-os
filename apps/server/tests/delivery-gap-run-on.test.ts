import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Known delivery gap (docs/internals/delivery.md, gap 1): a reply Ben sends on the hub to a thread that runs on another
// machine is answered "accepted" and written to one synced kv array per sender (run-on.ts forwardMessage). The array
// keeps the newest 50, and the holder skips an entry older than 24 hours, so a reply can vanish with no outcome
// anywhere. Expected to fail until #398 gives each forwarded message its own durable record with an outcome. When
// #398 lands, this test passes, `it.fails` fails, and #398 turns it into a plain `it`.
//
// Mac A is the hub, Box B the machine the thread runs on. Two real servers in one process with fake claude and one
// in-memory relay. B hears of A's writes only when the test syncs it, which stands in for B being away.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'mac-a.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'box-b.tail1234.ts.net' };
const shared = mkdtempSync(join(tmpdir(), 'omni-gap-runon-'));
afterAll(() => rmSync(shared, { recursive: true, force: true }));
// B is still working through the replies: stop its turns, and let their uploads finish before the servers close.
afterAll(async () => {
  for (const id of b.db.threads.running().map((t) => t.id)) {
    await b.json(`/threads/${id}/stop`, { body: {} });
    await waitFor(() => !b.runner.isLive(id), 'the turn to stop');
    await b.files.turnFinished(id);
  }
}, 30_000);

let a: Mac;
let b: Mac;

const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
};

beforeAll(async () => {
  a = await bootMac('mac-a', 'Mac A', relay);
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shared, notes: '' });
  b = await bootMac('box-b', 'Box B', relay);
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await a.sync();
}, 60_000);

/** A thread made on A, run on B, idle there, and known on A to be B's. */
async function onBoxB(prompt: string) {
  const res = await a.json('/threads', { body: { channel: 'shop', prompt, device: 'box-b' } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const id = res.body.id as string;
  await both();
  await b.untilResults(id, 1);
  await both();
  return id;
}

const reply = async (id: string, prompt: string, requestId: string) => {
  const res = await a.json(`/threads/${id}/messages`, { body: { prompt, mode: 'queue', request_id: requestId } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.request).toMatchObject({ id: requestId, state: 'accepted' });
};

describe('replies forwarded to the machine running a thread (#398)', () => {
  it.fails('reach that machine however many wait and however long it was away', { timeout: 60_000 }, async () => {
    const many = await onBoxB('audit the checkout');
    const late = await onBoxB('audit the footer');

    // While B is away, Ben sends 51 replies to one thread, each answered "accepted".
    for (let n = 0; n <= 50; n++) await reply(many, `reply ${n}`, `many-${n}`);
    // And one to another thread, which B sees only after more than a day (its `at` set back, as if the day passed).
    await reply(late, 'the footer copy', 'late-1');
    const key = `runon.msgs.${late}.mac-a`;
    const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    a.db.kv.set(key, a.db.kv.get<{ at: string }[]>(key)!.map((m) => ({ ...m, at: old })));
    await reply(late, 'and the links', 'late-2');

    await both();
    await waitFor(() => b.db.messageRequests.byRequestId(many, 'runon:many-50'), 'B to take the newest reply');
    await waitFor(() => b.db.messageRequests.byRequestId(late, 'runon:late-2'), 'B to take the fresh reply');

    // Every accepted reply has an outcome on B: taken to be sent, or kept there for Ben to decide (#398 may record an
    // expired one in its own state instead; it then checks that state here). Today the oldest is cut and the late one
    // skipped, with nothing on either machine to say so.
    expect(b.db.messageRequests.byRequestId(many, 'runon:many-0')).toBeDefined();
    expect(b.db.messageRequests.byRequestId(late, 'runon:late-1')).toBeDefined();
  });
});
