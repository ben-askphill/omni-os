import { describe, expect, it } from 'vitest';
import { DONE_INITIAL, DONE_PAGE, inboxCandidates, inboxLayout, shelfView, type ShelfThread } from '../inbox-shelves.ts';

const t = (id: string, over: Partial<ShelfThread> = {}): ShelfThread => ({
  id,
  status: 'done',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...over,
});
const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);
const none = new Set<string>();

describe('inboxLayout', () => {
  it('puts each thread on one shelf: done, pinned, working, else the inbox', () => {
    const layout = inboxLayout({
      threads: [
        t('done', { done_at: '2026-10-02T00:00:00.000Z', pinned_at: '2026-10-02T00:00:00.000Z' }),
        t('pinned', { pinned_at: '2026-10-02T00:00:00.000Z', status: 'running' }),
        t('running', { status: 'running' }),
        t('queued', { status: 'queued' }),
        t('delegating', { status: 'done', delegating: true }),
        t('idle'),
      ],
      needs: [],
      delegated: none,
    });
    expect(ids(layout.done)).toEqual(['done']);
    expect(ids(layout.pinned)).toEqual(['pinned']);
    expect(ids(layout.working).sort()).toEqual(['delegating', 'queued', 'running']);
    expect(ids(layout.inbox)).toEqual(['idle']);
  });

  it('keeps a running thread that waits on Ben in the inbox', () => {
    const layout = inboxLayout({ threads: [t('asks', { status: 'running' })], needs: [{ thread: { id: 'asks' }, at: null, blockers: [{ kind: 'question' }] }], delegated: none });
    expect(ids(layout.inbox)).toEqual(['asks']);
    expect(layout.working).toEqual([]);
  });

  it('leaves out archived, team and delegated threads', () => {
    const layout = inboxLayout({ threads: [t('a', { archived: 1 }), t('b', { source: 'team' }), t('c'), t('d')], needs: [], delegated: new Set(['c']) });
    expect(ids(layout.inbox)).toEqual(['d']);
  });

  it('sorts the inbox by when each thread came back, newest first, ties by id', () => {
    const layout = inboxLayout({
      threads: [t('old', { updated_at: '2026-10-05T00:00:00.000Z' }), t('b'), t('a'), t('back')],
      needs: [{ thread: { id: 'back' }, at: '2026-10-09T00:00:00.000Z', blockers: [] }],
      delegated: none,
    });
    expect(ids(layout.inbox)).toEqual(['back', 'old', 'a', 'b']);
  });

  it('lets the later copy of a thread and then the open thread win', () => {
    const layout = inboxLayout({ threads: [t('x', { status: 'running' }), t('x', { status: 'done' })], needs: [], delegated: none, open: { id: 'x', status: 'queued' } });
    expect(ids(layout.working)).toEqual(['x']);
    expect(inboxLayout({ threads: [t('x')], needs: [], delegated: none, open: { id: 'y', status: 'running' } }).working).toEqual([]);
  });
});

describe('inboxCandidates', () => {
  it('lists recent, pinned, each channel running, then Needs you, so the later copy wins', () => {
    const out = inboxCandidates({ recent: [t('r')], pinned: [t('p')], channels: [{ active: [t('c1')] }, { active: null }, {}], needs: [{ thread: t('n') }] });
    expect(ids(out)).toEqual(['r', 'p', 'c1', 'n']);
    expect(ids(inboxCandidates({ recent: null, pinned: [], channels: null, needs: [] }))).toEqual([]);
  });
});

describe('shelfView', () => {
  const list = Array.from({ length: 40 }, (_, i) => t(`d${i}`));

  it('pages an open shelf and counts what Show more adds', () => {
    expect(shelfView(list, { open: true, limit: DONE_INITIAL })).toMatchObject({ count: 40, more: DONE_PAGE });
    expect(shelfView(list, { open: true, limit: DONE_INITIAL }).rows).toHaveLength(DONE_INITIAL);
    expect(shelfView(list, { open: true, limit: DONE_INITIAL + DONE_PAGE }).more).toBe(5);
    expect(shelfView(list, { open: true }).more).toBe(0);
  });

  it('shows nothing folded but the open thread, which also stays past the limit', () => {
    expect(ids(shelfView(list, { open: false, openId: 'd30' }).rows)).toEqual(['d30']);
    expect(shelfView(list, { open: false }).rows).toEqual([]);
    expect(ids(shelfView(list, { open: true, openId: 'd30', limit: 2 }).rows)).toEqual(['d0', 'd1', 'd30']);
  });
});
