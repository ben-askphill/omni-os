// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AccountsView } from '@omni/shared/harness-accounts.ts';
import { DEFAULT_USAGE_PANEL, type UsagePanelPrefs } from '@omni/shared/usage-panel.ts';
import { checkServer, mount } from '@ui-sdk/core/testing';

// Settings > Usage panel: every account and harness with a switch, reordered by dragging a handle or from the keyboard
// on it, and the Usage card following the saved order and switches.

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

const state = vi.hoisted(() => ({ accounts: null as unknown, saved: [] as unknown[] }));

vi.mock('../src/store.tsx', () => ({
  useApp: () => ({ usage: {}, status: { slots: { 'claude-code': { running: 0, cap: 12 }, hermes: { running: 0, cap: 12 }, antigravity: { running: 1, cap: 12 } } }, feedLive: true }),
  useFeed: () => {},
  useNow: () => Date.now(),
  readPref: (_key: string, fallback: unknown) => (typeof fallback === 'boolean' ? true : fallback),
  writePref: () => {},
}));
vi.mock('../src/accounts.ts', () => ({ useAccounts: () => ({ data: state.accounts }) }));
vi.mock('../src/api.ts', async (load) => ({
  ...(await load<typeof import('../src/api.ts')>()),
  api: {
    get: async () => DEFAULT_USAGE_PANEL,
    put: async (_path: string, body: unknown) => {
      state.saved.push(body);
      return body;
    },
  },
}));

import { UsagePanelSection } from '../src/pages/SettingsUsagePanel.tsx';
import { UsageCard } from '../src/components/sidebar/UsageCard.tsx';
import { takeUsagePanel } from '../src/usage-panel.ts';
import { sortableList } from '../src/components/ui/sortable-list.ts';

const signedIn = (harness: string, label: string, plan: string) => ({ harness, state: 'signed-in', label, org: null, plan, note: null, switched: null, notice: false });
const off = (harness: string, state = 'not-installed') => ({ harness, state, label: null, org: null, plan: null, note: null, switched: null, notice: false });
const accounts = {
  machines: [
    {
      id: 'm1',
      name: 'laptop',
      current: true,
      checkedAt: null,
      accounts: [
        signedIn('claude-code', 'team@example.com', 'Team'),
        signedIn('codex', 'team@example.com', 'Plus'),
        off('cursor'),
        signedIn('antigravity', 'me@example.com', 'Google AI Pro'),
        off('hermes', 'not-reported'),
      ],
    },
    { id: 'm2', name: 'desktop', current: false, checkedAt: null, accounts: [signedIn('claude-code', 'max@example.com', 'Max'), off('codex'), off('cursor'), off('antigravity'), off('hermes', 'off')] },
  ],
  synced: true,
  usage: [],
} as unknown as AccountsView;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  globalThis.__UI_SDK_STRICT__ = true;
  state.accounts = accounts;
  state.saved = [];
  takeUsagePanel(DEFAULT_USAGE_PANEL);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  globalThis.__UI_SDK_STRICT__ = undefined;
});

