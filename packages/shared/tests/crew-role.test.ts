import { describe, expect, it } from 'vitest';
import { crewRoleName, headerShowsRole } from '../crew-role.ts';

describe('crewRoleName', () => {
  it('names no role for a thread not started as one', () => {
    expect(crewRoleName(null)).toBeNull();
    expect(crewRoleName(undefined)).toBeNull();
    expect(crewRoleName('')).toBeNull();
  });

  it('uses the name the charter gives the role', () => {
    const crew = [{ id: 'inbox', name: 'Inbox and admin' }, { id: 'builder', name: 'Builder' }];
    expect(crewRoleName('inbox', crew)).toBe('Inbox and admin');
    expect(crewRoleName('builder', crew)).toBe('Builder');
  });

  it('falls back to the built-in label before the roles load, then to the stored id', () => {
    expect(crewRoleName('store-ops')).toBe('Store ops');
    expect(crewRoleName('researcher', [{ id: 'researcher', name: '  ' }])).toBe('Researcher');
    expect(crewRoleName('usage-scan')).toBe('usage-scan');
    // A charter removed after the thread ran: the id it was stored with, never a guess.
    expect(crewRoleName('my-role', [{ id: 'builder', name: 'Builder' }])).toBe('my-role');
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
