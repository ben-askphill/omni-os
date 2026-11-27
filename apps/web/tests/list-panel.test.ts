import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ prefs: {} as Record<string, unknown> }));

vi.mock('../src/store.tsx', async (orig) => ({
  ...(await orig<typeof import('../src/store.tsx')>()),
  useApp: () => ({ channels: [], tasks: [], openThread: null, channel: () => undefined }),
  readPref: (key: string, fallback: unknown) => (key in state.prefs ? state.prefs[key] : fallback),
  writePref: (key: string, value: unknown) => {
    state.prefs[key] = value;
  },
}));
vi.mock('../src/router.ts', async (orig) => ({
  ...(await orig<typeof import('../src/router.ts')>()),
  useRoute: () => ({ name: 'settings', section: 'general' }),
}));
vi.mock('../src/folders.tsx', async (orig) => ({
  ...(await orig<typeof import('../src/folders.tsx')>()),
  useFolders: () => ({ editing: null, setEditing: () => {} }),
}));
// The Inbox's foot reads the live feed: nothing it shows matters here.
vi.mock('../src/components/UpdateNotice.tsx', () => ({ UpdateNotice: () => null }));
vi.mock('../src/components/DiskNotice.tsx', () => ({ DiskNotice: () => null }));
vi.mock('../src/components/AccountNotice.tsx', () => ({ AccountNotice: () => null }));
vi.mock('../src/components/sidebar/UsageCard.tsx', () => ({ UsageCard: () => null }));
vi.mock('../src/app/useInbox.ts', () => {
  const shelf = { rows: [], count: 0, more: 0, open: false, toggle: () => {} };
  return {
    useInbox: () => ({
      pinned: [],
      inbox: [],
      needs: [],
      finished: [],
      working: { ...shelf, threads: [] },
      done: { ...shelf, count: 95, showMore: () => {} },
      loaded: true,
      openId: null,
      status: () => null,
    }),
  };
});

import { Window } from 'happy-dom';
import { ListPanel } from '../src/components/rail/ListPanel.tsx';

const render = (collapsed: boolean) => {
  state.prefs['rail.listCollapsed'] = collapsed;
  return renderToStaticMarkup(createElement(ListPanel, { mode: { kind: 'settings' }, onSearch: () => {} }));
};

describe('ListPanel', () => {
  it('is an aside named for its list, with the toggle saying what it does next', () => {
    const open = render(false);
    expect(open).toContain('<aside');
    expect(open).toContain('aria-label="Settings sections"');
    expect(open).not.toContain('data-collapsed');
    const toggle = open.slice(open.indexOf('<button'), open.indexOf('</button>'));
    expect(toggle).toContain('aria-label="Collapse list"');
    expect(toggle).toContain('aria-expanded="true"');
    expect(toggle).toContain('aria-controls="rail-list-body"');
    expect(toggle).toMatch(/aria-keyshortcuts="(Meta|Control)\+Backslash"/);
    expect(toggle).not.toContain('title=');
    expect(open).toContain('id="rail-list-body"');
  });

  it('collapses to the 48px strip, scrolling with no bar, and keeps every name as an accessible name', () => {
    const shut = render(true);
    expect(shut).toContain('data-collapsed="true"');
    expect(shut).toContain('aria-label="Expand list"');
    expect(shut).toContain('aria-expanded="false"');
    expect(shut).toContain('scroll-none');
    expect(shut).not.toContain('scroll-thin');
    // The row's text stays in the DOM, hidden by CSS (.crow-x), so find-in-page and screen readers still reach it.
    const general = shut.slice(shut.indexOf('aria-label="General"'), shut.indexOf('</a>', shut.indexOf('aria-label="General"')));
    expect(general).toContain('crow-x');
    expect(general).toContain('>General<');
    // The settings search box has no room.
    expect(shut).toMatch(/<label class="[^"]* hidden /);
  });

  it('shows each section as a 30px row with its card', () => {
    const open = render(false);
    expect(open).toContain('class="flex items-center text-[13px] crow');
    expect(open).toMatch(/class="tip tip-card"/);
  });

  // The Inbox's column is min-h-full, so Done sits at the foot. Search and New thread beside it made the list 70px
  // taller than its box, so a scrollbar showed with nothing to scroll and Done hid under the fold.
  it("keeps Search and New thread inside the Inbox's full-height column, so a list that fits does not scroll", () => {
    state.prefs['rail.listCollapsed'] = false;
    const html = renderToStaticMarkup(createElement(ListPanel, { mode: { kind: 'inbox' }, onSearch: () => {} }));
    const doc = new new Window().DOMParser().parseFromString(html, 'text/html');
    const scroll = doc.getElementById('rail-list-body')!;
    expect(scroll.children).toHaveLength(1);
    const column = scroll.children[0]!;
    expect(column.className.split(' ')).toContain('min-h-full');
    expect(column.querySelector('[aria-label="Search or jump to"]')).toBeTruthy();
    expect(column.querySelector('[aria-label="New thread"]')).toBeTruthy();
    expect(column.textContent).toContain('Nothing is waiting on you.');
  });
});
