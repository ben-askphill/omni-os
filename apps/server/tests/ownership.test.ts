import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// One execution owner (docs/adr/0005-one-execution-owner.md): the assignment record, its generation, how sync merges
// it, what older builds' kv records still mean, and the fence that stops a turn here once the thread moved.

let H: Awaited<ReturnType<typeof startRunner>>;
let O: typeof import('../ownership.ts');
let G: typeof import('../sync/guard.ts');

const SELF = 'mac-a';

beforeAll(async () => {
  H = await startRunner({ OMNI_KEEPALIVE_SECONDS: '60' });
  O = await import('../ownership.ts');
  G = await import('../sync/guard.ts');
  const { MemoryTransport } = await import('../sync/transport.ts');
  const sync = await import('../sync/worker.ts');
  await sync.setActiveWorker(sync.createSyncWorker({ transport: new MemoryTransport(), machineId: SELF }));
});

const plain = (id: string) =>
  H.db.threads.create({
    id, channel_id: 'scratch', title: id, status: 'done', role: null, model: null, session_id: id, cwd: H.db.channels.get('scratch')!.base_dir!,
    branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });

describe('the assignment record', () => {
  it('a turn here claims the thread; a new machine is the next generation; the same one again changes nothing', () => {
    plain('gen');
    expect(H.db.assignments.get('gen')).toBeNull();
    expect(O.ownerOf('gen')).toBeNull();
    H.db.threads.update('gen', { status: 'running' });
    expect(H.db.assignments.get('gen')).toMatchObject({ machine: SELF, generation: 0, routed: false });
    H.db.threads.update('gen', { status: 'done' });
    H.db.threads.update('gen', { status: 'running' });
    expect(H.db.assignments.get('gen')!.generation).toBe(0);
    expect(H.db.assignments.claim('gen', 'mac-b')).toMatchObject({ machine: 'mac-b', generation: 1 });
    expect(H.db.assignments.claim('gen', 'mac-b')!.generation).toBe(1);
    expect(H.db.assignments.claim('gen')).toMatchObject({ machine: SELF, generation: 2 });
    // Older builds read the holder key; it follows every claim.
    expect(H.db.kv.get('handoff.holder.gen')).toBe(SELF);
  });

  it('routed is sticky: set when the hub sends the thread away, kept by every claim after', () => {
    plain('routed');
    O.assignRouted('routed', 'box-b');
    expect(H.db.assignments.get('routed')).toMatchObject({ machine: 'box-b', generation: 0, routed: true });
    expect(O.remoteHolder(H.db.threads.get('routed')!)).toBe('box-b');
    H.db.assignments.claim('routed');
    expect(H.db.assignments.get('routed')).toMatchObject({ machine: SELF, generation: 1, routed: true });
    expect(O.remoteHolder(H.db.threads.get('routed')!)).toBeNull();
  });

  it('a copy from another machine wins by generation, and the same generation ties by machine id', () => {
    plain('merge');
    H.db.assignments.claim('merge');
    const at = new Date().toISOString();
    expect(H.db.assignments.applyRemote({ thread_id: 'merge', machine: 'mac-z', generation: 0, routed: false, at })).toBe(false);
    expect(H.db.assignments.applyRemote({ thread_id: 'merge', machine: 'mac-0', generation: 0, routed: false, at })).toBe(true);
    expect(H.db.assignments.stored('merge')).toMatchObject({ machine: 'mac-0', generation: 0 });
    expect(H.db.assignments.applyRemote({ thread_id: 'merge', machine: 'mac-z', generation: 3, routed: false, at })).toBe(true);
    expect(H.db.assignments.applyRemote({ thread_id: 'merge', machine: 'mac-0', generation: 2, routed: false, at })).toBe(false);
    expect(H.db.assignments.stored('merge')).toMatchObject({ machine: 'mac-z', generation: 3 });
    // The same machine at the same generation only adds the routed mark.
    expect(H.db.assignments.applyRemote({ thread_id: 'merge', machine: 'mac-z', generation: 3, routed: true, at })).toBe(true);
    expect(H.db.assignments.applyRemote({ thread_id: 'merge', machine: 'mac-z', generation: 3, routed: false, at })).toBe(false);
    expect(H.db.assignments.stored('merge')!.routed).toBe(true);
  });

  it("reads an older build's holder and routing keys, and an older build's later holder over this row", () => {
    plain('legacy');
    H.db.kv.set('handoff.holder.legacy', 'mac-old');
    H.db.kv.set('runon.thread.legacy', 'mac-old');
    expect(H.db.assignments.get('legacy')).toMatchObject({ machine: 'mac-old', generation: 0, routed: true });
    expect(H.db.assignments.stored('legacy')).toBeNull();
    // This machine takes it: the next generation over the legacy owner, and the key follows.
    expect(H.db.assignments.claim('legacy')).toMatchObject({ machine: SELF, generation: 1, routed: true });
    expect(H.db.kv.get('handoff.holder.legacy')).toBe(SELF);
    // An older build then takes it (it writes only the key): that is the owner, at this row's generation.
    H.db.kv.set('handoff.holder.legacy', 'mac-old');
    expect(H.db.assignments.get('legacy')).toMatchObject({ machine: 'mac-old', generation: 1 });
    expect(O.heldElsewhere('legacy')).toMatchObject({ machine: 'mac-old' });
  });
});

