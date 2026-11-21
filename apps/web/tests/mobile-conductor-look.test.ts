import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChannelWithRunning, Thread } from '../src/api.ts';
import type { InboxThread } from '../src/inbox.ts';
import type { RowItem } from '../src/mobile/rows.ts';

// The Conductor's saved icon and background on the phone layout: its header on Activity, its row on Channels, its pill
// in the New sheet and its threads' rows. A saved look wins, as on the desktop Inbox and the iPhone app
// (packages/shared/channel-icon.ts hasOwnLook). Without one each keeps the Omni mark, or the Conductor's crew character
// (ADR 0021) on a thread row.
const state = vi.hoisted(() => ({ channels: [] as ChannelWithRunning[], waiting: [] as unknown[], threads: [] as unknown[] }));

vi.mock('../src/store.tsx', () => ({
  useNeedOf: () => undefined,
  useApp: () => ({
    channels: state.channels,
    channel: (id: string) => state.channels.find((c) => c.id === id),
    channelsLoaded: true,
    crew: [],
    tasks: [],
    needsYou: null,
    profile: null,
    status: null,
    setPinned: vi.fn(),
    setDone: vi.fn(),
  }),
  useCrewRoles: () => [],
  useNow: () => Date.parse('2026-01-05T12:00:00.000Z'),
  useHereName: () => undefined,
  useUserName: () => undefined,
  useFeed: () => {},
  readPref: (_key: string, fallback: unknown) => fallback,
  writePref: () => {},
  dropPref: () => {},
}));
// The shared clock has no server snapshot.
vi.mock('../src/clock.ts', () => ({ useTick: () => Date.parse('2026-01-05T12:00:00.000Z') }));
vi.mock('../src/mobile/shell.tsx', () => ({ useShell: () => ({ open: vi.fn(), back: vi.fn(), sheet: vi.fn(), toast: vi.fn() }), useTabShown: () => true }));
vi.mock('../src/app/useInbox.ts', () => ({
  useInbox: () => {
    const shelf = { count: 0, rows: [], open: false, toggle: () => {}, more: 0 };
    return { pinned: [], inbox: state.waiting, needs: [], finished: [], working: { ...shelf, threads: [] }, done: { ...shelf, showMore: () => {} }, loaded: true, status: () => null };
  },
}));
vi.mock('../src/app/useChannelThreads.ts', () => ({
  useChannelThreads: () => ({ data: state.threads, loading: false, more: false, loadingMore: false, loadMore: () => {} }),
}));
vi.mock('../src/folders.tsx', () => ({ useFolders: () => ({ toggle: () => {} }) }));
vi.mock('../src/app/useMachines.ts', () => ({ useMachines: () => ({ data: null }) }));
vi.mock('../src/components/UpdateNotice.tsx', () => ({ UpdateNotice: () => null }));
vi.mock('../src/components/DiskNotice.tsx', () => ({ DiskNotice: () => null }));
vi.mock('../src/components/AccountNotice.tsx', () => ({ AccountNotice: () => null, ComposerAccountNotice: () => null }));

import { ActivityScreen } from '../src/mobile/ActivityScreen.tsx';
import { ChannelScreen, ChannelsScreen } from '../src/mobile/ChannelsScreen.tsx';
import { MoInboxRow } from '../src/mobile/InboxRows.tsx';
import { NewSheet } from '../src/mobile/NewSheet.tsx';
import { MoAvatar, MoRow } from '../src/mobile/parts.tsx';

const html = (node: ReactNode) => renderToStaticMarkup(createElement('div', null, node));
const OMNI_MARK = 'class="mark ';
const RING = 'data-shape="circle"';
const SAVED = { icon: '🎼', avatar_bg: '#283c62' };
const BG = 'background-color:#283c62';

const channel = (id: string, name: string, over: Partial<ChannelWithRunning> = {}) =>
  ({ id, name, kind: id === 'conductor' ? 'system' : 'client', icon: null, avatar_bg: null, running: 0, ...over }) as ChannelWithRunning;
const base = (JSON.parse(readFileSync(resolve(WIRE_FIXTURES, 'recent.json'), 'utf8')) as Thread[])[0];
const thread = (over: Partial<Thread>) => ({ ...base, id: 'job', title: 'Ship the fix', parent_thread_id: null, run_started_at: null, ...over }) as Thread & InboxThread;
const row = (over: Partial<RowItem>): RowItem => ({
  id: 'job', title: 'Ship the fix', channel: 'Conductor', channelId: 'conductor', channelIcon: null, avatarBg: null, role: 'conductor', status: 'idle', settled: false, time: '2m', meta: null, ...over,
});
/** The markup from the first `marker` to the first `end` after it: one row, one button. */
const slice = (markup: string, marker: string, end: string) => {
  const at = markup.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  return markup.slice(at, markup.indexOf(end, at));
};

/** One thread's row in a list: from the start of its button to its title. */
const rowOf = (markup: string, title: string) => {
  const at = markup.indexOf(title);
  expect(at).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<button', at), at);
};

beforeEach(() => {
  state.channels = [channel('conductor', 'Conductor'), channel('acme', 'Acme')];
  state.waiting = [];
  state.threads = [];
});

