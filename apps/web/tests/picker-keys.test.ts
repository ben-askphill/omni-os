// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HarnessWithRunning } from '../src/api.ts';
import { Picker, type PickerOption } from '../src/components/ui.tsx';
import { ModelPicker, type ModelChoice } from '../src/components/ModelPicker.tsx';

// The shared Picker and ModelPicker (audit H4, M13): the focus stays on the search field or the list, and
// aria-activedescendant names the option under the cursor, so a screen reader reads each one as the arrow keys move.
// Escape closes only the picker and gives the focus back to its pill. The list is a top-layer popover where the browser
// has one, and a tap outside still closes it by hand, as iOS Safari before 18.3 does not light dismiss on a tap.

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

const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));
/** A mouse click: `detail` 1, where a click from Enter or Space has 0. */
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
/** A press: the pointer, then the mouse event a browser sends after it, a tap too. */
const press = (el: Element, pointerType: 'mouse' | 'touch') =>
  act(() => {
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerType, bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
const $ = <E extends Element = HTMLElement>(sel: string) => document.querySelector<E>(sel);
const active = (owner: Element) => document.getElementById(owner.getAttribute('aria-activedescendant') ?? '');

const options: PickerOption<string>[] = [
  { value: 'a', label: 'Alpha', avatar: false },
  { value: 'b', label: 'Bravo', avatar: false },
  { value: 'c', label: 'Charlie', avatar: false, disabled: true, sub: 'Offline' },
  { value: 'd', label: 'Delta', avatar: false },
];

function PickerHost({ searchable, onChange = () => {} }: { searchable?: boolean; onChange?: (v: string) => void }) {
  const [value, setValue] = useState('b');
  return createElement(Picker<string>, {
    label: 'Machine',
    value,
    options,
    searchable,
    onChange: (v: string) => {
      setValue(v);
      onChange(v);
    },
  });
}

const pill = () => $<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;

describe('the shared Picker without a search field', () => {
  it('opens on ArrowDown with the list focused and the picked option active', () => {
    act(() => root.render(createElement(PickerHost)));
    key(pill(), 'ArrowDown');
    const list = $('[role="listbox"]')!;
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    expect(pill().getAttribute('aria-controls')).toBe(list.id);
    expect(document.activeElement).toBe(list);
    expect(active(list)?.textContent).toContain('Bravo');
    expect(active(list)?.getAttribute('role')).toBe('option');
  });

  it('moves aria-activedescendant with the arrow keys, Home and End', () => {
    act(() => root.render(createElement(PickerHost)));
    key(pill(), 'ArrowDown');
    const list = $('[role="listbox"]')!;
    key(list, 'ArrowDown');
    expect(active(list)?.textContent).toContain('Charlie');
    key(list, 'ArrowDown');
    expect(active(list)?.textContent).toContain('Delta');
    key(list, 'ArrowDown');
    expect(active(list)?.textContent).toContain('Delta');
    key(list, 'Home');
    expect(active(list)?.textContent).toContain('Alpha');
    key(list, 'End');
    expect(active(list)?.textContent).toContain('Delta');
    key(list, 'ArrowUp');
    expect(active(list)?.textContent).toContain('Charlie');
  });

  it('shows the focus ring on the cursor once the keys move it, and keeps options out of the Tab order', () => {
    act(() => root.render(createElement(PickerHost)));
    click(pill());
    const card = $('.pik-card')!;
    expect(card.hasAttribute('data-keys')).toBe(false);
    key($('[role="listbox"]')!, 'ArrowDown');
    expect(card.hasAttribute('data-keys')).toBe(true);
    expect([...document.querySelectorAll('[role="option"]')].every((o) => o.getAttribute('tabindex') === '-1')).toBe(true);
  });

  it('picks with Enter and gives the focus back to the pill, but not a disabled option', () => {
    const onChange = vi.fn();
    act(() => root.render(createElement(PickerHost, { onChange })));
    key(pill(), 'ArrowDown');
    key($('[role="listbox"]')!, 'ArrowDown');
    key($('[role="listbox"]')!, 'Enter');
    expect(onChange).not.toHaveBeenCalled();
    key($('[role="listbox"]')!, 'ArrowDown');
    key($('[role="listbox"]')!, 'Enter');
    expect(onChange).toHaveBeenCalledWith('d');
    expect($('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(pill());
    expect(pill().getAttribute('aria-label')).toBe('Machine: Delta');
  });

  it('closes on Escape, gives the focus back, and leaves a modal around it open', () => {
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    act(() => root.render(createElement(PickerHost)));
    click(pill());
    key($('[role="listbox"]')!, 'Escape');
    window.removeEventListener('keydown', outer);
    expect($('[role="listbox"]')).toBeNull();
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(pill());
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('the shared Picker with a search field', () => {
  it('makes the field a combobox that names the active option, and follows the search', () => {
    act(() => root.render(createElement(PickerHost, { searchable: true })));
    click(pill());
    const field = $<HTMLInputElement>('input[role="combobox"]')!;
    const list = $('[role="listbox"]')!;
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('aria-controls')).toBe(list.id);
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(active(field)?.textContent).toContain('Bravo');
    key(field, 'ArrowDown');
    expect(active(field)?.textContent).toContain('Charlie');
    key(field, 'ArrowUp');
    key(field, 'ArrowUp');
    expect(active(field)?.textContent).toContain('Alpha');

    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(field, 'del');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect([...list.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['Delta']);
    expect(active(field)?.textContent).toContain('Delta');
    key(field, 'Escape');
    expect(document.activeElement).toBe(pill());
  });
});

describe('the shared Picker on a browser without popovers', () => {
  it('stays inline under its pill and closes on a press outside', () => {
    act(() => root.render(createElement(PickerHost)));
    click(pill());
    const card = $('.pik-card')!;
    expect(card.hasAttribute('popover')).toBe(false);
    expect(card.className).toContain('top-[calc(100%+8px)]');
    press(document.body, 'mouse');
    expect($('.pik-card')).toBeNull();
  });
});

describe('the shared Picker as a popover', () => {
  let shown: { el: HTMLElement; source?: HTMLElement }[];

  beforeEach(() => {
    shown = [];
    // happy-dom reflects the attribute but has no showPopover: one that records what it was handed.
    HTMLElement.prototype.showPopover = function (this: HTMLElement, o?: { source?: HTMLElement }) {
      shown.push({ el: this, source: o?.source });
    } as HTMLElement['showPopover'];
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { showPopover?: unknown }).showPopover;
  });

  it('shows the list as an auto popover with the pill as its source, then focuses it', () => {
    act(() => root.render(createElement(PickerHost)));
    click(pill());
    const card = $('.pik-card')!;
    expect(card.getAttribute('popover')).toBe('auto');
    expect(shown).toEqual([{ el: card, source: pill() }]);
    expect(document.activeElement).toBe($('[role="listbox"]'));
  });

  it('closes when the browser light dismisses it', () => {
    act(() => root.render(createElement(PickerHost)));
    click(pill());
    act(() => void $('.pik-card')!.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed' })));
    expect($('.pik-card')).toBeNull();
    expect(pill().getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves a mouse press outside to the browser, but closes on a tap outside itself (iOS Safari 18.0 to 18.2)', () => {
    act(() => root.render(createElement(PickerHost)));
    click(pill());
    press(document.body, 'mouse');
    expect($('.pik-card')).not.toBeNull();
    press($('[role="option"]')!, 'touch');
    expect($('.pik-card')).not.toBeNull();
    press(document.body, 'touch');
    expect($('.pik-card')).toBeNull();
  });

  it('closes, not reopens, when the pill is pressed while open', () => {
    act(() => root.render(createElement(PickerHost)));
    click(pill());
    act(() => {
      pill().dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
      // A browser without `source` light dismisses it before the pill's click.
      $('.pik-card')!.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed' }));
    });
    click(pill());
    expect($('.pik-card')).toBeNull();
  });
});

const harnesses = [
  {
    id: 'claude',
    name: 'Claude Code',
    plan: 'Max plan',
    available: true,
    running: 0,
    models: [
      { id: 'opus', label: 'Opus', efforts: ['low', 'high'], default: true },
      { id: 'sonnet', label: 'Sonnet', efforts: [] },
    ],
  },
  { id: 'codex', name: 'Codex', plan: 'Plus plan', available: false, fix: 'codex login', running: 0, models: [{ id: 'gpt', label: 'GPT', efforts: [] }] },
  { id: 'cursor', name: 'Cursor Agent', plan: 'API', available: true, running: 0, models: [{ id: 'auto', label: 'Cursor Auto', efforts: [] }] },
] as unknown as HarnessWithRunning[];

function ModelHost({ onChange = () => {}, withEffort }: { onChange?: (v: ModelChoice) => void; withEffort?: boolean }) {
  // Opus has effort levels, so the list ends with them.
  const [value, setValue] = useState<ModelChoice>({ harness: 'claude', model: withEffort ? 'opus' : 'sonnet' });
  const [effort, setEffort] = useState('');
  return createElement(ModelPicker, {
    harnesses,
    value,
    onChange: (v: ModelChoice) => {
      setValue(v);
      onChange(v);
    },
    effort: withEffort ? { value: effort, onChange: setEffort } : undefined,
  });
}

const modelPill = () => $<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;

describe('ModelPicker', () => {
  it('opens with its search field as a combobox on the picked model', () => {
    act(() => root.render(createElement(ModelHost)));
    click(modelPill());
    const field = $<HTMLInputElement>('input[role="combobox"]')!;
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('aria-controls')).toBe($('[role="listbox"]')!.id);
    expect(modelPill().getAttribute('aria-controls')).toBe($('[role="listbox"]')!.id);
    expect(active(field)?.textContent).toContain('Sonnet');
  });

  it('moves through the models with the arrow keys, past headers and an unavailable harness', () => {
    act(() => root.render(createElement(ModelHost)));
    click(modelPill());
    const field = $<HTMLInputElement>('input[role="combobox"]')!;
    key(field, 'ArrowDown');
    expect(active(field)?.textContent).toContain('Cursor Auto');
    key(field, 'ArrowDown');
    expect(active(field)?.textContent).toContain('Cursor Auto');
    key(field, 'ArrowUp');
    key(field, 'ArrowUp');
    key(field, 'ArrowUp');
    expect(active(field)?.textContent).toContain('Auto');
    expect(active(field)?.textContent).toContain('Picks a model');
  });

  it('picks with Enter and gives the focus back to the pill', () => {
    const onChange = vi.fn();
    act(() => root.render(createElement(ModelHost, { onChange })));
    click(modelPill());
    const field = $<HTMLInputElement>('input[role="combobox"]')!;
    key(field, 'ArrowUp');
    key(field, 'Enter');
    expect(onChange).toHaveBeenCalledWith({ harness: 'claude', model: 'opus' });
    expect($('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(modelPill());
  });

  it('closes on Escape from the search and from the effort levels, and the Escape stops there', () => {
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    act(() => root.render(createElement(ModelHost, { withEffort: true })));
    click(modelPill());
    key($('input[role="combobox"]')!, 'Escape');
    expect($('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(modelPill());

    click(modelPill());
    const level = $<HTMLButtonElement>('[role="radio"]')!;
    level.focus();
    key(level, 'Escape');
    window.removeEventListener('keydown', outer);
    expect($('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(modelPill());
    expect(outer).not.toHaveBeenCalled();
  });

  it('opens from the keyboard with ArrowDown on the pill', () => {
    act(() => root.render(createElement(ModelHost)));
    key(modelPill(), 'ArrowDown');
    expect($('input[role="combobox"]')).toBe(document.activeElement);
    expect($('.pik-card')!.hasAttribute('data-keys')).toBe(true);
  });

  it('keeps only options and labelled groups in its listbox', () => {
    act(() => root.render(createElement(ModelHost)));
    click(modelPill());
    const list = $('[role="listbox"]')!;
    expect([...list.children].map((c) => c.getAttribute('role'))).toEqual(['option', 'group', 'group', 'group']);
    const groups = [...list.querySelectorAll('[role="group"]')];
    const names = groups.map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent);
    expect(names[0]).toContain('Claude CodeBills your Max plan');
    expect(names[1]).toContain('CodexUnavailable');
    expect(names[2]).toContain('Cursor AgentAPI');
    expect(groups[1].querySelector('[role="option"]')).toBeNull();
  });

  it('closes on a press outside', () => {
    act(() => root.render(createElement(ModelHost)));
    click(modelPill());
    press(document.body, 'mouse');
    expect($('[role="listbox"]')).toBeNull();
  });
});
