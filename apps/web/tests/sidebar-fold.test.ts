import { describe, expect, it } from 'vitest';
import type { FolderWithThreads } from '../src/api.ts';
import { closedChannels, foldAllAction, openFolderIds, opensOnVisit, savedFold } from '../src/sidebar-fold.ts';

const at = '2026-10-10T00:00:00.000Z';
const folder = (id: string, collapsed = 0): FolderWithThreads => ({
  id, channel_id: 'c', parent_id: null, name: id, position: null, collapsed, created_at: at, updated_at: at, count: 0, running: 0, threads: [],
});

describe('foldAllAction', () => {
  const channels = [{ id: 'conductor' }, { id: 'acme' }, { id: 'omni' }];

  it('collapses while any channel is open', () => {
    expect(foldAllAction(channels, new Set())).toBe('collapse');
    expect(foldAllAction(channels, new Set(['conductor', 'acme']))).toBe('collapse');
  });

  it('expands once every channel is closed', () => {
    expect(foldAllAction(channels, new Set(['conductor', 'acme', 'omni']))).toBe('expand');
    // A channel that is gone does not keep it collapsing.
    expect(foldAllAction(channels, new Set(['conductor', 'acme', 'omni', 'gone']))).toBe('expand');
  });
});

describe('openFolderIds', () => {
  it('lists every open folder across channels, skipping closed ones and unsaved stand-ins', () => {
    const channels = [
      { id: 'acme', folders: [folder('a'), folder('b', 1)] },
      { id: 'omni', folders: [folder('tmp-1'), folder('c')] },
      { id: 'bare' },
    ];
    expect(openFolderIds(channels)).toEqual(['a', 'c']);
  });
});

describe('closedChannels', () => {
  it('starts with the Conductor closed and every other channel open', () => {
    expect([...closedChannels([], false)]).toEqual(['conductor']);
  });

  it('keeps channels closed before this rule, and reads the Conductor only from its own pref', () => {
    expect([...closedChannels(['acme'], false)].sort()).toEqual(['acme', 'conductor']);
    expect([...closedChannels(['acme', 'conductor'], true)]).toEqual(['acme']);
  });

  it('round-trips through what it saves', () => {
    for (const closed of [new Set<string>(), new Set(['conductor']), new Set(['acme', 'conductor']), new Set(['acme'])]) {
      const { channels, conductorOpen } = savedFold(closed);
      expect(closedChannels(channels, conductorOpen)).toEqual(closed);
    }
  });
});

describe('opensOnVisit', () => {
  it('opens a channel on a visit, but not the Conductor', () => {
    expect(opensOnVisit('acme')).toBe(true);
    expect(opensOnVisit('conductor')).toBe(false);
  });
});