describe("a Conductor thread's row on the phone", () => {
  it("draws the Conductor's crew character while the Conductor has no look of its own", () => {
    const activity = html(createElement(MoInboxRow, { t: thread({ channel_id: 'conductor', role: 'conductor' }), status: null, last: true }));
    expect(activity).toContain(RING);
    expect(activity).not.toContain('background-color');
    const channelRow = html(createElement(MoRow, { it: row({}), onOpen: () => {} }));
    expect(channelRow).toContain(RING);
    expect(channelRow).not.toContain('background-color');
  });

  it('draws the saved icon and background instead', () => {
    state.channels = [channel('conductor', 'Conductor', SAVED)];
    const activity = html(createElement(MoInboxRow, { t: thread({ channel_id: 'conductor', role: 'conductor' }), status: null, last: true }));
    expect(activity).not.toContain(RING);
    expect(activity).toContain(BG);
    expect(activity).toContain('🎼');
    const channelRow = html(createElement(MoRow, { it: row({ channelIcon: SAVED.icon, avatarBg: SAVED.avatar_bg }), onOpen: () => {} }));
    expect(channelRow).not.toContain(RING);
    expect(channelRow).toContain(BG);
    expect(channelRow).toContain('🎼');
  });

  it('takes either half of the look: a saved icon alone, or a background alone on the Omni mark', () => {
    const icon = html(createElement(MoAvatar, { role: 'conductor', channel: 'conductor', channelIcon: 'icon:target' }));
    expect(icon).not.toContain(RING);
    expect(icon).not.toContain(OMNI_MARK);
    const bg = html(createElement(MoAvatar, { role: 'conductor', channel: 'conductor', avatarBg: '#283c62' }));
    expect(bg).not.toContain(RING);
    expect(bg).toContain(OMNI_MARK);
    expect(bg).toContain(BG);
  });

  it("draws the saved look in the Conductor's channel too, background and all", () => {
    state.threads = [thread({ channel_id: 'conductor', role: 'conductor', status: 'running' })];
    const plain = rowOf(html(createElement(ChannelScreen, { id: 'conductor' })), 'Ship the fix');
    expect(plain).toContain(RING);
    state.channels = [channel('conductor', 'Conductor', SAVED)];
    const saved = rowOf(html(createElement(ChannelScreen, { id: 'conductor' })), 'Ship the fix');
    expect(saved).not.toContain(RING);
    expect(saved).toContain(BG);
    expect(saved).toContain('🎼');
  });

  it("draws other agents' characters, built-in or not, whatever their channel's look", () => {
    const builder = html(createElement(MoAvatar, { role: 'builder', channel: 'acme', channelIcon: SAVED.icon, avatarBg: SAVED.avatar_bg }));
    expect(builder).toMatch(/data-shape="squircle"[^>]*data-eyes="idle"/);
    expect(builder).not.toContain(BG);
    expect(builder).not.toContain('🎼');
    const own = html(createElement(MoAvatar, { role: 'notes', channel: 'acme', channelIcon: SAVED.icon, avatarBg: SAVED.avatar_bg }));
    expect(own).toMatch(/<svg[^>]*data-shape="[a-z-]+"[^>]*data-eyes="idle"/);
    expect(own).not.toContain('🎼');
    const roleless = html(createElement(MoAvatar, { role: null, channel: 'acme', channelIcon: SAVED.icon, avatarBg: SAVED.avatar_bg }));
    expect(roleless).toContain(BG);
    expect(roleless).toContain('🎼');
  });
});

describe("the Conductor's header on Activity", () => {
  const header = () => slice(html(createElement(ActivityScreen)), 'aria-label="Open the Conductor"', '</button>');

  it('shows the live Omni mark by default', () => {
    expect(header()).toContain(OMNI_MARK);
    expect(header()).not.toContain('background-color');
  });

  it('shows the saved icon and background', () => {
    state.channels = [channel('conductor', 'Conductor', SAVED)];
    expect(header()).not.toContain(OMNI_MARK);
    expect(header()).toContain(BG);
    expect(header()).toContain('🎼');
  });
});

describe("the Conductor's row on Channels", () => {
  const conductorRow = () => {
    const markup = html(createElement(ChannelsScreen));
    return markup.slice(0, markup.indexOf('Delegates to crew threads'));
  };

  it('shows the live Omni mark by default', () => {
    const markup = conductorRow();
    expect(markup).toContain(OMNI_MARK);
    expect(markup).not.toContain('background-color');
  });

  it('shows the saved icon and background', () => {
    state.channels = [channel('conductor', 'Conductor', SAVED), channel('acme', 'Acme')];
    const markup = conductorRow();
    expect(markup).not.toContain(OMNI_MARK);
    expect(markup).toContain(BG);
    expect(markup).toContain('🎼');
  });
});

describe("the Conductor's pill in the New sheet", () => {
  // The sheet opens on the Conductor, so its pill is the pressed one.
  const pill = () => slice(html(createElement(NewSheet, {})), 'aria-pressed="true"', '</button>');

  it('shows the Omni mark by default', () => {
    expect(pill()).toContain(OMNI_MARK);
    expect(pill()).not.toContain('background-color');
  });

  it('shows the saved icon and background', () => {
    state.channels = [channel('conductor', 'Conductor', SAVED), channel('acme', 'Acme')];
    expect(pill()).not.toContain(OMNI_MARK);
    expect(pill()).toContain(BG);
    expect(pill()).toContain('🎼');
  });
});
