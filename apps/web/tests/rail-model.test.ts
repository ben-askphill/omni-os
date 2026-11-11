import { describe, expect, it } from 'vitest';
import { listMode, monogram, needsByChannel, railBadge, railGroups, railSelection } from '../src/rail-model.ts';

const ch = (id: string, name: string, kind: string, extra: { archived?: boolean; running?: number } = {}) => ({ id, name, kind, running: 0, ...extra });

describe('railGroups', () => {
  it('puts clients first, then internal before personal, each A to Z, without the Conductor or archived channels', () => {
    const g = railGroups([
      ch('conductor', 'Conductor', 'system'),
      ch('volero', 'Volero', 'client'),
      ch('acne', 'Acne Studios', 'client'),
      ch('omni', 'Omni OS', 'personal'),
      ch('phill', 'Phillbert', 'internal'),
      ch('old', 'Old client', 'client', { archived: true }),
      ch('brain', 'Central Brain', 'internal'),
    ]);
    expect(g.clients.map((c) => c.id)).toEqual(['acne', 'volero']);
    expect(g.rest.map((c) => c.id)).toEqual(['brain', 'phill', 'omni']);
  });
});

describe('railSelection', () => {
  it('selects the channel of a channel page and of an open thread', () => {
    expect(railSelection({ name: 'channel', id: 'acne', tab: 'threads' }, null)).toEqual({ kind: 'channel', id: 'acne' });
    expect(railSelection({ name: 'thread', id: 't1' }, { id: 't1', channel_id: 'volero' })).toEqual({ kind: 'channel', id: 'volero' });
  });

  it('falls back to Home while the thread loads and for workspace pages', () => {
    expect(railSelection({ name: 'thread', id: 't1' }, { id: 't0', channel_id: 'volero' })).toEqual({ kind: 'home' });
    expect(railSelection({ name: 'prs' }, null)).toEqual({ kind: 'home' });
    expect(railSelection({ name: 'artifacts' }, null)).toEqual({ kind: 'home' });
  });

  it('selects Settings and the add-channel control on their pages', () => {
    expect(railSelection({ name: 'settings' }, null)).toEqual({ kind: 'settings' });
    expect(railSelection({ name: 'new-channel' }, null)).toEqual({ kind: 'new-channel' });
  });
});

describe('monogram', () => {
  it('takes two initials from two words, else the first two letters', () => {
    expect(monogram('Acne Studios')).toBe('AS');
    expect(monogram('Kamera Express')).toBe('KE');
    expect(monogram('Patta')).toBe('Pa');
    expect(monogram('omni-os')).toBe('OO');
    expect(monogram('Omni OS')).toBe('OS');
    expect(monogram('X')).toBe('X');
    expect(monogram('  ')).toBe('?');
  });
});

describe('badges', () => {
  it('shows needs over running, and nothing when idle', () => {
    expect(railBadge(2, 1)).toBe('needs');
    expect(railBadge(1, 0)).toBe('running');
    expect(railBadge(0, 0)).toBeNull();
  });

  it('counts only items with a blocker per channel', () => {
    const m = needsByChannel([
      { thread: { channel_id: 'a' }, blockers: [{}] },
      { thread: { channel_id: 'a' }, blockers: [] },
      { thread: { channel_id: 'b' }, blockers: [{}, {}] },
    ]);
    expect([...m]).toEqual([['a', 1], ['b', 1]]);
  });
});

describe('listMode', () => {
  it('shows a channel list for a channel, else Home or the Inbox', () => {
    expect(listMode({ kind: 'channel', id: 'x' }, true)).toEqual({ kind: 'channel', id: 'x' });
    expect(listMode({ kind: 'home' }, true)).toEqual({ kind: 'inbox' });
    expect(listMode({ kind: 'settings' }, false)).toEqual({ kind: 'home' });
  });
});
