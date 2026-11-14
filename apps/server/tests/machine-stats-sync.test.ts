import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixture } from '@omni/test-fixtures';
import { machineStats, type MachineLoad, type MachineStats, type MachinesView } from '@omni/shared/machines.ts';
import type { StatsSource } from '../machine-stats.ts';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// CPU and memory across two synced machines: B samples only once A shows the machine tiles (A's watch record syncs to
// B), B's sample reaches A's /api/machines and A's feed with B's own sampled-at time, and A shows it stale once B stops
// sending, goes offline, or sync on A stops carrying changes. A is a Mac (the real vm_stat capture), B a Linux box.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'office-air.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'home-linux.tail1234.ts.net' };
let a: Mac;
let b: Mac;
const fromA: { id: string | null; stats: MachineStats }[] = [];

const source = (platform: 'darwin' | 'linux', busyPerTick: number): StatsSource => {
  let tick = 0;
  return {
    platform,
    cpus: () => (tick++, [{ times: { user: busyPerTick * tick, nice: 0, sys: 0, idle: (1000 - busyPerTick) * tick, irq: 0 } }]),
    loadavg: () => [0.42, 0.3, 0.2],
    totalmem: () => 25_769_803_776,
    vmStat: async () => readFileSync(fixture('machine-stats/vm_stat-macos27-arm64.txt'), 'utf8'),
    meminfo: async () => readFileSync(fixture('machine-stats/meminfo-linux.txt'), 'utf8'),
  };
};

const machines = async (m: Mac) => (await m.json('/machines')).body as MachinesView;
const named = (v: MachinesView, id: string) => v.machines.find((x) => x.id === id) as MachineLoad;

beforeAll(async () => {
  a = await bootMac('mac-a', "Ben's MacBook Air", relay);
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  b = await bootMac('mac-b', 'Linux box', relay);
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  // Short timings: a sample every 40 ms, B sends every 50 ms while A's watch is under 600 ms old.
  a.stats.configureMachineStats({ source: source('darwin', 100), firstMs: 20, sampleMs: 40, remoteLeaseMs: 600 });
  b.stats.configureMachineStats({ source: source('linux', 250), firstMs: 20, sampleMs: 40, remoteLeaseMs: 600, sendMs: 50 });
  a.bus.on('feed', (e: { type: string; id: string | null; stats: MachineStats }) => e.type === 'machine_stats' && fromA.push(e));
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await a.sync();
}, 30_000);

afterAll(() => {
  a?.stats.stopMachineStats();
  b?.stats.stopMachineStats();
});

describe('CPU and memory across machines', () => {
  it('samples nothing anywhere until a machine shows the tiles', async () => {
    expect(b.db.kv.get('machine-stats.mac-b')).toBeUndefined();
    expect(b.db.kv.get('machine-watch.mac-a')).toBeUndefined();
  });

  it("brings B's sample to A once A watches, with B's sampled-at time", async () => {
    const first = await machines(a);
    // This machine answers with its first sample at once: memory and load, the CPU share a moment later.
    expect(named(first, 'mac-a').stats).toMatchObject({ cpu: null, cores: 1, memory: { source: 'vm_stat', total: 25_769_803_776 }, load: [0.42, 0.3, 0.2] });
    expect(named(first, 'mac-b').stats).toBeNull();
    expect(machineStats(named(first, 'mac-b'), first).note).toBe('No CPU or memory stats from it yet');

    // A's watch goes out with its next sync; B starts sampling when it lands, and writes its sample.
    await a.sync();
    await b.sync();
    const sent = await waitFor(() => b.db.kv.get<MachineStats>('machine-stats.mac-b'), 'B to send its sample');
    expect(sent).toMatchObject({ cpu: 25, cores: 1, memory: { source: 'meminfo', used: (65_576_180 - 42_264_376) * 1024 } });
    await b.sync();
    await a.sync();

    const v = await machines(a);
    const pro = named(v, 'mac-b');
    expect(pro.stats).toEqual(sent);
    expect(pro.stats!.sampledAt).toBe(sent.sampledAt);
    expect(machineStats(pro, v)).toMatchObject({ stale: false, note: null });
    expect(machineStats(pro, v).rows.map((r) => r.text)).toEqual(['25%', '22.2/62.5 GB']);
    // A's clients got it on the feed as it applied, without asking again.
    expect(fromA.filter((e) => e.id === 'mac-b').at(-1)?.stats).toEqual(sent);
    // And A's own tile has its CPU share by now.
    expect(named(v, 'mac-a').stats).toMatchObject({ cpu: 10 });
  });

  it('shows the sample stale with its age once B stops sending, never as live', async () => {
    // B sends every 50 ms while A's watch is fresh. Nobody renews it here, so B stops once its lease runs out.
    const sentAt = () => b.db.kv.get<MachineStats>('machine-stats.mac-b')!.sampledAt;
    let stopped: string | null = null;
    for (let i = 0; i < 40 && !stopped; i++) {
      const before = sentAt();
      await new Promise((r) => setTimeout(r, 200));
      if (sentAt() === before) stopped = before;
    }
    expect(stopped).not.toBeNull();
    await b.sync();
    await a.sync();
    const v = await machines(a);
    const pro = named(v, 'mac-b');
    expect(pro.stats!.sampledAt).toBe(stopped);
    const later = Date.parse(pro.stats!.sampledAt) + 61_000;
    expect(machineStats(pro, v, later)).toMatchObject({ stale: true, note: 'Sampled 1m ago', ageSeconds: 61 });
    expect(machineStats(pro, v, later).rows.map((r) => r.text)).toEqual(['25%', '22.2/62.5 GB']);
  });

  it('shows a fresh sample stale while B is offline or sync on A is not live', async () => {
    const v = await machines(a);
    const pro = named(v, 'mac-b');
    const now = Date.parse(pro.stats!.sampledAt) + 2_000;
    expect(machineStats(pro, v, now).stale).toBe(false);
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: false, lastSeen: '2026-11-14T07:00:00Z' }]));
    expect(machineStats(named(await machines(a), 'mac-b'), v, now)).toMatchObject({ stale: true, note: 'Sampled 2s ago' });
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
    expect(machineStats(pro, { syncLive: false }, now).stale).toBe(true);
  });
});
