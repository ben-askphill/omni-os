// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The dismiss stack (audit M2, M5, L7): Escape and a press outside reach the top layer only; the context menu hands
// the focus back to its "…" button and keeps text fields out of role="menu"; the PR Filters menu has the menu keys.
// tests/layers-browser.test.ts runs the stacked overlays in a real Chromium.

vi.mock('../src/store.tsx', async (importActual) => ({
  ...(await importActual<typeof import('../src/store.tsx')>()),
  useApp: () => ({ channels: [], channel: () => ({ id: 'c1', name: 'omni-os', folders: [] }), status: null }),
}));
vi.mock('../src/folders.tsx', async (importActual) => ({
  ...(await importActual<typeof import('../src/folders.tsx')>()),
  useFolders: () => ({ find: () => undefined, inChannel: () => [], setEditing: () => {}, moveThread: async () => {} }),
}));
vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  const thread = { id: 't1', channel_id: 'c1', title: 'Fix the rail', status: 'idle', created_at: 1, folder_id: null, archived: 0 };
  return { ...actual, api: { ...actual.api, get: async () => ({ thread }) } };
});

import { layerCount, layerOpen, pushLayer } from '../src/components/ui/dismiss-stack.ts';
import { closeMenu, ContextMenuHost, openMenu, useMenuOpenFor } from '../src/components/ContextMenu.tsx';
import { PRToolbar } from '../src/pages/PRToolbar.tsx';
import { DEFAULT_PR_QUERY, type ListedPR, type PRQuery } from '@omni/shared/pr-query.ts';
import { isInboxKey } from '../src/inbox-key.ts';

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const escape = (target: Element = document.activeElement ?? document.body) => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => void target.dispatchEvent(e));
  return e;
};
const key = (target: Element, k: string) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));
const pressOn = (el: Element, pointerType: 'mouse' | 'touch' = 'mouse') =>
  act(() => {
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerType, bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
const $ = <E extends Element = HTMLElement>(sel: string) => document.querySelector<E>(sel);

describe('the dismiss stack', () => {
  const box = (id: string, parent: HTMLElement = document.body) => {
    const el = document.createElement('div');
    el.id = id;
    parent.append(el);
    return el;
  };

  it('gives Escape and a press outside to the top layer only', () => {
    const calls: string[] = [];
    const lower = box('lower');
    const upper = box('upper');
    const offLower = pushLayer({ roots: () => [lower], escape: () => void calls.push('lower esc'), outside: () => void calls.push('lower out') });
    const offUpper = pushLayer({ roots: () => [upper], escape: () => void calls.push('upper esc'), outside: () => void calls.push('upper out') });
    const e = escape(document.body);
    expect(e.defaultPrevented).toBe(true);
    expect(calls).toEqual(['upper esc']);
    // A press in the lower layer is outside the upper one.
    pressOn(lower);
    expect(calls).toEqual(['upper esc', 'upper out']);
    offUpper();
    escape(document.body);
    expect(calls).toEqual(['upper esc', 'upper out', 'lower esc']);
    offLower();
    expect(layerCount()).toBe(0);
    lower.remove();
    upper.remove();
  });

  it('leaves an Escape a control already took, and one the top layer declines', () => {
    const calls: string[] = [];
    const layer = box('layer');
    const field = document.createElement('input');
    layer.append(field);
    field.addEventListener('keydown', (e) => e.key === 'Escape' && e.preventDefault());
    const off = pushLayer({ roots: () => [layer], escape: (e) => ((e.target as HTMLElement).id === 'skip' ? false : void calls.push('esc')) });
    escape(field);
    expect(calls).toEqual([]);
    const skip = document.createElement('button');
    skip.id = 'skip';
    layer.append(skip);
    expect(escape(skip).defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
    off();
    layer.remove();
  });

  it('closes on a tap, not on a finger that scrolls (no mousedown follows)', () => {
    const calls: string[] = [];
    const layer = box('layer');
    const off = pushLayer({ roots: () => [layer], outside: () => void calls.push('out') });
    act(() => void document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })));
    expect(calls).toEqual([]);
    pressOn(document.body, 'touch');
    expect(calls).toEqual(['out']);
    off();
    layer.remove();
  });

  it('puts a layer that opens inside another, in the same commit, above it', () => {
    const calls: string[] = [];
    const outer = box('outer');
    const inner = box('inner', outer);
    // Effects run child first: the inner layer is pushed before the outer one.
    const offInner = pushLayer({ roots: () => [inner], escape: () => void calls.push('inner') });
    const offOuter = pushLayer({ roots: () => [outer], escape: () => void calls.push('outer') });
    escape(document.body);
    expect(calls).toEqual(['inner']);
    offInner();
    offOuter();
    outer.remove();
  });

  it('counts as an open layer for the page keys, so I and Esc to interrupt stand down', () => {
    const i = () => new KeyboardEvent('keydown', { key: 'i' });
    expect(layerOpen()).toBe(false);
    expect(isInboxKey(i())).toBe(true);
    const off = pushLayer({ roots: () => [] });
    expect(layerOpen()).toBe(true);
    expect(isInboxKey(i())).toBe(false);
    off();
  });
});

