import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { href, navigate, parseHash } from '../src/router.ts';

// The web tests run in node: stand in a location and history that keep the hash the way a browser does.
const loc = { hash: '' };
const hist = { state: null as unknown, replaceState: (s: unknown, _t: string, url: string) => ((hist.state = s), (loc.hash = url)) };
beforeEach(() => {
  loc.hash = '';
  hist.state = null;
  vi.stubGlobal('window', { location: loc, dispatchEvent: () => true });
  vi.stubGlobal('history', hist);
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
    for (const h of [
      href.home(),
      href.channels(),
      href.channel('a b'),
      href.prs('x'),
      href.pr('x', 3),
      href.thread('t1', 2),
      href.threadView('t1', 'steps', 41),
      href.search('q'),
      href.settingsPage(),
      href.workspaceSettings(),
    ]) {
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

  it('keeps the entry\'s state on a replace, so the phone layout still knows where it is in history', () => {
    hist.state = { omni: 3 };
    navigate(href.channels(), { replace: true });
    expect(hist.state).toEqual({ omni: 3 });
  });
});

describe('parseHash', () => {
  it('reads the phone layout\'s routes', () => {
    expect(parseHash('#/channels')).toEqual({ name: 'channels' });
    expect(parseHash('#/settings/workspace')).toEqual({ name: 'settings', page: 'workspace' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
  });

  it('reads a thread\'s own views, its steps for one turn, and its artifact', () => {
    expect(parseHash(href.threadView('t1', 'steps', 41))).toEqual({ name: 'thread', id: 't1', view: 'steps', turn: 41 });
    expect(parseHash(href.threadView('t1', 'pr'))).toEqual({ name: 'thread', id: 't1', view: 'pr' });
    expect(parseHash(href.thread('t1', 7))).toEqual({ name: 'thread', id: 't1', artifact: 7 });
  });

  it('treats an unknown thread view as the thread', () => {
    expect(parseHash('#/t/t1/nope?turn=x')).toEqual({ name: 'thread', id: 't1' });
  });
});
