import { HERE } from '@omni/shared/thread-machine.ts';
import { describe, expect, it, vi } from 'vitest';

import { loadMachineFacts, machineOf, type FactsApi, type MachineFacts } from '../../src/machine/facts';
import { device, handoff, sync, takeover, unreachable } from './fixtures';

function fakeApi(over: Partial<FactsApi> = {}) {
  const api = {
    syncStatus: vi.fn(async () => sync()),
    devices: vi.fn(async () => [device()]),
    status: vi.fn(async () => ({ device: { name: 'Laptop', here: true } })),
    ...over,
  };
  return api as typeof api & FactsApi;
}

const idle = { status: 'done', blocked: null, handoff: null, takeover: null };

describe('loadMachineFacts', () => {
  it('reads sync, the other machines and this machine name', async () => {
    const api = fakeApi();
    expect(await loadMachineFacts(api)).toMatchObject({ devices: [{ id: 'm2' }], hereName: 'Laptop' });
  });

  it('asks for nothing more when sync does not carry a handoff', async () => {
    const api = fakeApi({ syncStatus: vi.fn(async () => sync({ enabled: false })) });
    const facts = await loadMachineFacts(api);
    expect(facts).toMatchObject({ devices: null, hereName: null });
    expect(api.devices).not.toHaveBeenCalled();
    expect(api.status).not.toHaveBeenCalled();
  });

  it('still lists the machines when only the status route is missing (an older server)', async () => {
    const api = fakeApi({ status: vi.fn(async () => Promise.reject(new Error('404'))) });
    expect(await loadMachineFacts(api)).toMatchObject({ devices: [{ id: 'm2' }], hereName: null });
  });

  it('gives null instead of rejecting when the server cannot answer', async () => {
    expect(await loadMachineFacts(fakeApi({ syncStatus: vi.fn(async () => Promise.reject(unreachable())) }))).toBeNull();
    expect(await loadMachineFacts(fakeApi({ devices: vi.fn(async () => Promise.reject(unreachable())) }))).toBeNull();
  });
});

describe('machineOf', () => {
  const facts = (over: Partial<MachineFacts> = {}): MachineFacts => ({ sync: sync(), devices: [device(), device({ id: 'm3', name: 'Mini', reachability: 'offline', lastSeen: null })], hereName: 'Laptop', ...over });

  it('lists this machine first and the others after it while this machine holds the thread', () => {
    const m = machineOf(facts(), idle);
    expect(m).toMatchObject({ kind: 'holds', value: HERE });
    expect(m?.rows.map((r) => r.label)).toEqual(['Laptop', 'Studio', 'Mini']);
  });

  it('greys out an offline machine with the reason', () => {
    const offline = machineOf(facts(), idle)?.rows.find((r) => r.value === 'm3');
    expect(offline).toMatchObject({ disabled: true, sub: 'Asleep or offline' });
  });

  it('has nothing to pick until the facts are in, with one machine, or with sync off', () => {
    expect(machineOf(null, idle)).toBeNull();
    expect(machineOf(facts({ devices: [] }), idle)).toBeNull();
    expect(machineOf(facts({ sync: sync({ signedOut: true }), devices: null }), idle)).toBeNull();
  });

  it('has nothing to pick while a handoff is under way', () => {
    expect(machineOf(facts(), { ...idle, handoff: handoff() })).toBeNull();
  });

  it('lists the holder first when another machine holds the thread, without any facts', () => {
    const m = machineOf(null, { status: 'done', blocked: null, handoff: null, takeover: takeover() });
    expect(m).toMatchObject({ kind: 'held', value: 'm2' });
    expect(m?.rows.map((r) => r.value)).toEqual(['m2', HERE]);
  });

  it('disables Take over with the server reason', () => {
    const m = machineOf(null, { status: 'running', blocked: 'x', handoff: null, takeover: takeover({ running: true, refused: 'Studio is stopping a turn.' }) });
    expect(m?.rows[1]).toMatchObject({ value: HERE, disabled: true, sub: 'Studio is stopping a turn.' });
  });

  it('says the thread runs here now while a turn runs', () => {
    expect(machineOf(facts(), { ...idle, status: 'running' })?.rows[0]?.sub).toBe('Running here now');
  });
});
