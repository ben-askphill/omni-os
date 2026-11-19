import { describe, expect, it } from 'vitest';
import { askableRoles, askCaption, askLabel, askOf, excerptSize, roleRows } from '../ask.ts';

const ROLES = [
  { id: 'conductor', name: 'Conductor', harness: 'claude-code', delegatable: false, delegateOnly: true, hidden: false },
  { id: 'builder', name: 'Builder', harness: 'claude-code', delegatable: true, delegateOnly: false, hidden: false },
  { id: 'researcher', name: 'Researcher', delegatable: true, delegateOnly: false, hidden: false },
  { id: 'hermes-box', name: 'Hermes on box', harness: 'custom:hermes-box', delegatable: true, delegateOnly: false, hidden: false },
  { id: 'old', name: 'Old', delegatable: true, delegateOnly: false, hidden: true },
  { id: 'router', name: 'Router', delegatable: true, delegateOnly: true, hidden: false },
];

describe('askableRoles', () => {
  it('lists the roles a delegation may go to, shown and doing work, without the thread own role', () => {
    const roles = askableRoles(ROLES, 'builder');
    expect(roles.map((r) => r.id)).toEqual(['researcher', 'hermes-box']);
    expect(roles.find((r) => r.id === 'hermes-box')).toEqual({ id: 'hermes-box', name: 'Hermes on box', harness: 'custom:hermes-box', remote: true });
    expect(roles.find((r) => r.id === 'researcher')).toMatchObject({ harness: null, remote: false });
  });
});

describe('roleRows', () => {
  it('matches an id or a word of the name, remote roles first', () => {
    const roles = askableRoles(ROLES);
    expect(roleRows(roles, '').map((r) => r.id)).toEqual(['hermes-box', 'builder', 'researcher']);
    expect(roleRows(roles, 'b').map((r) => r.id)).toEqual(['hermes-box', 'builder']);
    expect(roleRows(roles, 'RES').map((r) => r.id)).toEqual(['researcher']);
    expect(roleRows(roles, 'zz')).toEqual([]);
  });
});

describe('askOf', () => {
  const roles = askableRoles(ROLES);
  it('reads a message that starts with a role as an Ask to it', () => {
    expect(askOf('@hermes-box what do the logs say?', roles)).toMatchObject({ role: { id: 'hermes-box' }, question: 'what do the logs say?' });
    expect(askOf('  @Researcher\nfind the paper', roles)).toMatchObject({ role: { id: 'researcher' }, question: 'find the paper' });
    expect(askOf('@builder', roles)).toMatchObject({ role: { id: 'builder' }, question: '' });
  });

  it('leaves everything else a message: a mention later on, a file, a role Ben cannot ask', () => {
    expect(askOf('ask @researcher about it', roles)).toBeNull();
    expect(askOf('@src/app.ts is broken', roles)).toBeNull();
    expect(askOf('@conductor do this', roles)).toBeNull();
    expect(askOf('@builders do this', roles)).toBeNull();
  });
});

describe('labels', () => {
  it('names the role and whether it is remote, and sizes the excerpt', () => {
    expect(askLabel({ name: 'Hermes on box', remote: true })).toBe('Ask Hermes on box (remote)');
    expect(askLabel({ name: 'Researcher', remote: false })).toBe('Ask Researcher');
    expect(excerptSize({ entries: 12, total: 40, chars: 3120 })).toBe('last 12 of 40 messages, 3.1k characters');
    expect(excerptSize({ entries: 1, total: 1, chars: 80 })).toBe('all 1 message, 80 characters');
    expect(askCaption({ name: 'Hermes on box', remote: true, excerpt: { entries: 12, total: 40, chars: 3120 }, wake: true })).toBe(
      'Asked Hermes on box (remote) · with 12 messages of this thread · the answer wakes this thread',
    );
    expect(askCaption({ name: 'Researcher', remote: false, excerpt: null, wake: false })).toBe('Asked Researcher · no thread excerpt · the answer only shows here');
  });
});
