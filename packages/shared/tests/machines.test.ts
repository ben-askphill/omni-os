import { describe, expect, it } from 'vitest';
import { awaitingStats, harnessLine, machineStats, machineTile, statsReport, STATS_STALE_MS, type MachineLoad, type MachineStats } from '../machines.ts';

const NOW = Date.parse('2026-11-14T18:00:00Z');
const live = { syncLive: true, lastSyncAt: '2026-11-14T17:59:50Z' };

const machine = (o: Partial<MachineLoad> = {}): MachineLoad => ({
  id: 'mac-b', name: "Ben's MacBook Pro", here: false, reachability: 'online', lastSeen: null, lastChangeAt: null,
  running: 0, queued: 0, delegated: 0, agents: null, needsYou: 0,
  harnesses: [{ id: 'claude-code', running: 0, queued: 0, cap: 12 }, { id: 'codex', running: 0, queued: 0, cap: 4 }],
  threadIds: [], stats: null, ...o,
});

describe('machineTile', () => {
  it('shows an idle machine as up with its free slots', () => {
    expect(machineTile(machine(), live, NOW)).toEqual({
      dot: 'done', state: 'Online', value: 0, detail: 'running', foot: 'Claude Code · 0 of 12 slots', stale: false,
    });
  });

  it('lists what runs, then each busy harness against its cap', () => {
    const m = machine({
      here: true, running: 3, queued: 1, delegated: 2, agents: 4, needsYou: 1,
      harnesses: [{ id: 'claude-code', running: 2, queued: 1, cap: 12 }, { id: 'codex', running: 1, queued: 0, cap: 4 }],
    });
    expect(machineTile(m, live, NOW)).toMatchObject({
      dot: 'running', value: 3, detail: 'running · 1 queued · 2 delegated · 4 sub-agents · 1 needs you', foot: 'Claude Code 2 of 12, 1 queued · Codex 1 of 4',
    });
  });

  it('never shows an offline machine as zero: a dash, when it was seen, and what it last reported', () => {
    const t = machineTile(machine({ reachability: 'offline', lastSeen: '2026-11-14T16:00:00Z', running: 2 }), live, NOW);
    expect(t).toMatchObject({ dot: 'settled', state: 'Offline', value: null, detail: 'Offline · seen 2h ago', foot: 'Last reported 2 running', stale: true });
    expect(machineTile(machine({ reachability: 'offline', lastChangeAt: '2026-11-14T17:30:00Z' }), live, NOW).foot).toBe('Last change 30m ago');
  });

  it('flags another machine as stale while sync here is not live, never this one', () => {
    const off = { syncLive: false, lastSyncAt: '2026-11-14T17:00:00Z' };
    expect(machineTile(machine({ running: 1 }), off, NOW)).toMatchObject({ value: 1, foot: 'Sync is not live here · as of 1h ago', stale: true });
    expect(machineTile(machine({ here: true }), off, NOW).stale).toBe(false);
  });

  it('says when there is no Tailscale to ask', () => {
    expect(machineTile(machine({ reachability: 'unknown' }), live, NOW)).toMatchObject({ dot: 'idle', state: 'Reachability unknown', foot: 'No Tailscale to ask · Claude Code · 0 of 12 slots' });
  });
});

describe('harnessLine', () => {
  it('counts without a cap for a machine that did not announce its caps', () => {
    expect(harnessLine(machine({ harnesses: [{ id: 'claude-code', running: 2, queued: 0, cap: null }] }))).toBe('Claude Code 2 running');
    expect(harnessLine(machine({ harnesses: [] }))).toBe('Nothing running');
  });
});

const GiB = 2 ** 30;
const sample = (o: Partial<MachineStats> = {}): MachineStats => ({
  sampledAt: '2026-11-14T17:59:55Z', cpu: 23.4, cores: 12, memory: { used: 17.8 * GiB, total: 24 * GiB, source: 'vm_stat' }, load: [3.7, 6.29, 13.21], ...o,
});

