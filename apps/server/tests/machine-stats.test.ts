import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '@omni/test-fixtures';
import type { MachineStats } from '@omni/shared/machines.ts';

// apps/server/machine-stats.ts: the CPU share from os.cpus() deltas, memory from vm_stat (macOS) and /proc/meminfo
// (Linux), and a sampler that runs only while a client here or another machine watches. The macOS fixture is a real
// `vm_stat` from a MacBook Pro on macOS 27 (24 GiB, 16 KiB pages), the Linux one a real /proc/meminfo; this suite runs
// on Linux, so the macOS path is checked against that capture only, never against a live Mac.

const { store, feed, self } = vi.hoisted(() => ({ store: new Map<string, unknown>(), feed: [] as { type: string; id: string | null; stats: MachineStats }[], self: { id: 'mac-a' as string | null } }));
vi.mock('../db.ts', () => ({
  kv: { get: (k: string) => store.get(k), set: (k: string, v: unknown) => void store.set(k, structuredClone(v)) },
  outbox: { machineId: () => self.id },
}));
vi.mock('../bus.ts', () => ({ publishFeed: (e: (typeof feed)[number]) => void feed.push(e) }));

import {
  configureMachineStats,
  cpuPercent,
  cpuSnapshot,
  noteSynced,
  parseMeminfo,
  parseStats,
  parseVmStat,
  readMemory,
  stopMachineStats,
  syncedStats,
  takeSample,
  watchStats,
  type CpuTimes,
  type StatsSource,
} from '../machine-stats.ts';

const VM_STAT = readFileSync(fixture('machine-stats/vm_stat-macos27-arm64.txt'), 'utf8');
const MEMSIZE = 25_769_803_776; // sysctl hw.memsize on the Mac that printed it
const MEMINFO = readFileSync(fixture('machine-stats/meminfo-linux.txt'), 'utf8');

const t = (user: number, sys: number, idle: number, nice = 0, irq = 0): { times: CpuTimes } => ({ times: { user, nice, sys, idle, irq } });

describe('the CPU share', () => {
  it('is the busy share of all cores between two samples', () => {
    const before = cpuSnapshot([t(100, 50, 850), t(0, 0, 1000)]);
    const after = cpuSnapshot([t(300, 100, 1100), t(0, 0, 1500)]);
    // Core 0: 250 of 500 ms busy. Core 1: idle for 500 ms. 250 of 1000.
    expect(cpuPercent(before, after)).toBe(25);
    expect(after).toEqual({ busy: 400, total: 1500 + 1500, cores: 2 });
  });

  it('counts nice and irq as busy', () => {
    expect(cpuPercent(cpuSnapshot([t(0, 0, 0)]), cpuSnapshot([t(10, 10, 60, 10, 10)]))).toBe(40);
  });

  it('is a measured zero on an idle machine, and null without two samples to compare', () => {
    expect(cpuPercent(cpuSnapshot([t(5, 5, 100)]), cpuSnapshot([t(5, 5, 200)]))).toBe(0);
    expect(cpuPercent(null, cpuSnapshot([t(5, 5, 100)]))).toBeNull();
    expect(cpuSnapshot([])).toBeNull();
  });

  it('refuses to compare across a core coming or going, or counters that went back', () => {
    expect(cpuPercent(cpuSnapshot([t(1, 1, 10)]), cpuSnapshot([t(2, 2, 20), t(2, 2, 20)]))).toBeNull();
    expect(cpuPercent(cpuSnapshot([t(50, 50, 100)]), cpuSnapshot([t(10, 10, 100)]))).toBeNull();
    expect(cpuPercent(cpuSnapshot([t(5, 5, 100)]), cpuSnapshot([t(5, 5, 100)]))).toBeNull();
  });
});

