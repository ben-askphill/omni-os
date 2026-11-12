// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// "i" opens the Inbox in both desktop layouts, never while typing, and not at all once Settings turns it off.

vi.mock('../src/store.tsx', async (importActual) => ({
  ...(await importActual<typeof import('../src/store.tsx')>()),
  useApp: () => ({ channels: [], needsYou: null, profile: null }),
}));

import { ChannelRail } from '../src/components/rail/ChannelRail.tsx';
import { readInboxKeyOn, setInboxKeyOn, useInboxKey } from '../src/inbox-key.ts';

let root: Root;
let host: HTMLDivElement;
const press = (target: EventTarget = document.body) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true })));

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/c/acne';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the i key', () => {
  it('is on until Settings turns it off, and the choice survives a reload', () => {
    expect(readInboxKeyOn()).toBe(true);
    setInboxKeyOn(false);
    expect(localStorage.getItem('omni.keys.inbox')).toBe('false');
    expect(readInboxKeyOn()).toBe(false);
  });

  it('opens the Inbox from the channel rail', async () => {
    act(() => root.render(createElement(ChannelRail, { selection: { kind: 'channel', id: 'acne' } })));
    await press();
    expect(window.location.hash).toBe('#/');
  });

  it('does nothing in the channel rail once turned off', async () => {
    setInboxKeyOn(false);
    act(() => root.render(createElement(ChannelRail, { selection: { kind: 'channel', id: 'acne' } })));
    await press();
    expect(window.location.hash).toBe('#/c/acne');
  });

  it('runs the classic sidebar handler when on, skips it when off or typing', async () => {
    const open = vi.fn();
    const Probe = () => (useInboxKey(open), createElement('input'));
    act(() => root.render(createElement(Probe)));
    await press();
    expect(open).toHaveBeenCalledTimes(1);
    await press(host.querySelector('input')!);
    expect(open).toHaveBeenCalledTimes(1);
    setInboxKeyOn(false);
    await press();
    expect(open).toHaveBeenCalledTimes(1);
    setInboxKeyOn(true);
    await press();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
