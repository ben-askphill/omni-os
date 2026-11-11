import { rowState, type FleetMachine, type MachineUpdateStatus } from '@omni/shared/update-fleet.ts';
import { describe, expect, it } from 'vitest';

import { skippedText, updateConfirmation, updateSplit } from '../../src/settings/update-machines-model';

const status = (id: string, over: Partial<MachineUpdateStatus> = {}): MachineUpdateStatus => ({
  id,
  name: id,
  track: 'checkout',
  version: 'aaaa1111',
  available: 'bbbb2222',
  behind: 2,
  phase: 'ready',
  progress: null,
  waitingFor: 0,
  error: null,
  taken: {},
  since: '2026-11-11T08:00:00Z',
  ...over,
});

function machine(over: Partial<FleetMachine> & { id: string }): FleetMachine {
  const m = { name: over.id, current: false, reach: 'online' as const, status: status(over.id), ask: null, ...over };
  return { ...m, state: over.state ?? rowState(m) };
}

const fleet = [
  machine({ id: 'air', current: true }),
  machine({ id: 'studio', status: status('studio', { track: 'desktop', version: '0.4.1', available: '0.4.2', behind: null }) }),
  machine({ id: 'omarchy', reach: 'offline' }),
  machine({ id: 'old', status: null }),
  machine({ id: 'manual', status: status('manual', { track: 'manual' }) }),
];

describe('updateSplit', () => {
  it('asks reporting online machines that can apply, and leaves out offline, old and by-hand ones', () => {
    const { asked, left } = updateSplit(fleet);
    expect(asked.map((m) => m.id)).toEqual(['air', 'studio']);
    expect(left.map((m) => m.id)).toEqual(['omarchy', 'old', 'manual']);
  });
});

describe('updateConfirmation', () => {
  it('names who gets asked, who is left out and why, and that the server restarts too', () => {
    const c = updateConfirmation(fleet)!;
    expect(c.title).toBe('Update 2 machines?');
    expect(c.confirmLabel).toBe('Update 2 machines');
    expect(c.message).toContain('air: 2 new commits, ready to update (aaaa1111 → bbbb2222)');
    expect(c.message).toContain('studio: Downloaded, ready to restart (0.4.1 → 0.4.2)');
    expect(c.message).toContain('Left out:\nomarchy. Offline.');
    expect(c.message).toContain('old. Runs an older Omni.');
    expect(c.message).toContain('manual. It cannot apply an update by itself.');
    expect(c.message).toContain('restarts once they finish. The server this phone uses restarts too');
  });

  it('says nothing about this server when it is not asked, and is null when nobody is', () => {
    const c = updateConfirmation([fleet[1]])!;
    expect(c.title).toBe('Update 1 machine?');
    expect(c.message).not.toContain('Left out');
    expect(c.message).not.toContain('this phone');
    expect(updateConfirmation([fleet[2], fleet[3]])).toBeNull();
  });
});

describe('skippedText', () => {
  it('puts each left-out machine on its own line', () => {
    expect(skippedText([{ id: 'a', name: 'A', reason: 'Offline.' }, { id: 'b', name: 'B', reason: 'Already updating.' }])).toBe('A. Offline.\nB. Already updating.');
  });
});
