import { describe, expect, it } from 'vitest';
import { cameFromInbox, listMode, needsByChannel, railBadge, railGroups, railSelection } from '../src/rail-model.ts';

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

  it('selects the Inbox on the landing page, while a thread loads and for workspace pages', () => {
    expect(railSelection({ name: 'home' }, null)).toEqual({ kind: 'inbox' });
    expect(railSelection({ name: 'thread', id: 't1' }, { id: 't0', channel_id: 'volero' })).toEqual({ kind: 'inbox' });
    expect(railSelection({ name: 'prs' }, null)).toEqual({ kind: 'inbox' });
    expect(railSelection({ name: 'artifacts' }, null)).toEqual({ kind: 'inbox' });
  });

  it('selects Settings and the add-channel control on their pages', () => {
    expect(railSelection({ name: 'settings' }, null)).toEqual({ kind: 'settings' });
    expect(railSelection({ name: 'new-channel' }, null)).toEqual({ kind: 'new-channel' });
  });
  it('keeps the Inbox selected for a thread opened from it, so the panel stays on it', () => {
    const sel = railSelection({ name: 'thread', id: 't1' }, { id: 't1', channel_id: 'volero' }, true);
    expect(sel).toEqual({ kind: 'inbox' });
    expect(listMode(sel)).toEqual({ kind: 'inbox' });
  });
});

describe('cameFromInbox', () => {
  it('is set by every page that shows the Inbox, cleared by a channel, and kept by a thread', () => {
    expect(cameFromInbox({ name: 'home' }, false)).toBe(true);
    expect(cameFromInbox({ name: 'prs' }, false)).toBe(true);
    expect(cameFromInbox({ name: 'settings' }, false)).toBe(true);
    expect(cameFromInbox({ name: 'channel', id: 'acne', tab: 'threads' }, true)).toBe(false);
    expect(cameFromInbox({ name: 'thread', id: 't1' }, true)).toBe(true);
    expect(cameFromInbox({ name: 'thread', id: 't1' }, false)).toBe(false);
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
  it('shows a channel list for a channel, else the Inbox', () => {
    expect(listMode({ kind: 'channel', id: 'x' })).toEqual({ kind: 'channel', id: 'x' });
    expect(listMode({ kind: 'inbox' })).toEqual({ kind: 'inbox' });
    expect(listMode({ kind: 'settings' })).toEqual({ kind: 'inbox' });
  });
});
