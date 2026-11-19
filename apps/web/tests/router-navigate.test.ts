import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropNewThreadPreset, href, navigate, openNewThread, parseHash, peekNewThreadPreset, setInboxUp, startNewThread, type Route } from '../src/router.ts';
import { cameFromInbox, listMode, railSelection } from '../src/rail-model.ts';

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
afterEach(() => {
  setInboxUp(false);
  for (const p of [peekNewThreadPreset(), peekNewThreadPreset('acme'), peekNewThreadPreset('conductor')]) if (p) dropNewThreadPreset(p);
  vi.unstubAllGlobals();
});

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
      href.threadAt('t1', 9),
      href.threadView('t1', 'steps', 41),
      href.search('q'),
      href.settingsPage(),
      href.settingsSection('workspace'),
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
    expect(parseHash('#/settings/workspace')).toEqual({ name: 'settings', section: 'workspace' });
    expect(parseHash('#/settings/machines')).toEqual({ name: 'settings', section: 'machines' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
    expect(parseHash('#/settings/nope')).toEqual({ name: 'notfound', path: '/settings/nope' });
  });

  it('keeps the pages Settings replaced reachable at their old hashes', () => {
    expect(parseHash('#/secrets')).toEqual({ name: 'settings', section: 'secrets' });
    expect(parseHash('#/sync')).toEqual({ name: 'settings', section: 'sync' });
    expect(parseHash('#/storage')).toEqual({ name: 'settings', section: 'worktrees' });
    // The old tab names from before the grouped layout open the section that holds them now.
    expect(parseHash('#/settings/storage')).toEqual({ name: 'settings', section: 'worktrees' });
    expect(parseHash('#/settings/profile')).toEqual({ name: 'settings', section: 'general' });
    // A search result carries the setting to scroll to.
    expect(parseHash('#/settings/threads?focus=limits')).toEqual({ name: 'settings', section: 'threads', focus: 'limits' });
    expect(href.settingsSection('threads', 'limits')).toBe('#/settings/threads?focus=limits');
    expect(parseHash('#/toString')).toEqual({ name: 'notfound', path: '/toString' });
    expect(href.settingsSection('machines')).toBe('#/settings/machines');
    expect(href.settingsSection('general')).toBe('#/settings/general');
  });

  it('reads a thread\'s own views, its steps for one turn, and its artifact', () => {
    expect(parseHash(href.threadView('t1', 'steps', 41))).toEqual({ name: 'thread', id: 't1', view: 'steps', turn: 41 });
    expect(parseHash(href.threadView('t1', 'pr'))).toEqual({ name: 'thread', id: 't1', view: 'pr' });
    expect(parseHash(href.thread('t1', 7))).toEqual({ name: 'thread', id: 't1', artifact: 7 });
  });

  it('treats an unknown thread view as the thread', () => {
    expect(parseHash('#/t/t1/nope?turn=x')).toEqual({ name: 'thread', id: 't1' });
  });

  it('opens Models\' Connect an agent sheet from a pairing link, as the desktop app or a browser opens it', () => {
    const query = 'url=http%3A%2F%2Fh.tail1.ts.net%3A8642&code=GB8Z-DP5J-0TGX-R608';
    const link = `omni://connect-agent?${query}`;
    expect(parseHash(`#/connect-agent?${query}`)).toEqual({ name: 'settings', section: 'models', connect: link });
    expect(parseHash(`#/settings/models?connect=${encodeURIComponent(link)}`)).toEqual({ name: 'settings', section: 'models', connect: link, focus: undefined });
    // Only Models takes one.
    expect(parseHash(`#/settings/crew?connect=${encodeURIComponent(link)}`)).toEqual({ name: 'settings', section: 'crew', focus: undefined });
  });

  it('reads the event a search hit opens the thread at, and ignores one that is not an id', () => {
    expect(href.threadAt('t 1', 3021)).toBe('#/t/t%201?at=3021');
    expect(parseHash(href.threadAt('t 1', 3021))).toEqual({ name: 'thread', id: 't 1', at: 3021 });
    expect(parseHash('#/t/t1?at=2.5')).toEqual({ name: 'thread', id: 't1' });
    expect(parseHash('#/t/t1?at=-3')).toEqual({ name: 'thread', id: 't1' });
  });
});