describe('machineStats', () => {
  it('shows a live sample as CPU and RAM meters with their numbers', () => {
    const v = machineStats(machine({ stats: sample() }), live, NOW);
    expect(v).toMatchObject({ stale: false, note: null, ageSeconds: 5 });
    expect(v.rows.map((r) => [r.label, r.value, r.text])).toEqual([
      ['CPU', 23.4 / 100, '23%'],
      ['RAM', 17.8 / 24, '17.8/24 GB'],
    ]);
    expect(v.rows[0].title).toBe('CPU 23% busy across all cores · Load average 3.70, 6.29, 13.21 over 1, 5 and 15 minutes · 12 cores');
    expect(v.rows[1].title).toBe('17.8 of 24 GB in use (74%): app memory, wired and compressed (vm_stat)');
  });

  it('names /proc/meminfo on Linux and keeps a decimal in a total that has one', () => {
    const v = machineStats(machine({ stats: sample({ memory: { used: 22.2 * GiB, total: 62.5 * GiB, source: 'meminfo' } }) }), live, NOW);
    expect(v.rows[1]).toMatchObject({ text: '22.2/62.5 GB', title: '22.2 of 62.5 GB in use (36%): total less available (/proc/meminfo)' });
  });

  it('greys a sample over a minute old and says how old, never showing it as live', () => {
    const at = new Date(NOW - STATS_STALE_MS - 1_000).toISOString();
    expect(machineStats(machine({ stats: sample({ sampledAt: at }) }), live, NOW)).toMatchObject({ stale: true, note: 'Sampled 1m ago', ageSeconds: 61 });
    const fresh = new Date(NOW - STATS_STALE_MS + 1_000).toISOString();
    expect(machineStats(machine({ stats: sample({ sampledAt: fresh }) }), live, NOW)).toMatchObject({ stale: false, note: null });
  });

  it('greys a fresh sample from a machine that is offline, or while sync here is not live, with seconds', () => {
    expect(machineStats(machine({ reachability: 'offline', stats: sample() }), live, NOW)).toMatchObject({ stale: true, note: 'Sampled 5s ago' });
    expect(machineStats(machine({ stats: sample() }), { syncLive: false }, NOW)).toMatchObject({ stale: true, note: 'Sampled 5s ago' });
    // This machine's own sample is never stale for sync's sake.
    expect(machineStats(machine({ here: true, stats: sample() }), { syncLive: false }, NOW).stale).toBe(false);
  });

  it('draws dashes, not zeros, before a first sample here and before the first CPU share', () => {
    const before = machineStats(machine({ here: true }), live, NOW);
    expect(before.rows.map((r) => [r.label, r.value, r.text])).toEqual([['CPU', null, '–'], ['RAM', null, '–']]);
    expect(before.stale).toBe(false);
    const first = machineStats(machine({ here: true, stats: sample({ cpu: null }) }), live, NOW);
    expect(first.rows[0]).toMatchObject({ value: null, text: '–' });
    expect(first.rows[1].text).toBe('17.8/24 GB');
  });

  it('says another machine has sent nothing yet instead of drawing meters', () => {
    expect(machineStats(machine(), live, NOW)).toEqual({ rows: [], stale: true, note: 'No CPU or memory stats from it yet', ageSeconds: null });
  });

  it('leaves out a stat the platform cannot measure', () => {
    const v = machineStats(machine({ stats: sample({ memory: null, load: null }) }), live, NOW);
    expect(v.rows.map((r) => r.label)).toEqual(['CPU']);
    expect(v.rows[0].title).toBe('CPU 23% busy across all cores · 12 cores');
    expect(machineStats(machine({ stats: sample({ cpu: null, cores: null, memory: null }) }), live, NOW).note).toBe('No CPU or memory stats on this platform');
  });
});

describe('statsReport', () => {
  it('gives the Conductor plain numbers with the age and staleness', () => {
    expect(statsReport(machine({ stats: sample() }), live, NOW)).toEqual({
      stats: {
        sampledAt: '2026-11-14T17:59:55Z', ageSeconds: 5, stale: false, cpuPercent: 23.4, cores: 12, loadAverage: [3.7, 6.29, 13.21],
        memory: { usedGB: 17.8, totalGB: 24, percent: 74, source: 'vm_stat' },
      },
      statsNote: null,
    });
    expect(statsReport(machine(), live, NOW)).toEqual({ stats: null, statsNote: 'No CPU or memory stats from it yet' });
  });
});

describe('awaitingStats', () => {
  const view = (machines: MachineLoad[], syncLive = true) => ({ syncLive, lastSyncAt: null, machines });
  const old = sample({ sampledAt: '2026-11-14T17:00:00Z' });

  it('waits for a first CPU share here, and for an online machine with an old sample', () => {
    expect(awaitingStats(view([machine({ here: true, stats: sample({ cpu: null }) })]), NOW)).toBe(true);
    expect(awaitingStats(view([machine({ here: true, stats: sample() }), machine({ stats: old })]), NOW)).toBe(true);
    expect(awaitingStats(view([machine({ here: true, stats: sample() }), machine({ stats: sample() })]), NOW)).toBe(false);
  });

  it('does not wait for an offline machine, one that never sent stats, or while sync is not live', () => {
    const here = machine({ here: true, stats: sample() });
    expect(awaitingStats(view([here, machine({ reachability: 'offline', stats: old })]), NOW)).toBe(false);
    expect(awaitingStats(view([here, machine()]), NOW)).toBe(false);
    expect(awaitingStats(view([here, machine({ stats: old })], false), NOW)).toBe(false);
  });
});
