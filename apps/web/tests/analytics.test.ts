// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAnalytics, screenOf, track } from '../src/analytics.ts';

// The Web UI's usage analytics (src/analytics.ts): it posts to its own server only while the server says a key is set
// and the switch is on, and names a screen by its route, never by what it shows.

function serve(state: { enabled: boolean; configured: boolean }) {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(init?.method === 'POST' ? null : JSON.stringify(state), { status: init?.method === 'POST' ? 204 : 200 });
    }),
  );
  return posts;
}

afterEach(() => vi.unstubAllGlobals());

describe('web analytics', () => {
  it('posts nothing while the server has no key', async () => {
    const posts = serve({ enabled: true, configured: false });
    await loadAnalytics();
    track('screen_viewed', { screen: 'home' });
    expect(posts).toEqual([]);
  });

  it('posts nothing with the switch off', async () => {
    const posts = serve({ enabled: false, configured: true });
    await loadAnalytics();
    track('screen_viewed', { screen: 'home' });
    expect(posts).toEqual([]);
  });

  it('posts the event to its own server with the surface once both are set', async () => {
    const posts = serve({ enabled: true, configured: true });
    await loadAnalytics();
    track('screen_viewed', { screen: 'home' });
    expect(posts).toEqual([{ url: expect.stringMatching(/\/api\/analytics\/events$/), body: { event: 'screen_viewed', props: { surface: 'web', screen: 'home' } } }]);
  });

  it('names a screen by its route and tab, never its id or search', () => {
    expect(screenOf({ name: 'thread', id: 'abc-123', view: 'changes' })).toEqual({ screen: 'thread', section: 'changes' });
    expect(screenOf({ name: 'channel', id: 'volero', tab: 'prs' })).toEqual({ screen: 'channel', section: 'prs' });
    expect(screenOf({ name: 'search', q: 'acme checkout' })).toEqual({ screen: 'search' });
  });
});