const render = (el: Parameters<Root['render']>[0]) => act(() => root.render(el));
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="usage-panel-row"]')];
const names = () => rows().map((r) => r.querySelector('[data-slot="sortable-list-handle"]')!.getAttribute('aria-label')!.replace(/^Move /, ''));
const handle = (name: string) => host.querySelector<HTMLElement>(`[aria-label="Move ${name}"]`)!;
const toggle = (name: string) => host.querySelector<HTMLElement>(`[aria-label="Show ${name}"]`)!;
const press = (el: Element, key: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
const lastSaved = () => state.saved.at(-1) as UsagePanelPrefs;

describe('Settings > Usage panel', () => {
  it('lists every account and harness in the built-in order, Hermes off and Antigravity on', () => {
    render(createElement(UsagePanelSection));
    expect(names()).toEqual([
      'Claude Code, team@example.com',
      'Claude Code, max@example.com',
      'Codex, team@example.com',
      'Cursor',
      'Antigravity, me@example.com',
      'Hermes',
    ]);
    expect(toggle('Hermes').getAttribute('aria-checked')).toBe('false');
    expect(toggle('Antigravity, me@example.com').getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('Not set up or signed in on any machine yet');
    expect(host.querySelector('[data-slot="sortable-list"]')!.getAttribute('role')).toBe('list');
  });

  it('moves a row from the keyboard: Space picks it up, the arrows move it, Space drops it', async () => {
    render(createElement(UsagePanelSection));
    const max = handle('Claude Code, max@example.com');
    act(() => max.focus());
    press(max, ' ');
    expect(max.getAttribute('aria-pressed')).toBe('true');
    press(max, 'ArrowUp');
    press(max, ' ');
    await act(async () => {});
    expect(names().slice(0, 2)).toEqual(['Claude Code, max@example.com', 'Claude Code, team@example.com']);
    expect(lastSaved().order).toHaveLength(6);
    expect(document.activeElement).toBe(handle('Claude Code, max@example.com'));
  });

  it('puts a picked-up row back on Escape without saving', () => {
    render(createElement(UsagePanelSection));
    const codex = handle('Codex, team@example.com');
    press(codex, 'Enter');
    press(codex, 'Home');
    press(codex, 'Escape');
    expect(names()[2]).toBe('Codex, team@example.com');
    expect(state.saved).toEqual([]);
  });

  it('saves a switch with the order as listed', async () => {
    render(createElement(UsagePanelSection));
    act(() => toggle('Hermes').click());
    await act(async () => {});
    expect(lastSaved().visible).toEqual({ hermes: true });
    expect(toggle('Hermes').getAttribute('aria-checked')).toBe('true');
  });
});

describe('the Usage card follows Settings', () => {
  const card = () => [...host.querySelectorAll<HTMLElement>('.caption')].map((el) => el.lastChild?.textContent);

  it('shows Antigravity with no data and leaves Hermes out by default', () => {
    render(createElement(UsageCard));
    expect(card()).toEqual(['Claude', 'Claude', 'Codex', 'Antigravity']);
    expect(host.textContent).toContain('no data');
    expect(host.textContent).toContain('Claude 0/12 · Antigravity 1/12');
    expect(host.textContent).not.toContain('Hermes');
  });

  it('shows the rows in the saved order, without the ones switched off', () => {
    render(createElement(UsagePanelSection));
    const agy = handle('Antigravity, me@example.com');
    press(agy, ' ');
    press(agy, 'Home');
    press(agy, ' ');
    act(() => toggle('Codex, team@example.com').click());
    act(() => toggle('Hermes').click());
    render(createElement(UsageCard));
    expect(card()).toEqual(['Antigravity', 'Claude', 'Claude', 'Hermes']);
    expect(host.textContent).toContain('Antigravity 1/12 · Claude 0/12 · Hermes 0/12');
  });
});

describe('sortableList', () => {
  const markup = `<root><item value="a"><handle>A</handle></item><item value="b"><handle>B</handle></item><item value="c"><handle>C</handle></item></root>`;

  it('moves an item from its handle with Space, the arrows and Space, and says each step', async () => {
    const view = mount(sortableList, { defaultValue: ['a', 'b', 'c'] }, markup);
    try {
      await view.keys('Tab', 'Space', 'ArrowDown', 'ArrowDown', 'Space');
      expect(view.state.value).toEqual(['b', 'c', 'a']);
      expect(view.changes.at(-1)).toMatchObject({ key: 'value', source: 'keyboard' });
      expect(view.announced.join(' ')).toMatch(/A/);
    } finally {
      view.unmount();
    }
  });

  it('puts the item back on Escape', async () => {
    const view = mount(sortableList, { defaultValue: ['a', 'b', 'c'] }, markup);
    try {
      await view.keys('Tab', 'Space', 'End', 'Escape');
      expect(view.state.value).toEqual(['a', 'b', 'c']);
    } finally {
      view.unmount();
    }
  });

  it('renders on the server', () => {
    checkServer(sortableList, { defaultValue: ['a', 'b', 'c'] }, markup);
  });
});
