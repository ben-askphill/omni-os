import { describe, expect, it } from 'vitest';
import { placeEntry, rootTabOf, screenOf, stackOf } from '../src/mobile/screens.ts';
import { href, parseHash } from '../src/router.ts';

const route = (h: string) => parseHash(h);
const keys = (h: string) => stackOf(route(h), h).map((l) => l.key);

describe('the phone layout\'s screens', () => {
  it('gives each route its screen', () => {
    expect(screenOf(route('#/'))).toBe('activity');
    expect(screenOf(route(href.channels()))).toBe('channels');
    expect(screenOf(route(href.artifacts()))).toBe('library');
    expect(screenOf(route(href.channel('volero')))).toBe('channel');
    expect(screenOf(route(href.pr('volero', 812)))).toBe('channel-pr');
    expect(screenOf(route(href.prs('volero')))).toBe('page');
    expect(screenOf(route(href.settings('volero')))).toBe('page');
    expect(screenOf(route(href.thread('t1')))).toBe('thread');
    expect(screenOf(route(href.thread('t1', 4)))).toBe('viewer');
    expect(screenOf(route(href.threadView('t1', 'steps', 9)))).toBe('steps');
    expect(screenOf(route(href.threadView('t1', 'terminal')))).toBe('terminal');
    expect(screenOf(route(href.settingsPage()))).toBe('settings');
    expect(screenOf(route(href.workspaceSettings()))).toBe('page');
    expect(screenOf(route(href.automations()))).toBe('page');
    expect(screenOf(route('#/nowhere'))).toBe('notfound');
  });

  it('shows nothing over a tab root', () => {
    expect(keys('#/')).toEqual([]);
    expect(keys('#/channels')).toEqual([]);
    expect(keys('#/artifacts')).toEqual([]);
  });

  it('stacks a screen over its parents, the same however it was reached', () => {
    expect(keys('#/t/t1')).toEqual(['/t/t1']);
    expect(keys('#/t/t1/steps?turn=9')).toEqual(['/t/t1', '/t/t1/steps?turn=9']);
    expect(keys('#/t/t1?artifact=4')).toEqual(['/t/t1', '/t/t1?artifact=4']);
    expect(keys('#/c/volero/prs/812')).toEqual(['/c/volero', '/c/volero/prs/812']);
    expect(keys('#/automations')).toEqual(['/settings', '/automations']);
  });

  it('puts a cold link on the tab its parents lead to', () => {
    expect(rootTabOf(route('#/c/volero'))).toBe('channels');
    expect(rootTabOf(route('#/automations'))).toBe('channels');
    expect(rootTabOf(route('#/t/t1/steps'))).toBe('activity');
  });
});

describe('placeEntry', () => {
  it('numbers the first entry 0 and each new one past the last', () => {
    expect(placeEntry(null, null)).toEqual({ index: 0, dir: 'none', fresh: true });
    expect(placeEntry(0, null)).toEqual({ index: 1, dir: 'forward', fresh: true });
    expect(placeEntry(4, { other: true })).toEqual({ index: 5, dir: 'forward', fresh: true });
  });

  it('reads a numbered entry back: a reload stays put, Back and Forward say which way', () => {
    expect(placeEntry(null, { omni: 3 })).toEqual({ index: 3, dir: 'none', fresh: false });
    expect(placeEntry(3, { omni: 2 })).toEqual({ index: 2, dir: 'back', fresh: false });
    expect(placeEntry(2, { omni: 3 })).toEqual({ index: 3, dir: 'forward', fresh: false });
    expect(placeEntry(3, { omni: 3 })).toEqual({ index: 3, dir: 'none', fresh: false });
  });
});
