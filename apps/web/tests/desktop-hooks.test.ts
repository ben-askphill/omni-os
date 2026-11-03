// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DesktopBridge, DesktopEvent } from '@omni/shared/desktop-bridge.ts';

// The desktop app's menu commands reach the page through DesktopHooks, whichever layout is on screen: the sidebar
// shell or the phone layout a narrow window falls into. Route commands work with no shell at all; New Thread and
// Go to… do what the shell on screen registered.

const post = vi.fn(async (_path: string) => ({}));
vi.mock('../src/api.ts', () => ({ api: { post: (path: string) => post(path) } }));

let emit: (event: DesktopEvent) => void = () => {};
const bridge = { platform: 'darwin', onEvent: (fn: (e: DesktopEvent) => void) => ((emit = fn), () => (emit = () => {})) } as unknown as DesktopBridge;
window.omniDesktop = bridge;

const { DesktopHooks, useDesktopLayoutActions } = await import('../src/components/DesktopHooks.tsx');

let root: Root;
let host: HTMLElement;
const render = (node: ReactNode) => act(() => root.render(node));
const command = (c: Extract<DesktopEvent, { type: 'command' }>['command']) => act(() => emit({ type: 'command', command: c }));

function Layout({ newThread, goTo, children }: { newThread: () => void; goTo: () => void; children?: ReactNode }) {
  useDesktopLayoutActions({ newThread, goTo });
  return children ?? null;
}

beforeEach(() => {
  location.hash = '#/';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  post.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('DesktopHooks', () => {
  it('carries out the route commands with no shell registered', async () => {
    await render(createElement(DesktopHooks));
    const cases = [
      ['settings', '#/settings'],
      ['search', '#/search'],
      ['home', '#/'],
    ] as const;
    for (const [c, to] of cases) {
      await command(c);
      expect(location.hash.replace(/\?.*$/, '')).toBe(to);
    }
  });

  it('sends New Thread and Go to… to the shell on screen, and follows a switch of layout', async () => {
    const desk = { newThread: vi.fn(), goTo: vi.fn() };
    const phone = { newThread: vi.fn(), goTo: vi.fn() };
    await render([createElement(DesktopHooks, { key: 'h' }), createElement(Layout, { key: 'desk', ...desk })]);
    await command('new-thread');
    await command('go-to');
    expect(desk.newThread).toHaveBeenCalledTimes(1);
    expect(desk.goTo).toHaveBeenCalledTimes(1);

    // The window narrows into the phone layout: the hooks stay mounted and the phone shell takes over.
    await render([createElement(DesktopHooks, { key: 'h' }), createElement(Layout, { key: 'phone', ...phone })]);
    await command('new-thread');
    await command('go-to');
    await command('settings');
    expect(phone.newThread).toHaveBeenCalledTimes(1);
    expect(phone.goTo).toHaveBeenCalledTimes(1);
    expect(desk.newThread).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#/settings');
  });

  it('nudges sync when the Mac wakes', async () => {
    vi.useFakeTimers();
    try {
      await render(createElement(DesktopHooks));
      await act(() => emit({ type: 'resume' }));
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      expect(post).toHaveBeenCalledWith('/sync/now');
    } finally {
      vi.useRealTimers();
    }
  });
});
