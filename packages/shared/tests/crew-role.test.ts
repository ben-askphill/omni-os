import { describe, expect, it } from 'vitest';
import { builtInAgent, crewRoleName, headerShowsRole, isConductor } from '../crew-role.ts';

describe('crewRoleName', () => {
  it('names no role for a thread not started as one', () => {
    expect(crewRoleName(null)).toBeNull();
    expect(crewRoleName(undefined)).toBeNull();
  });

  it('uses the name the charter gives the role', () => {
    const crew = [{ id: 'inbox', name: 'Inbox and admin' }, { id: 'builder', name: 'Builder' }];
    expect(crewRoleName('inbox', crew)).toBe('Inbox and admin');
    expect(crewRoleName('builder', crew)).toBe('Builder');
  });

  it('falls back to the built-in name before the roles load, then to the stored id', () => {
    expect(crewRoleName('store-ops')).toBe('Store ops');
    expect(crewRoleName('researcher', [{ id: 'researcher', name: '  ' }])).toBe('Researcher');
    expect(crewRoleName('usage-scan')).toBe('Usage scan');
    expect(['conductor', 'researcher', 'builder', 'store-ops', 'inbox'].map((id) => builtInAgent(id)?.name)).toEqual(['Conductor', 'Researcher', 'Builder', 'Store ops', 'Admin']);
    expect(builtInAgent('toString')).toBeUndefined();
    expect(crewRoleName('toString')).toBe('toString');
    // A charter removed after the thread ran: the id it was stored with, never a guess.
    expect(crewRoleName('my-role', [{ id: 'builder', name: 'Builder' }])).toBe('my-role');
  });

  it('looks an agent up by id where the caller has no list (the server reads one charter)', () => {
    const lookup = (id: string) => (id === 'builder' ? { id, name: 'Code builder' } : undefined);
    expect(crewRoleName('builder', lookup)).toBe('Code builder');
    expect(crewRoleName('reviewer', lookup)).toBe('Reviewer');
    expect(crewRoleName(null, lookup)).toBeNull();
  });
});

describe('isConductor', () => {
  it('is the Conductor agent only, not every thread in #conductor', () => {
    expect(isConductor('conductor')).toBe(true);
    expect(isConductor('builder')).toBe(false);
    expect(isConductor(null)).toBe(false);
  });
});

describe('headerShowsRole', () => {
  it('shows a crew role, not on a thread without one', () => {
    expect(headerShowsRole({ role: 'builder', channel_id: 'omni-os' })).toBe(true);
    expect(headerShowsRole({ role: null, channel_id: 'omni-os' })).toBe(false);
  });

  it('leaves it out on the Conductor own threads, which say so already', () => {
    expect(headerShowsRole({ role: 'conductor', channel_id: 'conductor' })).toBe(false);
    expect(headerShowsRole({ role: 'conductor', channel_id: 'omni-os' })).toBe(true);
  });
});