describe('startNewThread', () => {
  const from = (h: string, open: { id: string; channel_id: string } | null = null) => {
    loc.hash = h;
    startNewThread(parseHash(h), open);
    return loc.hash;
  };

  it('opens the open thread\'s channel from a thread', () => {
    expect(from('#/t/t1', { id: 't1', channel_id: 'acme' })).toBe('#/c/acme');
    expect(from('#/t/t1/changes', { id: 't1', channel_id: 'a b' })).toBe('#/c/a%20b');
  });

  it('opens Home from a thread whose channel is not known yet', () => {
    expect(from('#/t/t1')).toBe('#/');
    expect(from('#/t/t1', { id: 't0', channel_id: 'acme' })).toBe('#/');
  });

  it('keeps a channel\'s threads, and leaves its other tabs for them', () => {
    expect(from('#/c/acme')).toBe('#/c/acme');
    expect(from('#/c/acme/prs/3')).toBe('#/c/acme');
    expect(from('#/c/acme/settings')).toBe('#/c/acme');
  });

  it('opens Home from a page outside any channel', () => {
    expect(from('#/secrets')).toBe('#/');
    expect(from('#/')).toBe('#/');
  });
});

describe('a new thread with the Inbox up', () => {
  const conductor = { id: 'c1', channel_id: 'conductor' };

  it('opens Home\'s composer, set to the open thread\'s channel, instead of the channel page', () => {
    setInboxUp(true);
    loc.hash = '#/t/c1';
    startNewThread(parseHash(loc.hash), conductor);
    expect(loc.hash).toBe('#/');
    // Home's composer (no channel of its own) takes the preset; the Conductor channel page never sees it.
    expect(peekNewThreadPreset()).toEqual({ channel: 'conductor' });
    expect(peekNewThreadPreset('conductor')).toBeNull();
  });

  it('sends /new, Open items and Next thread to Home\'s composer too', () => {
    setInboxUp(true);
    loc.hash = '#/t/t1';
    openNewThread({ channel: 'acme', prompt: 'Fix the docs' });
    expect(loc.hash).toBe('#/');
    expect(peekNewThreadPreset()).toEqual({ channel: 'acme', prompt: 'Fix the docs' });
    expect(peekNewThreadPreset('acme')).toBeNull();
  });

  it('still opens the channel\'s page when the Inbox is not up', () => {
    loc.hash = '#/t/c1';
    startNewThread(parseHash(loc.hash), conductor);
    expect(loc.hash).toBe('#/c/conductor');
    openNewThread({ channel: 'acme' });
    expect(loc.hash).toBe('#/c/acme');
    expect(peekNewThreadPreset('acme')).toEqual({ channel: 'acme' });
    expect(peekNewThreadPreset()).toBeNull();
  });

  it('keeps the rail on the Inbox from the Conductor thread to the thread it starts', () => {
    // Ben opens the Conductor thread from the Inbox, presses New thread, and starts a thread from the composer.
    let fromInbox = cameFromInbox({ name: 'inbox' }, false);
    const step = (route: Route, open: { id: string; channel_id: string } | null) => {
      fromInbox = cameFromInbox(route, fromInbox);
      setInboxUp(listMode(railSelection(route, open, fromInbox)).kind === 'inbox');
      return railSelection(route, open, fromInbox);
    };
    expect(step({ name: 'thread', id: 'c1' }, conductor)).toEqual({ kind: 'inbox', marked: 'conductor' });

    startNewThread(parseHash('#/t/c1'), conductor);
    expect(step(parseHash(loc.hash), conductor)).toEqual({ kind: 'inbox' });

    // The composer navigates to the thread it started (Composer.tsx), which opens beside the Inbox.
    navigate('/t/t2');
    expect(step(parseHash(loc.hash), { id: 't2', channel_id: 'conductor' })).toEqual({ kind: 'inbox', marked: 'conductor' });
  });
});
