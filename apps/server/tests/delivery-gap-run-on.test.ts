import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { macFixture } from './fixture-shape.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Delivery contract (docs/internals/delivery.md), gap 1 closed by #398: a reply Ben sends on the hub to a thread that
// runs on another machine is a remote command of its own (db/repos/remote-commands.ts), answered "accepted" only once
// it is saved, and ends accepted, rejected or expired, never cut by a cap or skipped in silence. The holder answers
// what it takes; what it finds too late it expires, and the hub shows that in the transcript as not delivered. A hub
// whose holder never answers expires the command itself. Stop is a command too: one on an idle thread comes back
// rejected, with why.
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
const fixtures = new Map<string, unknown>();
const TOO_LATE = 'Box B did not take it within 24 hours.';

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
  // Accepted means a command of its own on the hub, open until B answers it.
  expect(a.db.remoteCommands.get(requestId)).toMatchObject({ kind: 'message', state: 'sent', sender: 'mac-a', target: 'box-b', target_name: 'Box B' });
};

/** A reply A accepted for B `agoMs` before its deadline passed: what forwardMessage writes, with the clock moved. */
const repliedEarlier = (id: string, prompt: string, requestId: string, agoMs: number) =>
  a.db.remoteCommands.add({
    id: requestId, thread_id: id, kind: 'message', sender: 'mac-a', target: 'box-b', target_name: 'Box B',
    prompt, mode: 'queue', source: 'ben', expires_at: new Date(Date.now() - agoMs).toISOString(),
  });

describe('replies forwarded to the machine running a thread (#398)', () => {
  it('reach that machine however many wait and however long it was away', { timeout: 60_000 }, async () => {
    const many = await onBoxB('audit the checkout');
    const late = await onBoxB('audit the footer');

    // While B is away, Ben sends 51 replies to one thread, each answered "accepted".
    for (let n = 0; n <= 50; n++) await reply(many, `reply ${n}`, `many-${n}`);
    // And one to another thread, which B sees only once its day is up (within the hub's own grace), then a fresh one.
    repliedEarlier(late, 'the footer copy', 'late-1', 30_000);
    await reply(late, 'and the links', 'late-2');

    await both();
    await waitFor(() => b.db.messageRequests.byRequestId(many, 'runon:many-50'), 'B to take the newest reply');
    await waitFor(() => b.db.messageRequests.byRequestId(late, 'runon:late-2'), 'B to take the fresh reply');

    // Every accepted reply has an outcome on B: taken to be sent, or expired with why, never cut or skipped in silence.
    expect(b.db.messageRequests.byRequestId(many, 'runon:many-0')).toBeDefined();
    for (let n = 0; n <= 50; n++) expect(b.db.remoteCommands.get(`many-${n}`), `many-${n}`).toMatchObject({ state: 'accepted', acked_by: 'box-b' });
    expect(b.db.messageRequests.byRequestId(late, 'runon:late-1')).toBeUndefined();
    expect(b.db.remoteCommands.get('late-1')).toMatchObject({ state: 'expired', acked_by: 'box-b', reason: TOO_LATE });

    // The answers reach the hub, where the expired reply shows in the transcript as not delivered, with why.
    await both();
    expect(a.db.remoteCommands.get('many-0')?.state).toBe('accepted');
    expect(a.db.remoteCommands.get('late-1')?.state).toBe('expired');
    const shown = a.byKind(late, 'user').find((e) => e.p.command === 'late-1');
    expect(shown?.p).toMatchObject({ text: 'the footer copy', dropped: true, undelivered: TOO_LATE });
    // Written once: a later sync adds nothing.
    await both();
    expect(a.byKind(late, 'user').filter((e) => e.p.command === 'late-1')).toHaveLength(1);
    expect(a.db.remoteCommands.openCount(late)).toBe(0);
    fixtures.set('thread-undelivered.json', (await a.json(`/threads/${late}`)).body);
  });

  it('expire on the hub when the holder never answers, and the holder then leaves them alone', { timeout: 60_000 }, async () => {
    const away = await onBoxB('audit the search');
    // B has been gone past the deadline and the hub's grace: the hub closes the command itself, so Ben sees it.
    repliedEarlier(away, 'the search copy', 'away-1', 2 * 60_000);
    await a.sync();
    await waitFor(() => a.db.remoteCommands.get('away-1')?.state === 'expired', 'the hub to expire it');
    expect(a.db.remoteCommands.get('away-1')).toMatchObject({ acked_by: 'mac-a', reason: TOO_LATE });
    expect(a.byKind(away, 'user').find((e) => e.p.command === 'away-1')?.p).toMatchObject({ dropped: true, undelivered: TOO_LATE });

    // B comes back and hears the answer, not the order: nothing is sent, and the hub's answer stands.
    await both();
    expect(b.db.remoteCommands.get('away-1')).toMatchObject({ state: 'expired', acked_by: 'mac-a' });
    expect(b.db.messageRequests.byRequestId(away, 'runon:away-1')).toBeUndefined();
  });

  it('answer a Stop on a thread with no turn running as rejected, with why', { timeout: 60_000 }, async () => {
    const idle = await onBoxB('audit the header');
    await waitFor(() => !b.runner.isLive(idle), 'the turn to end on B');
    const res = await a.json(`/threads/${idle}/stop`, { body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stop = a.db.remoteCommands.forThread(idle).find((c) => c.kind === 'stop');
    expect(stop).toMatchObject({ state: 'sent', target: 'box-b' });

    await both();
    expect(b.db.remoteCommands.get(stop!.id)).toMatchObject({ state: 'rejected', acked_by: 'box-b', reason: 'No turn was running on Box B.' });
    await both();
    expect(a.db.remoteCommands.get(stop!.id)?.state).toBe('rejected');
    expect(a.byKind(idle, 'error').map((e) => e.p.text)).toContain('Stop was not delivered to Box B: No turn was running on Box B.');
  });

  it('sends the Mac app the shapes its fixtures hold', () => {
    const places = [a.tmp, b.tmp, shared].flatMap((p) => [realpathSync(p), p]);
    expect([...fixtures.keys()]).toEqual(['thread-undelivered.json']);
    for (const [name, value] of fixtures) macFixture(name, value, places);
  });
});
