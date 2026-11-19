import { beforeEach, describe, expect, it } from 'vitest';
import { apiBase, apiUrl, movedSince, onApiBase, rememberApiBase, resetApiBase, sharedApiUrl, takeApiParam } from '../src/api-base.ts';

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
    expect(takeApiParam({ pathname: '/', search: `?api=${encodeURIComponent(KEY)}`, hash: '#/t/abc' }, s, true)).toBe('/#/t/abc');
    expect(apiBase(s)).toBe(KEY);
    expect(takeApiParam({ pathname: '/', search: `?x=1&api=${KEY}`, hash: '' }, s, true)).toBe('/?x=1');
  });

  it("takes it only in the desktop app, and only a keyed path, so a link from another site cannot unpair a browser", () => {
    const s = memoryStore();
    rememberApiBase(KEY, s);
    resetApiBase();
    expect(takeApiParam({ pathname: '/', search: '?api=%2Fapi', hash: '#/' }, s, false)).toBe('/#/');
    expect(takeApiParam({ pathname: '/', search: `?api=/api/k/${'ef56'.repeat(8)}`, hash: '#/' }, s, false)).toBe('/#/');
    expect(takeApiParam({ pathname: '/', search: '?api=%2Fapi', hash: '#/' }, s, true)).toBe('/#/');
    expect(apiBase(s)).toBe(KEY);
  });

  it('leaves an address without one alone', () => {
    expect(takeApiParam({ pathname: '/', search: '', hash: '#/' }, memoryStore(), true)).toBeNull();
  });
});

describe('movedSince', () => {
  it('tells a check another tab overtook: it went to /api, and that tab has since kept a keyed path', () => {
    const s = memoryStore();
    expect(movedSince('/api', s)).toBe(false);
    rememberApiBase(KEY, s);
    expect(movedSince('/api', s)).toBe(true);
    expect(movedSince(KEY, s)).toBe(false);
  });
});

describe('sharedApiUrl', () => {
  it('copies an /api address without the key, which stays on this origin', () => {
    const s = memoryStore();
    rememberApiBase(KEY, s);
    expect(sharedApiUrl(`${KEY}/artifacts/1/raw?v=2`, 'http://127.0.0.1:4747/#/t/x')).toBe('http://127.0.0.1:4747/api/artifacts/1/raw?v=2');
    expect(sharedApiUrl('/api/artifacts/1/raw', 'https://box.tail1.ts.net/')).toBe('https://box.tail1.ts.net/api/artifacts/1/raw');
  });
});
