import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NeedsYou, Thread } from '../src/api.ts';

const state = vi.hoisted(() => ({
  tab: 'active' as 'active' | 'recent',
  threads: [] as Thread[],
  needsYou: null as NeedsYou | null,
  collapsed: false,
}));

// Render each tab on the server, keeping the real component, folder rows and badges.
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useState: (initial: unknown) => react.useState(initial === 'active' ? state.tab : initial) };
});
vi.mock('../src/store.tsx', () => ({
  useApp: () => ({
    channel: () => ({ id: 'acme', name: 'Acme', kind: 'client', folders: [
      { id: 'folder', name: 'Mixed folder', collapsed: state.collapsed, count: state.threads.length, running: 1 },
    ] }),
    channelsLoaded: true,
    needsYou: state.needsYou,
  }),
  useNow: () => Date.parse('2026-10-23T12:00:00Z'),
}));
vi.mock('../src/components/ThreadList.tsx', () => ({ useLiveThreads: () => ({ data: state.threads, loading: false }) }));
vi.mock('../src/folders.tsx', () => ({ useFolders: () => ({ toggle: vi.fn() }) }));
vi.mock('../src/mobile/shell.tsx', () => ({ useShell: () => ({ open: vi.fn(), back: vi.fn(), sheet: vi.fn() }) }));

import { ChannelScreen } from '../src/mobile/ChannelsScreen.tsx';

const base = (JSON.parse(readFileSync(resolve(WIRE_FIXTURES, 'recent.json'), 'utf8')) as Thread[])[0];
const thread = (id: string, status: Thread['status'], folder_id: string | null = 'folder'): Thread => ({
  ...base, id, title: `Thread ${id}`, channel_id: 'acme', status, folder_id,
});
const render = (tab: 'active' | 'recent') => {
  state.tab = tab;
  return renderToStaticMarkup(createElement(ChannelScreen, { id: 'acme' }));
};
const badge = (html: string, label: string) => {
  const match = html.match(new RegExp(`>${label}<span[^>]*>(\\d+)</span>`));
  expect(match).not.toBeNull();
  return Number(match![1]);
};

beforeEach(() => {
  state.threads = [];
  state.needsYou = null;
  state.collapsed = false;
});

describe('phone channel folders', () => {
  it('splits a mixed folder into the same Active and Recent rows as ungrouped threads', () => {
    state.threads = [thread('running', 'running'), thread('queued', 'queued'), thread('finished', 'done'), thread('failed', 'failed'), thread('stopped', 'stopped')];
    const active = render('active');
    const recent = render('recent');
    for (const id of ['running', 'queued']) {
      expect(active).toContain(`Thread ${id}`);
      expect(recent).not.toContain(`Thread ${id}`);
    }
    for (const id of ['finished', 'failed', 'stopped']) {
      expect(recent).toContain(`Thread ${id}`);
      expect(active).not.toContain(`Thread ${id}`);
    }
  });

  it('keeps both tab counts independent of the selected tab and folder collapse', () => {
    state.threads = [thread('running', 'running'), thread('finished', 'done'), thread('also-finished', 'done'), thread('ungrouped', 'queued', null)];
    for (const collapsed of [false, true]) {
      state.collapsed = collapsed;
      for (const tab of ['active', 'recent'] as const) {
        const html = render(tab);
        expect(badge(html, 'Active')).toBe(2);
        expect(badge(html, 'Recent')).toBe(2);
      }
    }
  });

  it('keeps finished threads that need Ben under Active, inside and outside folders', () => {
    const inbox = JSON.parse(readFileSync(resolve(WIRE_FIXTURES, 'needs-you.json'), 'utf8')) as NeedsYou;
    const result = inbox.items.find((item) => item.thread.status === 'done' && item.result)!;
    expect(result).toBeDefined();
    const filed = thread('unread-filed', 'done');
    const ungrouped = thread('unread-ungrouped', 'done', null);
    state.threads = [filed, ungrouped];
    state.needsYou = { items: [filed, ungrouped].map((t) => ({ ...result, thread: t })), unread: 2, blocked: 0 };
    const active = render('active');
    const recent = render('recent');
    for (const t of state.threads) {
      expect(active).toContain(t.title);
      expect(recent).not.toContain(t.title);
    }
    expect(badge(active, 'Active')).toBe(2);
    expect(badge(recent, 'Active')).toBe(2);
  });

  it('hides folders with no matching rows and excludes team threads', () => {
    state.threads = [thread('finished', 'done'), { ...thread('team', 'running'), source: 'team' }];
    const active = render('active');
    expect(active).not.toContain('Mixed folder');
    expect(active).not.toContain('Thread team');
    expect(badge(active, 'Active')).toBe(0);
    expect(render('recent')).toContain('Thread finished');
  });
});
