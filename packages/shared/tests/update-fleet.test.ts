import { describe, expect, it } from 'vitest';
import { fleetSummary, rowLabel, rowState, skipReason, versionLine, type FleetMachine, type MachineUpdateStatus, type UpdateAsk } from '../update-fleet.ts';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const status = (over: Partial<MachineUpdateStatus> = {}): MachineUpdateStatus => ({
  id: 'b',
  name: 'Box B',
  track: 'checkout',
  version: 'aaaa1111',
  available: 'bbbb2222',
  behind: 3,
  phase: 'ready',
  progress: null,
  waitingFor: 0,
  error: null,
  taken: { a: 'ask-0' },
  since: '2026-11-10T11:00:00Z',
  ...over,
});
const ask = (at: string, over: Partial<UpdateAsk> = {}): UpdateAsk => ({
  id: 'ask-1',
  sender: 'a',
  target: 'b',
  action: 'update',
  at,
  expiresAt: new Date(Date.parse(at) + 30 * 60_000).toISOString(),
  ...over,
});
const row = (over: Partial<Pick<FleetMachine, 'current' | 'reach' | 'status' | 'ask'>>) => ({ current: false, reach: 'online' as const, status: status(), ask: null, ...over });

describe('rowState', () => {
  it('shows the machine’s own phase once it took the newest ask', () => {
    expect(rowState(row({ ask: ask('2026-11-10T10:59:00Z', { id: 'ask-0' }) }), NOW)).toBe('ready');
  });

  it('counts an ask as taken by its id, so a sender whose clock runs behind is not taken for done', () => {
    expect(rowState(row({ ask: ask('2026-11-10T11:55:00Z', { id: 'ask-0' }) }), NOW)).toBe('ready');
    expect(rowState(row({ ask: ask('2026-11-10T11:50:00Z', { id: 'ask-2' }) }), NOW)).toBe('sent');
    expect(rowState(row({ ask: ask('2026-11-10T11:50:00Z', { sender: 'c', id: 'ask-0' }) }), NOW)).toBe('sent');
  });

  it('is sent while the ask waits for the target to sync, and expired once its window passed', () => {
    expect(rowState(row({ ask: ask('2026-11-10T11:50:00Z') }), NOW)).toBe('sent');
    expect(rowState(row({ ask: ask('2026-11-10T11:20:00Z') }), NOW)).toBe('expired');
  });

  it('is offline when a source says so, but a pending ask and a restart still show', () => {
    expect(rowState(row({ reach: 'offline' }), NOW)).toBe('offline');
    expect(rowState(row({ reach: 'offline', ask: ask('2026-11-10T11:50:00Z') }), NOW)).toBe('sent');
    expect(rowState(row({ reach: 'offline', status: status({ phase: 'restarting' }) }), NOW)).toBe('restarting');
    expect(rowState(row({ reach: 'offline', current: true }), NOW)).toBe('ready');
  });

  it('is not reporting for a machine that never wrote a status', () => {
    expect(rowState(row({ status: null }), NOW)).toBe('not-reporting');
    expect(rowState(row({ status: null, reach: 'unknown' }), NOW)).toBe('not-reporting');
  });
});

describe('skipReason', () => {
  it('skips offline machines unless forced, and never ones that cannot take an ask', () => {
    expect(skipReason({ state: 'offline', status: status() }, 'update')).toMatch(/^Offline/);
    expect(skipReason({ state: 'offline', status: status() }, 'update', true)).toBeNull();
    expect(skipReason({ state: 'not-reporting', status: null }, 'check', true)).toMatch(/older Omni/);
  });

  it('does not restart a manual checkout, but checks and downloads there', () => {
    const manual = { state: 'ready' as const, status: status({ track: 'manual' }) };
    expect(skipReason(manual, 'update')).toMatch(/by hand/);
    expect(skipReason(manual, 'download')).toBeNull();
    expect(skipReason(manual, 'check')).toBeNull();
  });

  it('leaves out a machine already doing it', () => {
    expect(skipReason({ state: 'waiting', status: status({ phase: 'waiting' }) }, 'update')).toBe('Already updating.');
    expect(skipReason({ state: 'downloading', status: status({ phase: 'downloading' }) }, 'download')).toBe('Already updating.');
    expect(skipReason({ state: 'checking', status: status({ phase: 'checking' }) }, 'check')).toBe('Already checking.');
    expect(skipReason({ state: 'failed', status: status({ phase: 'failed' }) }, 'update')).toBeNull();
  });
});

describe('labels', () => {
  it('says progress, waiting turns and new commits', () => {
    expect(rowLabel({ state: 'downloading', status: status({ track: 'desktop', progress: 41.6 }) })).toBe('Downloading 42%');
    expect(rowLabel({ state: 'waiting', status: status({ waitingFor: 1 }) })).toBe('Waiting for 1 running turn');
    expect(rowLabel({ state: 'ready', status: status({ behind: 3 }) })).toBe('3 new commits, ready to update');
    expect(rowLabel({ state: 'ready', status: status({ track: 'desktop', behind: null }) })).toBe('Downloaded, ready to restart');
  });

  it('shows the version a machine would move to', () => {
    expect(versionLine(status())).toBe('aaaa1111 → bbbb2222');
    expect(versionLine(status({ available: null }))).toBe('aaaa1111');
    expect(versionLine(null)).toBeNull();
  });

  it('sums up the fleet', () => {
    expect(fleetSummary([{ state: 'up-to-date' }, { state: 'downloading' }, { state: 'failed' }, { state: 'offline' }])).toBe('1 of 4 up to date, 1 in progress, 1 failed');
  });
});
