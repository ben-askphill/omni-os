// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The rail's More menu is portaled to the end of the page, so closing it has to hand focus back to its disc.

vi.mock('../src/store.tsx', async (importActual) => ({
  ...(await importActual<typeof import('../src/store.tsx')>()),
  useApp: () => ({ channels: [], needsYou: null, profile: null }),
}));

import { ChannelRail } from '../src/components/rail/ChannelRail.tsx';

let root: Root;
let host: HTMLDivElement;
const disc = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const key = (target: Element, k: string) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));

beforeEach(() => {
  window.location.hash = '#/inbox';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(ChannelRail, { selection: { kind: 'inbox' } })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the rail More menu', () => {
  it('opens on the down arrow with its first item focused, lists the three pages, and the disc toggles it shut', () => {
    disc().focus();
    key(disc(), 'ArrowDown');
    expect(disc().getAttribute('aria-expanded')).toBe('true');
    expect([...menu()!.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)).toEqual(['Pull requests', 'Artifacts', 'Automations']);
    expect(document.activeElement?.textContent).toBe('Pull requests');
    act(() => disc().click());
    expect(menu()).toBeNull();
  });

  it('hands focus back to the disc on Tab, so Tab moves on from the rail instead of the end of the page', () => {
    act(() => disc().click());
    const item = document.activeElement!;
    expect(menu()?.contains(item)).toBe(true);
    key(item, 'Tab');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(disc());
  });

  it('hands focus back to the disc on Escape', () => {
    act(() => disc().click());
    key(document.activeElement!, 'Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(disc());
  });

  it('opens the picked page and closes', () => {
    act(() => disc().click());
    act(() => [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][2]!.click());
    expect(window.location.hash).toBe('#/automations');
    expect(menu()).toBeNull();
  });
});
