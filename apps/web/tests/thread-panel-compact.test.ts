// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useThreadPanel } from '../src/pages/useThreadPanel.ts';

// A thread opens on the compact quick card. The full inspector opens only when Ben clicks into it, and the next
// thread opens on the card again, whatever the last one was left on.

let root: Root;
let host: HTMLDivElement;
let panel: ReturnType<typeof useThreadPanel>;
const select = vi.fn();
const Probe = ({ artifact }: { artifact?: number }) => {
  panel = useThreadPanel({ artifactParam: artifact, loaded: true, select });
  return null;
};
const open = (artifact?: number) => act(() => root.render(createElement(Probe, { key: Math.random(), artifact })));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  select.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('the thread panel', () => {
  it('opens a thread on the quick card', () => {
    open();
    expect(panel.surface).toBe('card');
  });

  it('opens on the card even when the last thread was left on the inspector', () => {
    localStorage.setItem('omni.threadPanelSurface', JSON.stringify('inspector'));
    localStorage.setItem('omni.threadPanel', 'true');
    open();
    expect(panel.surface).toBe('card');
  });

  it('opens the inspector only on a click, and the next thread opens on the card', () => {
    open();
    expect(panel.surface).toBe('card');
    act(() => panel.show());
    expect(panel.surface).toBe('inspector');
    open();
    expect(panel.surface).toBe('card');
  });

  it('keeps a hidden panel hidden', () => {
    open();
    act(() => panel.toggle());
    expect(panel.surface).toBe('collapsed');
    open();
    expect(panel.surface).toBe('collapsed');
  });

  it('opens the inspector for an artifact link Ben followed', () => {
    open(7);
    expect(select).toHaveBeenCalledWith(7);
    expect(panel.surface).toBe('inspector');
  });
});