function MenuButton({ kind = 'channel' as 'channel' | 'thread', id = 'c1' }) {
  const open = useMenuOpenFor(kind, id);
  return createElement(
    'button',
    {
      id: 'more',
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      onClick: (e: { currentTarget: HTMLButtonElement }) => (open ? closeMenu() : openMenu({ kind, id }, 10, 10, 'start', e.currentTarget)),
    },
    '…',
  );
}

describe('the context menu', () => {
  const render = (kind?: 'channel' | 'thread', id?: string) => act(() => root.render(createElement('div', null, createElement(MenuButton, { kind, id }), createElement(ContextMenuHost))));
  const more = () => $<HTMLButtonElement>('#more')!;
  const click = (el: HTMLElement) => act(() => el.click());

  it('sets aria-expanded on its "…" button and toggles on a second press', () => {
    render();
    expect(more().getAttribute('aria-expanded')).toBe('false');
    more().focus();
    click(more());
    expect($('[role="menu"]')).not.toBeNull();
    expect(more().getAttribute('aria-expanded')).toBe('true');
    pressOn(more());
    click(more());
    expect($('[role="menu"]')).toBeNull();
    expect(more().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape and hands the focus back to the "…" button', () => {
    render();
    more().focus();
    click(more());
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    escape();
    expect($('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it('walks its items with the arrows, Home and End', () => {
    render();
    click(more());
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((b) => b.textContent)).toEqual(['New folder', 'Channel settings']);
    key(document.activeElement!, 'End');
    expect(document.activeElement).toBe(items[1]);
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    key(document.activeElement!, 'Home');
    expect(document.activeElement).toBe(items[0]);
  });

  it('closes when the focus leaves it, and leaves the focus where it went', () => {
    render();
    const outside = document.createElement('button');
    document.body.append(outside);
    click(more());
    act(() => outside.focus());
    expect($('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('shows the rename field in a dialog, not inside role="menu"', async () => {
    render('thread', 't1');
    click(more());
    // The thread's row comes from the server as the menu opens.
    await act(async () => {});
    const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.startsWith('Rename'))!;
    click(rename);
    expect($('[role="menu"] input')).toBeNull();
    const panel = $('[role="dialog"][aria-label="Rename thread"]')!;
    expect(panel.querySelector('input')?.value).toBe('Fix the rail');
    // At least 16px on a touch screen, so iOS does not zoom in on it.
    expect(panel.querySelector('input')!.className).toContain('field-sm');
  });
});

describe('the PR Filters menu', () => {
  const pr = (n: number, state: string, login: string): ListedPR => ({
    number: n,
    title: `PR ${n}`,
    author: { login },
    headRefName: `b${n}`,
    repo: 'omni-os',
    state,
    isDraft: false,
    updatedAt: '2026-11-19T10:00:00Z',
    reviewDecision: null,
    checks: { passed: 1, failed: 0, pending: 0 },
  });
  const prs = [pr(1, 'OPEN', 'ben'), pr(2, 'MERGED', 'ben'), pr(3, 'OPEN', 'sam')];
  function Host() {
    const [q, set] = useState<PRQuery>(DEFAULT_PR_QUERY);
    const ref = useRef(set);
    return createElement(PRToolbar, { q, set: ref.current, prs, repos: ['omni-os'] });
  }
  const filters = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')].find((b) => b.textContent?.includes('Filters'))!;

  it('opens on its first item, walks the items by arrow keys, and Escape gives the focus back to Filters', () => {
    act(() => root.render(createElement(Host)));
    act(() => filters().click());
    const items = [...document.querySelectorAll<HTMLElement>('[role="menu"][aria-label="Filters"] [role="menuitemcheckbox"]')];
    expect(items.length).toBeGreaterThan(2);
    expect(document.activeElement).toBe(items[0]);
    key(items[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key(items[1]!, 'End');
    expect(document.activeElement).toBe(items.at(-1));
    key(items.at(-1)!, 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    // A checkbox item says whether it is checked, not selected.
    expect(items.some((b) => b.hasAttribute('aria-selected'))).toBe(false);
    escape();
    expect($('[role="menu"][aria-label="Filters"]')).toBeNull();
    expect(document.activeElement).toBe(filters());
  });

  it('opens from the keyboard with the down arrow', () => {
    act(() => root.render(createElement(Host)));
    key(filters(), 'ArrowDown');
    expect($('[role="menu"][aria-label="Filters"]')).not.toBeNull();
  });
});
