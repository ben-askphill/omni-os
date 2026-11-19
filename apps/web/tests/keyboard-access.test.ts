// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Segmented, tabPanelProps, type SegKind } from '../src/components/ui.tsx';
import { MarkToolbar } from '../src/components/BrowserMarkToolbar.tsx';
import { TabStrip } from '../src/components/LiveBrowser.tsx';
import { rovingStep } from '../src/components/ui/use-roving-focus.ts';

// Keyboard access for rows of controls (W8 of docs/plans/2026-11-19-modern-web-fixes.md): the browser's tab strip, the
// annotation toolbar and Segmented each take one Tab stop, and the arrow keys, Home and End move within them.

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

const render = (el: Parameters<Root['render']>[0]) => act(() => root.render(el));
const all = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const stops = (sel: string) => all(sel).filter((el) => el.tabIndex === 0);
const press = (el: Element, key: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
const focus = (el: HTMLElement) => act(() => el.focus());

describe('rovingStep', () => {
  it('moves by one with the arrows, jumps with Home and End, and wraps at both ends', () => {
    expect(rovingStep('ArrowRight', 0, 3)).toBe(1);
    expect(rovingStep('ArrowRight', 2, 3)).toBe(0);
    expect(rovingStep('ArrowLeft', 0, 3)).toBe(2);
    expect(rovingStep('Home', 2, 3)).toBe(0);
    expect(rovingStep('End', 0, 3)).toBe(2);
  });

  it('leaves Up and Down to the page unless the row is vertical too', () => {
    expect(rovingStep('ArrowDown', 0, 3)).toBeUndefined();
    expect(rovingStep('ArrowDown', 0, 3, true)).toBe(1);
    expect(rovingStep('ArrowUp', 0, 3, true)).toBe(2);
    expect(rovingStep('a', 0, 3)).toBeUndefined();
  });
});

function Seg({ kind, manual, onPick }: { kind?: SegKind; manual?: boolean; onPick?: (id: string) => void }) {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('b');
  const options = [
    { id: 'a' as const, label: 'A' },
    { id: 'b' as const, label: 'B' },
    { id: 'c' as const, label: 'C' },
  ];
  return createElement(
    'div',
    null,
    createElement(Segmented<'a' | 'b' | 'c'>, {
      kind,
      manual,
      panel: kind === 'tabs' ? 'p' : undefined,
      label: 'Pick',
      value,
      onChange: (id) => (setValue(id), onPick?.(id)),
      options: kind === 'nav' ? options.map((o) => ({ ...o, href: `#/${o.id}` })) : options,
    }),
    kind === 'tabs' ? createElement('div', tabPanelProps('p', value), `Panel ${value}`) : null,
  );
}

describe('Segmented', () => {
  it('is a radio group by default: one Tab stop on the checked option, and the arrows move and pick', () => {
    const picked = vi.fn();
    render(createElement(Seg, { onPick: picked }));
    expect(host.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Pick');
    const radios = all('[role="radio"]');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(stops('[role="radio"]')).toEqual([radios[1]]);

    focus(radios[1]);
    press(radios[1], 'ArrowRight');
    expect(document.activeElement).toBe(radios[2]);
    expect(picked).toHaveBeenLastCalledWith('c');
    expect(radios[2].getAttribute('aria-checked')).toBe('true');
    expect(stops('[role="radio"]')).toEqual([radios[2]]);

    press(radios[2], 'ArrowDown');
    expect(document.activeElement).toBe(radios[0]);
    expect(picked).toHaveBeenLastCalledWith('a');
    press(radios[0], 'End');
    expect(picked).toHaveBeenLastCalledWith('c');
  });

  it('as tabs: a tablist whose selected tab names the panel, picked by the arrows', () => {
    render(createElement(Seg, { kind: 'tabs' }));
    const tabs = all('[role="tab"]');
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    const panel = host.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[1].id);

    focus(tabs[1]);
    press(tabs[1], 'ArrowLeft');
    expect(document.activeElement).toBe(tabs[0]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);
    expect(panel.textContent).toBe('Panel a');
  });

  it('as manual tabs: the arrows only move the focus, and Enter or Space (a click) picks', () => {
    const picked = vi.fn();
    render(createElement(Seg, { kind: 'tabs', manual: true, onPick: picked }));
    const tabs = all('[role="tab"]');
    focus(tabs[1]);
    press(tabs[1], 'ArrowRight');
    expect(document.activeElement).toBe(tabs[2]);
    expect(picked).not.toHaveBeenCalled();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    // Tab out and back lands on the selected tab, not the one last focused.
    expect(stops('[role="tab"]')).toEqual([tabs[1]]);
    act(() => tabs[2].click());
    expect(picked).toHaveBeenCalledWith('c');
    expect(stops('[role="tab"]')).toEqual([tabs[2]]);
  });

  it('as nav: links in a nav, the current page marked aria-current, no tab roles', () => {
    render(createElement(Seg, { kind: 'nav' }));
    const nav = host.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Pick');
    const links = all('nav a');
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null]);
    expect(host.querySelector('[role="tab"],[role="tablist"],[role="radio"]')).toBeNull();
    // Each link is its own Tab stop: nothing sets tabindex on them.
    expect(links.every((a) => !a.hasAttribute('tabindex'))).toBe(true);
  });
});