describe('the delivery boundary', () => {
  it('refuses a turn while another machine runs the thread, lets a reply bring an idle one here, and parks a wake', () => {
    plain('bound');
    H.db.assignments.claim('bound', 'mac-b');
    const idle = H.db.threads.get('bound')!;
    expect(G.turnBlocked(idle)).toBeNull();
    expect(G.wakeBlocked(idle)).toBe('This thread is on your other Mac. Resume it to run it here.');
    H.db.db.prepare(`UPDATE threads SET status = 'running' WHERE id = 'bound'`).run();
    const busy = H.db.threads.get('bound')!;
    expect(G.runningElsewhere(busy)).toBe(true);
    expect(G.turnBlocked(busy)).toBe('This thread is running on your other Mac.');
    expect(G.wakeBlocked(busy)).toBe('This thread is running on your other Mac.');
    // Without sync there is no owner, so nothing is ever elsewhere.
    expect(O.ownedElsewhere(busy)).toMatchObject({ machine: 'mac-b' });
  });
});

describe('generation fencing', () => {
  it('stops a turn running here once the thread was assigned to another machine, and refuses it more messages', { timeout: 20_000 }, async () => {
    const t = await H.start('TOOL:60000 keep going');
    await H.untilTool(t.id);
    expect(H.db.assignments.get(t.id)).toMatchObject({ machine: SELF, generation: 0 });
    expect(O.lostTo(t.id, 0)).toBeNull();
    // Mac B's claim arrives by sync: Ben replied there while this machine was away.
    const at = new Date().toISOString();
    expect(H.db.assignments.applyRemote({ thread_id: t.id, machine: 'mac-b', generation: 1, routed: false, at })).toBe(true);
    expect(O.lostTo(t.id, 0)).toMatchObject({ machine: 'mac-b', generation: 1 });
    expect(() => H.runner.sendMessage(t.id, 'one more')).toThrow('This thread moved to your other Mac while it ran here.');
    H.runner.fenceStale();
    await H.untilStatus(t.id, 'stopped');
    expect(H.byKind(t.id, 'error').map((e) => e.p.text)).toContain('This thread moved to your other Mac while it ran here, so the turn was stopped.');
    expect(H.db.threads.get(t.id)!.status).toBe('stopped');
    // Taken back here (Ben replied here): the next generation. The warm process left from the stale turn is not the
    // one to run it, so the reply starts a fresh one.
    expect(H.db.assignments.claim(t.id)).toMatchObject({ machine: SELF, generation: 2 });
    expect(O.lostTo(t.id, 0)).toMatchObject({ generation: 2 });
    H.runner.sendMessage(t.id, 'again');
    await H.until('a fresh process', () => H.spawns(t.id).length === 2);
    await H.untilResults(t.id, 1);
    expect(O.lostTo(t.id, 2)).toBeNull();
  });
});
