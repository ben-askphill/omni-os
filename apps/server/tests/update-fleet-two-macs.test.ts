import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import type { FleetMachine, FleetResult, FleetView } from '@omni/shared/update-fleet.ts';
import { MemoryTransport } from '../sync/transport.ts';
import { wireFixture } from './fixture-shape.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Update all machines: A asks B, C and D over one in-memory relay. Each runs the real Updater (update.ts) on a checkout
// of its own whose origin is two commits ahead, with the install and the restart faked. Nothing restarts A's server,
// so A checks and downloads from here but is updated by hand.

const relay = new MemoryTransport();
const NODE = {
  a: { id: 'nA', dns: 'mac-a.tail1234.ts.net' },
  b: { id: 'nB', dns: 'box-b.tail1234.ts.net' },
  c: { id: 'nC', dns: 'mac-c.tail1234.ts.net' },
  d: { id: 'nD', dns: 'box-d.tail1234.ts.net' },
};
const online = (...nodes: { id: string; dns: string }[]) => nodes.map((n) => ({ ...n, online: true }));
const WAIT = { timeout: 8_000 };

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...cmd: string[]) {
  return execFileSync('git', cmd, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, file: string, text: string) {
  writeFileSync(join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', `${file}: ${text}`);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** A clone whose origin is two commits ahead of the commit its server runs. */
function checkout() {
  const root = mkdtempSync(join(tmpdir(), 'update-fleet-'));
  dirs.push(root);
  const origin = join(root, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'config', 'user.email', 't@example.com');
  git(origin, 'config', 'user.name', 't');
  const first = commit(origin, 'a.txt', 'one');
  const repo = join(root, 'repo');
  git(root, 'clone', '-q', origin, repo);
  commit(origin, 'b.txt', 'two');
  const third = commit(origin, 'c.txt', 'three');
  return { repo, first, third };
}

interface FleetMac extends Mac {
  install: Mock;
  restart: Mock;
  turns: { running: number };
  fail: { with: string | null };
  first: string;
  third: string;
}

/** A Mac whose fleet track is the real Updater over its own checkout. Bound right after its boot: each boot loads fresh modules. */
async function bootFleetMac(id: string, name: string, node: { id: string; dns: string }, peers: ReturnType<typeof online>, supervised = true): Promise<FleetMac> {
  const m = await bootMac(id, name, relay, { OMNI_SECRET_STORE: 'file' });
  m.tailnet(tailscaleStatus(node, peers));
  const { Updater } = await import('../update.ts');
  const { CheckoutTrack } = await import('../update-tracks.ts');
  const { configureFleet } = await import('../update-fleet.ts');
  const { publishFeed } = await import('../bus.ts');
  const { repo, first, third } = checkout();
  const turns = { running: 0 };
  const fail = { with: null as string | null };
  const install = vi.fn(async () => fail.with);
  const restart = vi.fn();
  const updater = new Updater({
    root: repo,
    current: () => first,
    supervised: () => supervised,
    bundled: false,
    enabled: () => true,
    runningTurns: () => turns.running,
    install,
    restart,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 1)),
    changed: () => publishFeed({ type: 'update' }),
  });
  configureFleet({ track: new CheckoutTrack(updater) });
  return { ...m, install, restart, turns, fail, first, third };
}

/** Sync, let the machine describe itself, and sync again so the others hear that and the status that goes with it. */
async function announce(m: Mac) {
  await m.sync();
  await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
  await m.sync();
}

let a: FleetMac;
let b: FleetMac;
let c: FleetMac;

/** Enough syncs for a write on any of A, B and C to reach the other two, and for their answers to come back. */
const round = async () => {
  for (const m of [a, b, c, a, b, c, a]) await m.sync();
};
const view = async (m: Mac) => (await m.json('/update/fleet')).body as FleetView;
const rowOf = (v: FleetView, id: string) => v.machines.find((r) => r.id === id)!;
const own = async (m: Mac): Promise<FleetMachine> => (await view(m)).machines[0];
const ask = (body: Record<string, unknown>) => a.json('/update/fleet', { body }) as Promise<{ status: number; body: FleetResult }>;

beforeAll(async () => {
  a = await bootFleetMac('mac-a', 'Mac A', NODE.a, online(NODE.b, NODE.c, NODE.d), false);
  b = await bootFleetMac('box-b', 'Box B', NODE.b, online(NODE.a, NODE.c, NODE.d));
  c = await bootFleetMac('mac-c', 'Mac C', NODE.c, online(NODE.a, NODE.b, NODE.d));
  for (const m of [a, b, c]) await announce(m);
  await round();
}, 60_000);

describe('updating every machine at once', () => {
  it('lists every machine as reporting after one sync, and Check all finds the two commits each is behind', async () => {
    const before = await view(a);
    expect(before.synced).toBe(true);
    expect(before.machines.map((m) => [m.id, m.state, m.current])).toEqual([
      ['mac-a', 'idle', true],
      ['box-b', 'idle', false],
      ['mac-c', 'idle', false],
    ]);
    const res = await ask({ action: 'check' });
    expect(res.status).toBe(202);
    expect(res.body.skipped).toEqual([]);
    expect(rowOf(res.body, 'box-b').state).toBe('sent');
    await round();
    for (const m of [a, b, c]) await vi.waitFor(async () => expect((await own(m)).state).toBe('ready'), WAIT);
    await round();
    const after = await view(a);
    for (const m of [a, b, c]) {
      expect(rowOf(after, m.id)).toMatchObject({
        state: 'ready',
        status: { track: m === a ? 'manual' : 'checkout', behind: 2, version: m.first.slice(0, 8), available: m.third.slice(0, 8) },
      });
    }
  }, 30_000);

  it('Update all leaves out the checkout nothing restarts, and the rest run on their own: one fails, one waits for its turn', async () => {
    b.fail.with = 'Updating to main failed. dirty';
    c.turns.running = 1;
    const res = await ask({ action: 'update' });
    expect(res.body.skipped).toEqual([{ id: 'mac-a', name: 'Mac A', reason: expect.stringMatching(/by hand/) }]);
    await round();
    await vi.waitFor(async () => expect((await own(b)).state).toBe('failed'), WAIT);
    await vi.waitFor(async () => expect(await own(c)).toMatchObject({ state: 'waiting', status: { waitingFor: 1 } }), WAIT);
    await round();
    const v = await view(a);
    expect(rowOf(v, 'box-b')).toMatchObject({ state: 'failed', status: { error: 'Updating to main failed. dirty' } });
    expect(rowOf(v, 'mac-c')).toMatchObject({ state: 'waiting', status: { waitingFor: 1 } });
    expect(c.restart).not.toHaveBeenCalled();
    expect(a.install).not.toHaveBeenCalled();
    c.turns.running = 0;
    await vi.waitFor(() => expect(c.restart).toHaveBeenCalledOnce(), WAIT);
    await round();
    expect(rowOf(await view(a), 'mac-c').state).toBe('restarting');
    expect(b.restart).not.toHaveBeenCalled();
  }, 30_000);

  it('Retry on the failed machine alone, by name, brings it level and touches nothing else', async () => {
    b.fail.with = null;
    const res = await ask({ action: 'update', machines: ['box b'] });
    expect(res.body.skipped).toEqual([]);
    expect(rowOf(res.body, 'box-b').state).toBe('sent');
    await round();
    await vi.waitFor(() => expect(b.restart).toHaveBeenCalledOnce(), WAIT);
    await round();
    expect(rowOf(await view(a), 'box-b').state).toBe('restarting');
    expect(b.install).toHaveBeenCalledOnce();
    expect(c.install).not.toHaveBeenCalled();
  }, 30_000);

  it('runs an ask once however often the machines sync, and takes one past its window without running it', async () => {
    await round();
    await round();
    expect(b.install).not.toHaveBeenCalled();
    expect(c.install).not.toHaveBeenCalled();
    const at = new Date().toISOString();
    a.db.kv.set('update.ask.mac-a.mac-c', { id: 'late', sender: 'mac-a', target: 'mac-c', action: 'update', at, expiresAt: new Date(Date.now() - 1_000).toISOString() });
    await round();
    expect(c.install).not.toHaveBeenCalled();
    expect(rowOf(await view(a), 'mac-c')).toMatchObject({ state: 'restarting', status: { taken: { 'mac-a': 'late' } } });
  }, 30_000);

  it('skips a machine Tailscale says is offline and says so, and Retry asks it anyway', async () => {
    const d = await bootFleetMac('box-d', 'Box D', NODE.d, online(NODE.a, NODE.b, NODE.c));
    await announce(d);
    await a.sync();
    a.tailnet(tailscaleStatus(NODE.a, [...online(NODE.b, NODE.c), { ...NODE.d, online: false }]));
    let res = await ask({ action: 'check' });
    expect(res.body.skipped).toEqual([
      { id: 'box-b', name: 'Box B', reason: 'Already updating.' },
      { id: 'box-d', name: 'Box D', reason: expect.stringMatching(/^Offline/) },
      { id: 'mac-c', name: 'Mac C', reason: 'Already updating.' },
    ]);
    expect(rowOf(res.body, 'box-d')).toMatchObject({ state: 'offline', reach: 'offline', status: { phase: 'idle', track: 'checkout' }, ask: null });
    res = await ask({ action: 'check', machines: ['Box D'], force: true });
    expect(res.body.skipped).toEqual([]);
    expect(rowOf(res.body, 'box-d')).toMatchObject({ state: 'sent', ask: { action: 'check', sender: 'mac-a', target: 'box-d' } });
  }, 30_000);

  it('refuses a machine it does not know', async () => {
    const res = await ask({ action: 'check', machines: ['Nope'] });
    expect(res.status).toBe(404);
    expect((res.body as unknown as { error: string }).error).toContain('Box B (box-b)');
    expect((await ask({ action: 'reboot' })).status).toBe(400);
  });

  it('sends the list in the shape of its wire fixture', async () => {
    wireFixture('update-fleet.json', await view(a));
  });
});