describe('memory on macOS (vm_stat)', () => {
  it('counts app memory, wired and compressed, as Activity Monitor does', () => {
    // Anonymous 508810 less purgeable 827, wired 294297, compressor 362625, at 16384 bytes a page.
    const used = (508_810 - 827 + 294_297 + 362_625) * 16_384;
    expect(parseVmStat(VM_STAT, MEMSIZE)).toEqual({ used, total: MEMSIZE });
    expect(used / MEMSIZE).toBeCloseTo(0.74, 2);
  });

  it('is nowhere near what os.freemem() would make of it', () => {
    // libuv's free memory on macOS is "Pages free" alone: 55339 pages, which would call this Mac 96% full.
    const naive = 1 - (55_339 * 16_384) / MEMSIZE;
    expect(naive).toBeGreaterThan(0.96);
    expect(parseVmStat(VM_STAT, MEMSIZE)!.used / MEMSIZE).toBeLessThan(0.75);
  });

  it('reads the page size from the header (4 KiB on Intel Macs)', () => {
    const intel = VM_STAT.replace('page size of 16384 bytes', 'page size of 4096 bytes');
    expect(parseVmStat(intel, MEMSIZE)!.used).toBe((508_810 - 827 + 294_297 + 362_625) * 4_096);
  });

  it('gives up rather than guess when a line it needs is missing', () => {
    expect(parseVmStat(VM_STAT.replace(/^Anonymous pages:.*$/m, ''), MEMSIZE)).toBeNull();
    expect(parseVmStat(VM_STAT.replace(/^Pages occupied by compressor:.*$/m, ''), MEMSIZE)).toBeNull();
    expect(parseVmStat(VM_STAT.replace(/page size of \d+ bytes/, ''), MEMSIZE)).toBeNull();
    expect(parseVmStat(VM_STAT, 0)).toBeNull();
    expect(parseVmStat('', MEMSIZE)).toBeNull();
  });
});

describe('memory on Linux (/proc/meminfo)', () => {
  it('is MemTotal less MemAvailable, as free counts it', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({ used: (65_576_180 - 42_264_376) * 1024, total: 65_576_180 * 1024 });
  });

  it('is none on a kernel without MemAvailable (before 3.14), never MemFree', () => {
    expect(parseMeminfo(MEMINFO.replace(/^MemAvailable:.*\n/m, ''))).toBeNull();
    expect(parseMeminfo('')).toBeNull();
  });
});

const fakeSource = (o: Partial<StatsSource> = {}): StatsSource => {
  let tick = 0;
  return {
    platform: 'linux',
    // Each call moves both cores on by 1000 ms, 300 of them busy on core 0: 15% across both.
    cpus: () => {
      tick++;
      return [t(200 * tick, 100 * tick, 700 * tick), t(0, 0, 1000 * tick)];
    },
    loadavg: () => [1.234, 0.5, 0.25],
    totalmem: () => MEMSIZE,
    vmStat: async () => VM_STAT,
    meminfo: async () => MEMINFO,
    ...o,
  };
};

describe('a sample', () => {
  it('reads vm_stat on macOS and /proc/meminfo on Linux', async () => {
    expect(await readMemory(fakeSource({ platform: 'darwin' }))).toMatchObject({ source: 'vm_stat', total: MEMSIZE });
    expect(await readMemory(fakeSource({ platform: 'linux' }))).toMatchObject({ source: 'meminfo', total: 65_576_180 * 1024 });
  });

  it('has no memory on other platforms, or when the source fails', async () => {
    expect(await readMemory(fakeSource({ platform: 'win32' }))).toBeNull();
    expect(await readMemory(fakeSource({ platform: 'freebsd' }))).toBeNull();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readMemory(fakeSource({ platform: 'darwin', vmStat: () => Promise.reject(new Error('ENOENT')) }))).toBeNull();
    err.mockRestore();
  });

  it('takes its CPU share against the snapshot before, and rounds the load average', async () => {
    const src = fakeSource();
    const first = await takeSample(src, null, Date.parse('2026-11-14T18:00:00Z'));
    expect(first.stats).toMatchObject({ sampledAt: '2026-11-14T18:00:00.000Z', cpu: null, cores: 2, load: [1.23, 0.5, 0.25] });
    const second = await takeSample(src, first.cpu, Date.parse('2026-11-14T18:00:05Z'));
    expect(second.stats.cpu).toBe(15);
  });

  it('has no load average on Windows, where Node reports zeros, and no CPU without cores', async () => {
    const s = (await takeSample(fakeSource({ platform: 'win32', loadavg: () => [0, 0, 0], cpus: () => [] }), null, 0)).stats;
    expect(s).toMatchObject({ cpu: null, cores: null, memory: null, load: null });
  });
});

