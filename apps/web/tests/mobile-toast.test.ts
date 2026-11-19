// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MoToastRegion, type MoToastNote } from '../src/mobile/parts.tsx';

// The phone's toast: VoiceOver reads a note only when it lands in a live region that was already there, and an error
// cut to one line and gone after 2.2 s could not be read at all.

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

const render = (note: MoToastNote | null, onDismiss = () => {}) => act(() => root.render(createElement(MoToastRegion, { note, onDismiss })));

describe('the phone toast region', () => {
  it('is in the page, empty, before the first toast', () => {
    render(null);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('');
  });

  it('puts a note in the polite region, into the same element', () => {
    render(null);
    const status = host.querySelector('[role="status"]');
    render({ text: 'Renamed', key: 1 });
    expect(host.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe('Renamed');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('');
    expect(host.querySelector('button')).toBeNull();
  });

  it('reads an error out at once and lets it wrap, with a button to dismiss it', () => {
    const onDismiss = vi.fn();
    const long = 'Could not reach the machine that runs this thread. It may be asleep or offline.';
    render({ text: long, key: 2, error: true }, onDismiss);
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe(long);
    expect(alert.innerHTML).not.toContain('nowrap');
    act(() => (alert.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement).click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
