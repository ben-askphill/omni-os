import { describe, expect, it } from 'vitest';
import { api, at } from './api-helpers.ts';

describe('channel thread pages', () => {
  it('asks for the first page, then the next by the server cursor', async () => {
    const a = api({ json: { threads: [{ id: 't1' }], next: 'abc' } });
    expect(await a.api.channelThreadsPage('a/b')).toEqual({ threads: [{ id: 't1' }], next: 'abc' });
    await a.api.channelThreadsPage('a/b', 'abc', 20);
    expect(a.sent.map((s) => s.url)).toEqual([at('/channels/a%2Fb/threads?paged=1&limit=50'), at('/channels/a%2Fb/threads?paged=1&limit=20&cursor=abc')]);
  });

  it('reads an older server plain list as one last page', async () => {
    const a = api({ json: [{ id: 't1' }, { id: 't2' }] });
    expect(await a.api.channelThreadsPage('c')).toEqual({ threads: [{ id: 't1' }, { id: 't2' }], next: null });
  });
});