describe('a synced sample', () => {
  const good: MachineStats = { sampledAt: '2026-11-14T18:00:00.000Z', cpu: 12.5, cores: 10, memory: { used: 8, total: 16, source: 'meminfo' }, load: [1, 2, 3] };

  it('is taken as it came when it is in shape', () => {
    expect(parseStats(good)).toEqual(good);
  });

  it('drops what is out of shape instead of filling it in', () => {
    expect(parseStats(null)).toBeNull();
    expect(parseStats({ ...good, sampledAt: 'yesterday' })).toBeNull();
    expect(parseStats({ ...good, cpu: -1, cores: 2.5 })).toMatchObject({ cpu: null, cores: null });
    expect(parseStats({ ...good, cpu: 140 })!.cpu).toBeNull();
    expect(parseStats({ ...good, memory: { used: 20, total: 16, source: 'meminfo' } })!.memory).toBeNull();
    expect(parseStats({ ...good, memory: { used: 8, total: 16, source: 'free' } })!.memory).toBeNull();
    expect(parseStats({ ...good, load: [1, 2] })!.load).toBeNull();
  });
});

describe('the sampler', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-11-14T18:00:00Z') });
    store.clear();
    feed.length = 0;
    self.id = 'mac-a';
    configureMachineStats({ source: fakeSource(), now: () => Date.now() });
  });
  afterEach(() => {
    stopMachineStats();
    vi.useRealTimers();
  });

  const ownFeed = () => feed.filter((e) => e.id === 'mac-a');

  it('does not sample for a lone machine nobody asked about', async () => {
    expect(await watchStats(false)).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(feed).toEqual([]);
    expect(store.size).toBe(0);
  });

  it('samples for a client here, asks the other machines for theirs, and sends nothing until one watches', async () => {
    const first = await watchStats(true);
    expect(first).toMatchObject({ cpu: null, cores: 2, memory: { source: 'meminfo' } });
    expect(store.get('machine-watch.mac-a')).toEqual({ at: '2026-11-14T18:00:00.000Z' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ownFeed().map((e) => e.stats.cpu)).toEqual([null, 15]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(store.has('machine-stats.mac-a')).toBe(false);
  });

  it('feeds clients a sample only when what a tile shows changed, or every 30 seconds', async () => {
    await watchStats(true);
    await vi.advanceTimersByTimeAsync(1_000);
    feed.length = 0;
    // The fake machine runs steady at 15%: nothing a tile shows changes until the heartbeat.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(ownFeed()).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ownFeed()).toHaveLength(1);
  });

  it("sends its sample every 15 seconds while another machine's watch is fresh, then stops sampling", async () => {
    noteSynced('machine-watch.mac-b', { at: '2026-11-14T18:00:00.000Z' });
    await vi.advanceTimersByTimeAsync(1_000);
    // The first sample has no CPU share yet; the one a second later is the first sent.
    expect(store.get('machine-stats.mac-a')).toMatchObject({ cpu: 15, sampledAt: '2026-11-14T18:00:01.000Z' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncedStats('mac-a')!.sampledAt).toBe('2026-11-14T18:00:01.000Z');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(syncedStats('mac-a')!.sampledAt).toBe('2026-11-14T18:00:16.000Z');
    // No renewal: 90 seconds after the watch arrived it stops, and the last sample stays as it was sent.
    await vi.advanceTimersByTimeAsync(80_000);
    const last = syncedStats('mac-a')!.sampledAt;
    feed.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(feed).toEqual([]);
    expect(syncedStats('mac-a')!.sampledAt).toBe(last);
    expect(Date.parse(last)).toBeLessThanOrEqual(Date.parse('2026-11-14T18:01:31Z'));
    // Stopped, it forgets its last sample rather than hand it out as now.
    expect(await watchStats(false)).toBeNull();
  });

  it('sends at once when a watch arrives while it already samples', async () => {
    await watchStats(true);
    await vi.advanceTimersByTimeAsync(1_000);
    noteSynced('machine-watch.mac-b', {});
    expect(store.get('machine-stats.mac-a')).toMatchObject({ cpu: 15 });
  });

  it('ignores its own watch record, and never sends with sync off', async () => {
    noteSynced('machine-watch.mac-a', {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(feed).toEqual([]);
    self.id = null;
    expect(await watchStats(false, true)).toMatchObject({ cores: 2 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(feed.map((e) => e.id)).toEqual([null, null]);
    expect(store.size).toBe(0);
  });

  it("feeds clients another machine's sample as it syncs in, and drops one out of shape", () => {
    const stats: MachineStats = { sampledAt: '2026-11-14T17:59:58.000Z', cpu: 40, cores: 8, memory: null, load: null };
    noteSynced('machine-stats.mac-b', stats);
    noteSynced('machine-stats.mac-c', { cpu: 'lots' });
    expect(feed).toEqual([{ type: 'machine_stats', id: 'mac-b', stats }]);
  });
});
