import type { Thread } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { afterFirstPage, afterNextPage } from '../src/live/channel-pages';

const t = (id: string, updated_at: string) => ({ id, updated_at }) as Thread;
const ids = (p: { threads: Thread[] } | null) => p?.threads.map((x) => x.id);

describe('channel pages', () => {
  it('reads the first page, then appends the next by cursor', () => {
    const first = afterFirstPage(null, 'c', { threads: [t('a', '05'), t('b', '04')], next: 'n1' });
    expect(first).toMatchObject({ next: 'n1', pages: 1 });
    const second = afterNextPage(first, 'c', 'n1', { threads: [t('b', '04'), t('c', '03')], next: null });
    expect(ids(second)).toEqual(['a', 'b', 'c']);
    expect(second).toMatchObject({ next: null, pages: 2 });
  });

  it('keeps the older pages and their cursor when the first page refreshes', () => {
    let p = afterFirstPage(null, 'c', { threads: [t('a', '05'), t('b', '04')], next: 'n1' });
    p = afterNextPage(p, 'c', 'n1', { threads: [t('c', '03'), t('d', '02')], next: 'n2' })!;
    const fresh = afterFirstPage(p, 'c', { threads: [t('new', '09'), t('a', '05')], next: 'm1' });
    expect(ids(fresh)).toEqual(['new', 'a', 'b', 'c', 'd']);
    expect(fresh).toMatchObject({ next: 'n2', pages: 2 });
  });

  it('starts over for another channel, and drops a page meant for a cursor it moved past', () => {
    const p = afterFirstPage(null, 'c', { threads: [t('a', '05')], next: 'n1' });
    expect(ids(afterFirstPage(p, 'other', { threads: [t('z', '01')], next: null }))).toEqual(['z']);
    expect(afterNextPage(p, 'other', 'n1', { threads: [t('x', '01')], next: null })).toBe(p);
    expect(afterNextPage(p, 'c', 'stale', { threads: [t('x', '01')], next: null })).toBe(p);
  });
});
