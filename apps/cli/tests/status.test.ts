import { describe, expect, it } from 'vitest';
import { fake, wire } from './helpers.ts';

const routes = [
  { method: 'GET', path: '/api/status', reply: { json: wire('status.json') } },
  { method: 'GET', path: '/api/needs-you', reply: { json: wire('needs-you.json') } },
  { method: 'GET', path: '/api/sync/status', reply: { json: wire('sync-status.json') } },
  { method: 'GET', path: '/api/update/fleet', reply: { json: wire('update-fleet.json') } },
];

/** machines.json with a second, synced machine that has a CPU and memory sample. */
function twoMachines() {
  const view = wire('machines.json');
  const here = { ...view.machines[0], id: 'mac-a', name: 'Mac A' };
  const box = {
    ...view.machines[0],
    id: 'box-b',
    name: 'Box B',
    here: false,
    reachability: 'online',
    lastChangeAt: '2026-01-05T09:03:00.000Z',
    running: 2,
    queued: 1,
    delegated: 1,
    agents: null,
    needsYou: 3,
    stats: { sampledAt: '2026-01-05T09:04:00.000Z', cpu: 12.4, cores: 16, memory: { used: 10 * 1024 ** 3, total: 32 * 1024 ** 3, source: 'meminfo' }, load: [1.2, 0.8, 0.5] },
  };
  return { ...view, syncLive: true, lastSyncAt: '2026-01-05T09:04:00.000Z', machines: [here, box] };
}

describe('omni status', () => {
  it("prints this Omni's version, turns, Needs you, sync and update state", async () => {
    const f = fake({ routes });
    expect(await f.run('status')).toBe(0);
    const out = f.out();
    expect(out.split('\n')[0]).toBe("Omni 0.1.0 on Omni's Mac (http://127.0.0.1:4747)");
    expect(out).toMatch(/^server\s+up since 5m ago, pid 4242, commit 00000000$/m);
    expect(out).toMatch(/^turns\s+1 running, 0 queued$/m);
    expect(out).toMatch(/^needs you\s+7 unread results, 4 blocked threads$/m);
    expect(out).toMatch(/^sync\s+on, last synced .+, 2 to push$/m);
    expect(out).toMatch(/^update\s+checking \(runs d6e2a30d\)$/m);
  });

  it('still answers from a server without sync or the update fleet', async () => {
    const f = fake({ routes: [routes[0], routes[1], { method: 'GET', path: /^\/api\/(sync|update)/, reply: { status: 404, json: wire('error-not-found.json') } }] });
    expect(await f.run('status', '--json')).toBe(0);
    expect(JSON.parse(f.out())).toMatchObject({ machine: "Omni's Mac", running: 1, queued: 0, needs_you: { unread: 7, blocked: 4 }, sync: null, update: null });
  });

  it('fails when the server is down', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/status', reply: { refused: true } }] });
    expect(await f.run('status')).toBe(3);
  });
});

describe('omni status --machine', () => {
  it('reads another machine as this Omni sees it: load, CPU, memory and update state', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/machines?stats=1', reply: { json: twoMachines() } }, routes[3]] });
    expect(await f.run('status', '--machine', 'box b')).toBe(0);
    const out = f.out();
    expect(out.split('\n')[0]).toBe('Box B (online)');
    expect(out).toMatch(/^turns\s+2 running, 1 queued, 1 delegated$/m);
    expect(out).toMatch(/^needs you\s+3 threads asking for you$/m);
    expect(out).toMatch(/^cpu\s+12% of 16 cores, load 1.20 0.80 0.50$/m);
    expect(out).toMatch(/^memory\s+10 GB of 32 GB in use$/m);
    expect(out).toMatch(/^update\s+restarting \(runs d6e2a30d\)$/m);
    expect(out).toMatch(/^sync\s+live, last synced 1m ago$/m);
  });

  it('reads this machine as "here", from the recorded answer with sync off', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/machines?stats=1', reply: { json: wire('machines.json') } }, routes[3]] });
    expect(await f.run('status', '--machine', 'here')).toBe(0);
    expect(f.out()).toMatch(/^Omni's Mac \(this machine\)$/m);
    expect(f.out()).toMatch(/^turns\s+1 running, 0 queued$/m);
  });

  it('names the machines it knows when there is none by that name', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/machines?stats=1', reply: { json: wire('machines.json') } }, routes[3]] });
    expect(await f.run('status', '--machine', 'omarchy')).toBe(3);
    expect(f.err()).toContain("No machine named omarchy. Machines: Omni's Mac. Sync is off");
  });
});
