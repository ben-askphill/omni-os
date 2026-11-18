import { beforeEach, describe, expect, it } from 'vitest';
import { apiBase, apiUrl, onApiBase, rememberApiBase, resetApiBase, takeApiParam } from '../src/api-base.ts';

// Where the page's /api requests go (apps/server/browser-session.ts): /api, or the session cookie's own keyed path,
// kept in localStorage on this origin.

const KEY = `/api/k/${'ab12'.repeat(8)}`;

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

beforeEach(resetApiBase);

describe('apiBase', () => {
  it('is /api until the server names a path, then that path', () => {
    const s = memoryStore();
    expect(apiBase(s)).toBe('/api');
    rememberApiBase(KEY, s);
    expect(apiBase(s)).toBe(KEY);
    expect(apiUrl('/threads?x=1', s)).toBe(`${KEY}/threads?x=1`);
  });

  it('keeps only a path of the right shape', () => {
    const s = memoryStore();
    for (const bad of ['/api/k/zz', 'https://evil.example/api', '/api/k/AB12AB12AB12AB12AB12AB12AB12AB12', '//evil', 42, null]) rememberApiBase(bad, s);
    expect(s.m.size).toBe(0);
    s.m.set('omni.api', 'https://evil.example');
    expect(apiBase(s)).toBe('/api');
  });

  it('still works for this page when storage is refused', () => {
    const refused = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    rememberApiBase(KEY, refused);
    expect(apiBase(refused)).toBe(KEY);
  });

  it('puts the PR image proxy on the base, and leaves other sources alone', () => {
    const s = memoryStore();
    rememberApiBase(KEY, s);
    expect(onApiBase('/api/channels/c/prs/1/image?src=x', s)).toBe(`${KEY}/channels/c/prs/1/image?src=x`);
    expect(onApiBase('data:image/png;base64,AAAA', s)).toBe('data:image/png;base64,AAAA');
  });
});

describe('takeApiParam', () => {
  it("keeps the desktop app's ?api= and gives the address without it", () => {
    const s = memoryStore();
    expect(takeApiParam({ pathname: '/', search: `?api=${encodeURIComponent(KEY)}`, hash: '#/t/abc' }, s)).toBe('/#/t/abc');
    expect(apiBase(s)).toBe(KEY);
    expect(takeApiParam({ pathname: '/', search: `?x=1&api=${KEY}`, hash: '' }, s)).toBe('/?x=1');
  });

  it('leaves an address without one alone', () => {
    expect(takeApiParam({ pathname: '/', search: '', hash: '#/' }, memoryStore())).toBeNull();
  });
});
