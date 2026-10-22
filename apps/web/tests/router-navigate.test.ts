import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { href, navigate, parseHash } from '../src/router.ts';

// The web tests run in node: stand in a location and history that keep the hash the way a browser does.
const loc = { hash: '' };
beforeEach(() => {
  loc.hash = '';
  vi.stubGlobal('window', { location: loc, dispatchEvent: () => true });
  vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, url: string) => (loc.hash = url) });
  vi.stubGlobal('HashChangeEvent', class extends Event {});
});
afterEach(() => vi.unstubAllGlobals());

describe('navigate', () => {
  it('opens a channel\'s settings from the context menu\'s href, with one hash', () => {
    navigate(href.settings('acne-studios'));
    expect(loc.hash).toBe('#/c/acne-studios/settings');
    expect(parseHash(loc.hash)).toEqual({ name: 'channel', id: 'acne-studios', tab: 'settings' });
  });

  it('takes every href without doubling the hash', () => {
    for (const h of [href.home(), href.channel('a b'), href.prs('x'), href.pr('x', 3), href.thread('t1', 2), href.search('q'), href.settingsPage()]) {
      navigate(h);
      expect(loc.hash).toBe(h);
      expect(parseHash(loc.hash).name).not.toBe('notfound');
    }
  });

  it('still takes a bare path, and replaces when asked', () => {
    navigate('/t/abc');
    expect(loc.hash).toBe('#/t/abc');
    navigate('c/acne', { replace: true });
    expect(loc.hash).toBe('#/c/acne');
  });
});
