import { describe, expect, it } from 'vitest';
import { appendPage, channelThreadsPath, readChannelThreadsPage, withFreshFirstPage } from '../channel-threads.ts';

describe('channel thread pages', () => {
  it('asks for the first page, then the next by cursor', () => {
    expect(channelThreadsPath('omni os')).toBe('/channels/omni%20os/threads?paged=1&limit=50');
    expect(channelThreadsPath('omni', 'abc=', 20)).toBe('/channels/omni/threads?paged=1&limit=20&cursor=abc%3D');
  });

  it('reads a paged answer and its cursor', () => {
    expect(readChannelThreadsPage({ threads: [{ id: 'a' }], next: 'n1' })).toEqual({ threads: [{ id: 'a' }], next: 'n1' });
    expect(readChannelThreadsPage({ threads: [], next: null })).toEqual({ threads: [], next: null });
    expect(readChannelThreadsPage({ threads: [{ id: 'a' }], next: '' }).next).toBeNull();
  });

  it('treats an older server plain array as the whole list', () => {
    expect(readChannelThreadsPage([{ id: 'a' }, { id: 'b' }])).toEqual({ threads: [{ id: 'a' }, { id: 'b' }], next: null });
  });

  it('reads nothing from a body it does not know', () => {
    expect(readChannelThreadsPage(null)).toEqual({ threads: [], next: null });
    expect(readChannelThreadsPage({ error: 'x' })).toEqual({ threads: [], next: null });
  });

  it('appends an older page without repeating a thread the list has', () => {
    const have = [
      { id: 'a', v: 2 },
      { id: 'b', v: 2 },
    ];
    expect(appendPage(have, [{ id: 'b', v: 1 }, { id: 'c', v: 1 }])).toEqual([
      { id: 'a', v: 2 },
      { id: 'b', v: 2 },
      { id: 'c', v: 1 },
    ]);
  });
});

describe('withFreshFirstPage', () => {
  const t = (id: string, updated_at: string) => ({ id, updated_at });
  const have = [t('a', '05'), t('b', '04'), t('c', '03'), t('d', '02'), t('e', '01')];

  it('keeps the older pages the fresh first page does not reach', () => {
    expect(withFreshFirstPage(have, { threads: [t('b', '09'), t('a', '05')], next: 'n' }).map((x) => x.id)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('takes a last page as the whole list, so a thread gone from it leaves', () => {
    expect(withFreshFirstPage(have, { threads: [t('a', '05')], next: null }).map((x) => x.id)).toEqual(['a']);
  });
});
