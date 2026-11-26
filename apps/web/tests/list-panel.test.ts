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
});
