import { describe, expect, it, vi } from 'vitest';

// Guard: the Pinned rules are pure. They may not open data/omni.db.
vi.mock('@omni/server/db.ts', () => {
  throw new Error('db.ts must not be imported by pins tests');
});

import { pinnedRows, withPin, type PinnedThread } from '../src/pins.ts';

const at = '2026-10-10T00:00:00.000Z';
const pin = (id: string, pinned_at: string, status: PinnedThread['status'] = 'done'): PinnedThread => ({ id, channel_id: 'c', title: id, status, created_at: at, pinned_at });

describe('pinnedRows', () => {
  it("shows the open thread's fresher copy in its own place", () => {
    const list = [pin('a', '2026-10-12'), pin('b', '2026-10-11')];
    const rows = pinnedRows(list, { id: 'b', channel_id: 'c', title: 'Renamed', status: 'running', created_at: at });
    expect(rows.map((t) => [t.id, t.title, t.status, t.pinned_at])).toEqual([
      ['a', 'a', 'done', '2026-10-12'],
      ['b', 'Renamed', 'running', '2026-10-11'],
    ]);
  });

  it('never adds the open thread when it is not pinned', () => {
    expect(pinnedRows([pin('a', '2026-10-12')], { id: 'x', channel_id: 'c', title: 'x', status: 'done', created_at: at }).map((t) => t.id)).toEqual(['a']);
  });
});

describe('withPin', () => {
  const list = [pin('a', '2026-10-12'), pin('b', '2026-10-11')];

  it('puts a new pin on top', () => {
    expect(withPin(list, { id: 'c', channel_id: 'c', title: 'c', status: 'done', created_at: at }, true, '2026-10-13').map((t) => [t.id, t.pinned_at])).toEqual([
      ['c', '2026-10-13'],
      ['a', '2026-10-12'],
      ['b', '2026-10-11'],
    ]);
  });

  it('keeps a thread that is pinned already where it is', () => {
    expect(withPin(list, list[1]!, true)).toBe(list);
  });

  it('takes an unpinned thread out', () => {
    expect(withPin(list, list[0]!, false).map((t) => t.id)).toEqual(['b']);
  });
});
