import { describe, expect, it } from 'vitest';
import { harnessLine, machineTile, type MachineLoad } from '../machines.ts';

const NOW = Date.parse('2026-11-14T18:00:00Z');
const live = { syncLive: true, lastSyncAt: '2026-11-14T17:59:50Z' };

const machine = (o: Partial<MachineLoad> = {}): MachineLoad => ({
  id: 'mac-b', name: "Ben's MacBook Pro", here: false, reachability: 'online', lastSeen: null, lastChangeAt: null,
  running: 0, queued: 0, delegated: 0, agents: null, needsYou: 0,
  harnesses: [{ id: 'claude-code', running: 0, queued: 0, cap: 12 }, { id: 'codex', running: 0, queued: 0, cap: 4 }],
  threadIds: [], ...o,
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
