// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedEvent, Thread } from '../src/api.ts';

// U3: the channel screens list every thread page by page from GET /channels/:id/threads?paged=1, not the sidebar's
// previews, and keep the list live from /feed.

const gets: string[] = [];
let answer: (path: string) => unknown = () => [];
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async (path: string) => {
    gets.push(path);
    return answer(path);
  }) as typeof actual.api.get;
  return actual;
});
let feed: ((e: FeedEvent) => void) | null = null;
vi.mock('../src/store.tsx', () => ({
  useFeed: (fn: (e: FeedEvent) => void) => {
    feed = fn;
  },
}));

import { useChannelThreads } from '../src/app/useChannelThreads.ts';

const t = (id: string, updated_at: string, extra: Partial<Thread> = {}) => ({ id, channel_id: 'acme', updated_at, archived: 0, ...extra }) as unknown as Thread;
const accept = (x: Thread) => x.channel_id === 'acme';

let hook: ReturnType<typeof useChannelThreads>;
function Probe({ id }: { id: string }) {
  hook = useChannelThreads(id, accept);
  return null;
}
let root: Root;
const flush = () => act(async () => {});
const mount = async (id = 'acme') => {
  await act(async () => root.render(createElement(Probe, { id })));
  await flush();
};

beforeEach(() => {
  gets.length = 0;
  feed = null;
  root = createRoot(document.createElement('div'));
});
afterEach(() => act(() => root.unmount()));

describe('useChannelThreads', () => {
  it('pages with the server cursor until next is null', async () => {
    answer = (p) =>
      p.includes('cursor=') ? { threads: [t('c', '2026-01-01'), t('b', '2026-01-02')], next: null } : { threads: [t('a', '2026-01-03'), t('b', '2026-01-02')], next: 'n1' };
    await mount();
    expect(gets).toEqual(['/channels/acme/threads?paged=1&limit=50']);
    expect(hook.data!.map((x) => x.id)).toEqual(['a', 'b']);
    expect(hook.more).toBe(true);

    await act(() => hook.loadMore());
    expect(gets[1]).toBe('/channels/acme/threads?paged=1&limit=50&cursor=n1');
    expect(hook.data!.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(hook.more).toBe(false);
  });

  it('takes an older server plain array as the whole list', async () => {
    answer = () => [t('a', '2026-01-03'), t('b', '2026-01-02')];
    await mount();
    expect(hook.data!.map((x) => x.id)).toEqual(['a', 'b']);
    expect(hook.more).toBe(false);
  });

  it('keeps the list live: a new thread shows, an archived one leaves, another channel is ignored', async () => {
    answer = () => ({ threads: [t('a', '2026-01-03'), t('b', '2026-01-02')], next: null });
    await mount();
    await act(async () => feed!({ type: 'thread', thread: t('new', '2026-01-04') } as FeedEvent));
    await act(async () => feed!({ type: 'thread', thread: t('b', '2026-01-05', { archived: 1 }) } as FeedEvent));
    await act(async () => feed!({ type: 'thread', thread: t('x', '2026-01-06', { channel_id: 'other' } as Partial<Thread>) } as FeedEvent));
    expect(hook.data!.map((x) => x.id)).toEqual(['new', 'a']);
  });

  it('drops an older page that lands after switching channel', async () => {
    let release!: (v: unknown) => void;
    answer = (p) => (p.includes('cursor=') ? new Promise((r) => (release = r)) : { threads: [t('a', '2026-01-03')], next: 'n1' });
    await mount('acme');
    let more!: Promise<void>;
    act(() => void (more = hook.loadMore()));
    answer = () => ({ threads: [t('z', '2026-01-09', { channel_id: 'other' } as Partial<Thread>)], next: null });
    await mount('other');
    await act(async () => {
      release({ threads: [t('old', '2026-01-01')], next: null });
      await more;
    });
    expect(hook.data!.map((x) => x.id)).toEqual(['z']);
  });
});
