// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { layerCount, layerOpen, pushLayer } from '../src/components/ui/dismiss-stack.ts';
import { useTooltip } from '../src/components/ui/tooltip.tsx';

// The shared Tooltip (components/ui/tooltip.tsx, audit M29) where the browser has no popovers, as here: a fixed box it
// shows and hides itself. tests/tooltip-browser.test.ts runs the interest-invoker and popover paths in Chromium.

let root: Root;
let host: HTMLDivElement;

function Tip({ text, describes }: { text: string; describes?: boolean }) {
  const { triggerProps, tip } = useTooltip(text, { describes });
  return createElement(Fragment, null, createElement('button', { ...triggerProps, id: 'trigger', 'aria-label': 'Volero' }, 'V'), tip);
}

const render = (props: { text: string; describes?: boolean }) => act(() => root.render(createElement(Tip, props)));
const trigger = () => document.getElementById('trigger')!;
const tip = () => trigger().nextElementSibling as HTMLElement;
const shown = () => !tip().hidden;
const pointer = (type: string, el: Element) => act(() => void el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse' })));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Tooltip without popovers', () => {
  it('opens after a short hover and closes when the pointer leaves', async () => {
    await render({ text: 'Double-click or F2 to rename' });
    expect(tip().dataset.mode).toBe('plain');
    expect(shown()).toBe(false);
    pointer('pointerover', trigger());
    act(() => void vi.advanceTimersByTime(300));
    expect(shown()).toBe(false);
    act(() => void vi.advanceTimersByTime(300));
    expect(shown()).toBe(true);
    pointer('pointerout', trigger());
    act(() => void vi.advanceTimersByTime(200));
    expect(shown()).toBe(false);
  });

  it('opens at once on keyboard focus and closes on blur', async () => {
    await render({ text: 'Double-click or F2 to rename' });
    act(() => trigger().focus());
    expect(shown()).toBe(true);
    act(() => trigger().blur());
    expect(shown()).toBe(false);
  });

  it('closes on Escape alone: the page and the layer under it never hear the key', async () => {
    const under = vi.fn();
    const pop = pushLayer({ roots: () => [], escape: under });
    const page = vi.fn();
    window.addEventListener('keydown', page);
    try {
      await render({ text: 'Double-click or F2 to rename' });
      act(() => trigger().focus());
      expect(shown()).toBe(true);
      expect(layerCount()).toBe(2);
      act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      expect(shown()).toBe(false);
      expect(under).not.toHaveBeenCalled();
      expect(page).not.toHaveBeenCalled();
      // With the focus still there it stays shut until the focus leaves and comes back.
      act(() => void vi.advanceTimersByTime(1000));
      expect(shown()).toBe(false);
      act(() => document.body.focus());
      act(() => trigger().focus());
      expect(shown()).toBe(true);
    } finally {
      window.removeEventListener('keydown', page);
      pop();
    }
  });

  it("is not a layer the page's keys or a press wait for", async () => {
    await render({ text: 'Double-click or F2 to rename' });
    act(() => trigger().focus());
    expect(shown()).toBe(true);
    // Only the tip is open: I for the Inbox and Esc to interrupt still work.
    expect(layerOpen()).toBe(false);
    act(() => trigger().blur());
    const outside = vi.fn();
    const pop = pushLayer({ roots: () => [], outside });
    try {
      act(() => trigger().focus());
      expect(shown()).toBe(true);
      // A press outside goes to the layer under the tip, and closes the tip too.
      act(() => void document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })));
      expect(outside).toHaveBeenCalledTimes(1);
      expect(shown()).toBe(false);
    } finally {
      pop();
    }
  });

  it("describes its trigger with role tooltip, and leaves a tip that repeats the trigger's name alone", async () => {
    await render({ text: 'Double-click or F2 to rename' });
    expect(trigger().getAttribute('aria-describedby')).toBe(tip().id);
    expect(tip().getAttribute('role')).toBe('tooltip');
    expect(tip().textContent).toBe('Double-click or F2 to rename');
    await render({ text: 'Volero', describes: false });
    expect(trigger().hasAttribute('aria-describedby')).toBe(false);
    expect(tip().hasAttribute('role')).toBe(false);
  });

  it('renders no tip for no text', async () => {
    await render({ text: '' });
    expect(trigger().nextElementSibling).toBeNull();
    expect(trigger().hasAttribute('aria-describedby')).toBe(false);
  });
});