function Toolbar({ canUndo = false }: { canUndo?: boolean }) {
  const [tool, setTool] = useState<'select' | 'pen' | 'text' | 'rect'>('select');
  return createElement(MarkToolbar, {
    tool,
    shape: 'rect',
    color: '#ff0000',
    stroke: 4,
    canUndo,
    canDelete: false,
    onTool: (t) => setTool(t as typeof tool),
    onShape: () => {},
    onColor: () => {},
    onStroke: () => {},
    onUndo: () => {},
    onDelete: () => {},
  });
}

describe('the annotation toolbar', () => {
  const items = () => all('[role="toolbar"] [data-roving-item]');
  const named = (name: string) => host.querySelector<HTMLElement>(`[role="toolbar"] [aria-label="${name}"]`)!;

  it('has one Tab stop, and the chosen tool says it is pressed', () => {
    render(createElement(Toolbar));
    expect(stops('[role="toolbar"] [data-roving-item]')).toHaveLength(1);
    expect(named('Select').getAttribute('aria-pressed')).toBe('true');
    expect(named('Pen').getAttribute('aria-pressed')).toBe('false');
    // Undo and Delete are actions, not toggles.
    expect(named('Undo the last mark').hasAttribute('aria-pressed')).toBe(false);
  });

  it('moves with the arrows without picking, skips what cannot run, and Tab comes back to the last tool focused', () => {
    render(createElement(Toolbar));
    focus(named('Select'));
    press(named('Select'), 'ArrowRight');
    expect(document.activeElement).toBe(named('Pen'));
    expect(named('Pen').getAttribute('aria-pressed')).toBe('false');
    expect(stops('[role="toolbar"] [data-roving-item]')).toEqual([named('Pen')]);

    // Undo and Delete are disabled: End lands on the last control that runs, Line width.
    press(named('Pen'), 'End');
    expect(document.activeElement).toBe(named('Line width'));
    press(named('Line width'), 'ArrowRight');
    expect(document.activeElement).toBe(named('Select'));

    act(() => named('Pen').click());
    expect(named('Pen').getAttribute('aria-pressed')).toBe('true');
    expect(items().filter((el) => el.getAttribute('aria-pressed') === 'true')).toEqual([named('Pen')]);
  });

  it('reaches Undo once there is a mark to undo', () => {
    render(createElement(Toolbar, { canUndo: true }));
    focus(named('Select'));
    press(named('Select'), 'End');
    expect(document.activeElement).toBe(named('Undo the last mark'));
  });
});

describe("the browser's tab strip", () => {
  const state = {
    running: true,
    url: 'https://a.test/',
    title: 'A',
    loading: false,
    canBack: false,
    canForward: false,
    active: 't2',
    tabs: [
      { id: 't1', url: 'https://a.test/', title: 'A' },
      { id: 't2', url: 'https://b.test/', title: 'B' },
      { id: 't3', url: 'https://c.test/', title: 'C' },
    ],
  };
  const tabs = () => all('[role="tab"]');

  it('holds only tab buttons, one Tab stop on the active tab; New tab sits outside the tablist', () => {
    render(createElement(TabStrip, { b: { state, action: vi.fn() } }));
    const list = host.querySelector('[role="tablist"]')!;
    expect(tabs().every((t) => t.tagName === 'BUTTON')).toBe(true);
    expect(list.querySelectorAll('button:not([role="tab"])')).toHaveLength(0);
    expect(list.contains(host.querySelector('[aria-label="New tab"]'))).toBe(false);
    expect(stops('[role="tab"]')).toEqual([tabs()[1]]);
  });

  it('moves focus with the arrows without switching, switches on Enter (a click), and closes the focused tab on Delete', () => {
    const action = vi.fn(async () => {});
    render(createElement(TabStrip, { b: { state, action } }));
    focus(tabs()[1]);
    press(tabs()[1], 'ArrowRight');
    expect(document.activeElement).toBe(tabs()[2]);
    press(tabs()[2], 'Home');
    expect(document.activeElement).toBe(tabs()[0]);
    expect(action).not.toHaveBeenCalled();

    act(() => tabs()[0].click());
    expect(action).toHaveBeenLastCalledWith({ action: 'tab', id: 't1' });

    press(tabs()[0], 'Delete');
    expect(action).toHaveBeenLastCalledWith({ action: 'closeTab', id: 't1' });
    // The focus moves to the tab beside it, so it does not fall to the page when the closed tab goes.
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs()[0].getAttribute('aria-keyshortcuts')).toBe('Delete');
  });
});
