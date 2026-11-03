import { describe, expect, it, vi } from 'vitest';

vi.mock('@omni/server/db.ts', () => {
  throw new Error('db.ts must not be imported by inbox tests');
});

import type { NeedsYouItem, Thread } from '../src/api.ts';
import { inboxLayout, rowStatus, shelfView, type InboxThread } from '../src/inbox.ts';

const t = (id: string, over: Partial<InboxThread> = {}): InboxThread => ({
  id,
  channel_id: 'c',
  title: id,
  status: 'done',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...over,
});
const need = (id: string, at: string, blockers: NeedsYouItem['blockers'] = []): NeedsYouItem => ({
  thread: { id } as Thread,
  result: blockers.length ? null : { uid: `r-${id}`, status: 'done', event_uid: null, at },
  blockers,
  at,
});
const ids = (list: InboxThread[]) => list.map((x) => x.id);
const none = new Set<string>();

describe('inboxLayout', () => {
  it('puts each thread on one shelf: done, pinned, working, else the inbox', () => {
    const l = inboxLayout({
      threads: [
        t('idle'),
        t('run', { status: 'running' }),
        t('queue', { status: 'queued' }),
        t('pin', { pinned_at: '2026-10-02' }),
        t('fin', { done_at: '2026-10-03', pinned_at: '2026-10-02' }),
      ],
      needs: [],
      delegated: none,
      open: null,
    });
    expect(ids(l.pinned)).toEqual(['pin']);
    expect(ids(l.inbox)).toEqual(['idle']);
    expect(ids(l.working)).toEqual(['queue', 'run']);
    expect(ids(l.done)).toEqual(['fin']);
  });

  it('leaves out archived threads, team members and delegated threads', () => {
    const l = inboxLayout({
      threads: [t('a', { archived: 1 }), t('b', { source: 'team' }), t('c'), t('d')],
      needs: [],
      delegated: new Set(['c']),
      open: null,
    });
    expect(ids(l.inbox)).toEqual(['d']);
  });

  it('sorts the inbox by when each thread came back, from Needs you when it knows', () => {
    const l = inboxLayout({
      threads: [t('old', { updated_at: '2026-10-05' }), t('back', { updated_at: '2026-10-01' }), t('mid', { updated_at: '2026-10-03' })],
      needs: [need('back', '2026-10-09')],
      delegated: none,
      open: null,
    });
    expect(ids(l.inbox)).toEqual(['back', 'old', 'mid']);
  });

  it('keeps a running thread that asked a question in the inbox', () => {
    const l = inboxLayout({
      threads: [t('ask', { status: 'running' })],
      needs: [need('ask', '2026-10-02', [{ kind: 'question', detail: 'Which?', count: 1 }])],
      delegated: none,
      open: null,
    });
    expect(ids(l.inbox)).toEqual(['ask']);
    expect(l.working).toEqual([]);
  });

  it('lists a thread once and takes the open copy, so it moves the moment its status changes', () => {
    const l = inboxLayout({
      threads: [t('a', { status: 'running' }), t('a', { status: 'running', pinned_at: null })],
      needs: [],
      delegated: none,
      open: t('a', { status: 'done' }),
    });
    expect(ids(l.inbox)).toEqual(['a']);
    expect(l.working).toEqual([]);
  });

  it('labels a card by what it waits on before what it is doing', () => {
    const question = need('a', '2026-10-02', [{ kind: 'question', detail: null, count: 1 }]);
    expect(rowStatus(t('a', { status: 'running' }), question)?.label).toBe('Input');
    expect(rowStatus(t('a', { status: 'running' }), undefined)?.label).toBe('Working');
    expect(rowStatus(t('a'), undefined, 2)?.label).toBe('Working');
    expect(rowStatus(t('a'), need('a', '2026-10-02'))).toEqual({ glyph: 'done', label: 'Finished' });
    expect(rowStatus(t('a'), undefined)).toBeNull();
  });

  it('sorts done threads by when they were marked done, newest first', () => {
    const l = inboxLayout({
      threads: [t('x', { done_at: '2026-10-01' }), t('y', { done_at: '2026-10-04' })],
      needs: [],
      delegated: none,
      open: null,
    });
    expect(ids(l.done)).toEqual(['y', 'x']);
  });
});

describe('shelfView', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => t(`d${i}`));

  it('lists every thread on an open shelf and only the open thread on a folded one, counting all either way', () => {
    const list = [t('a'), t('b'), t('c')];
    expect(shelfView(list, { open: true, openId: null })).toEqual({ count: 3, rows: list, more: 0 });
    expect(shelfView(list, { open: false, openId: 'b' })).toEqual({ count: 3, rows: [list[1]], more: 0 });
    expect(shelfView(list, { open: false, openId: 'elsewhere' }).rows).toEqual([]);
  });

  it('pages Done: ten rows, then Show more adds up to 25 at a time', () => {
    const list = many(40);
    expect(shelfView(list, { open: true, openId: null, limit: 10 })).toMatchObject({ count: 40, more: 25 });
    expect(shelfView(list, { open: true, openId: null, limit: 10 }).rows).toEqual(list.slice(0, 10));
    expect(shelfView(list, { open: true, openId: null, limit: 35 }).more).toBe(5);
    expect(shelfView(list, { open: true, openId: null, limit: 60 })).toMatchObject({ rows: list, more: 0 });
  });

  it('keeps the open thread listed past the page, and offers no Show more while folded', () => {
    const list = many(15);
    expect(ids(shelfView(list, { open: true, openId: 'd12', limit: 10 }).rows)).toEqual([...ids(list.slice(0, 10)), 'd12']);
    expect(shelfView(list, { open: false, openId: 'd12', limit: 10 })).toEqual({ count: 15, rows: [list[12]], more: 0 });
  });
});
