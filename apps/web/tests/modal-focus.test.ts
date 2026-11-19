// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfirmDialog, Modal, useUnsavedChanges } from '../src/components/ui.tsx';
import { CommandPalette } from '../src/components/CommandPalette.tsx';

vi.mock('../src/store.tsx', async (importOriginal) => ({ ...(await importOriginal<object>()), useApp: () => ({ channels: [], openThread: null }) }));
vi.mock('../src/api.ts', async (importOriginal) => ({ ...(await importOriginal<object>()), useApi: () => ({ data: [], loading: false, error: null, reload: () => {} }) }));

// Where a modal puts the focus. The app re-renders on every thread's progress, and each render hands the modal a new
// onClose: the Fork thread sheet once moved the focus to its Close button on each one, so Ben could not type a message.

let root: Root;
let host: HTMLDivElement;
let rerender: () => void = () => {};

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

/** A modal with a message box, whose parent re-renders with a new onClose whenever `rerender` runs. */
function Sheet() {
  const [, setN] = useState(0);
  rerender = () => setN((n) => n + 1);
  return createElement(Modal, { open: true, onClose: () => {}, title: 'Fork thread', children: createElement('textarea', { id: 'message', autoFocus: true }) });
}

describe('a modal', () => {
  it('gives the focus to a field that asks for it, and keeps it there as its parent re-renders', () => {
    act(() => root.render(createElement(Sheet)));
    const box = document.getElementById('message');
    expect(document.activeElement).toBe(box);
    for (let i = 0; i < 3; i++) act(() => rerender());
    expect(document.activeElement).toBe(box);
  });

  it('focuses the control marked data-autofocus, not the first one', () => {
    act(() => root.render(createElement(ConfirmDialog, { open: true, title: 'Delete it?', confirmLabel: 'Delete', onConfirm: () => {}, onCancel: () => {}, children: 'Gone for good.' })));
    expect(document.activeElement?.textContent).toBe('Cancel');
  });
});

// The browser's part (Tab kept inside, the page behind inert, Escape to the top dialog) is in modal-browser.test.ts.
// These hold the wiring: happy-dom's dialog opens and closes but sends no close requests of its own.
describe('a modal on <dialog>', () => {
  const cancel = (d: Element) => {
    const e = new Event('cancel', { cancelable: true });
    d.dispatchEvent(e);
    return e;
  };
  const dialogs = () => [...document.querySelectorAll('dialog')];
  const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label);

  it('opens with showModal() and closes with close() when its owner unmounts it', () => {
    const show = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    act(() => root.render(createElement(Modal, { open: true, onClose: () => {}, title: 'Plain', children: 'Body' })));
    expect(show).toHaveBeenCalledTimes(1);
    expect(dialogs()[0]!.open).toBe(true);
    expect(dialogs()[0]!.hasAttribute('aria-modal')).toBe(false);
    act(() => root.render(createElement(Modal, { open: false, onClose: () => {}, title: 'Plain', children: 'Body' })));
    expect(close).toHaveBeenCalledTimes(1);
    expect(dialogs()).toEqual([]);
    show.mockRestore();
    close.mockRestore();
  });

  it('hands a close request to onClose once and keeps the browser from closing it', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Modal, { open: true, onClose, title: 'Plain', children: 'Body' })));
    const e = cancel(dialogs()[0]!);
    expect(e.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogs()[0]!.open).toBe(true);
  });

  it('gives a close request on a confirm over a modal to the confirm only', () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    const inner = createElement(ConfirmDialog, { open: true, title: 'Delete it?', confirmLabel: 'Delete', onConfirm: () => {}, onCancel, children: 'Gone.' });
    act(() => root.render(createElement(Modal, { open: true, onClose, title: 'Outer', children: inner })));
    expect(dialogs()).toHaveLength(2);
    cancel(dialogs()[1]!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  function Form({ onClose }: { onClose: () => void }) {
    const [text, setText] = useState('');
    rerender = () => setText('edited');
    return createElement(Modal, { open: true, onClose, title: 'Edit', dismiss: 'confirm', children: createElement(Body, { text }) });
  }
  function Body({ text }: { text: string }) {
    useUnsavedChanges(text !== '');
    return createElement('p', null, text);
  }

  it('closes a clean form at once, and asks first once it holds an edit', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Form, { onClose })));
    cancel(dialogs()[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => rerender());
    act(() => void cancel(dialogs()[0]!));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(2);
    expect(dialogs()[1]!.textContent).toContain('Discard your changes?');
    expect(document.activeElement?.textContent).toBe('Keep editing');

    act(() => button('Keep editing')!.click());
    expect(dialogs()).toHaveLength(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => button('Close')!.click());
    act(() => button('Discard')!.click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('gives the command menu one Tab stop, its search box', () => {
    act(() => root.render(createElement(CommandPalette, { open: true, onClose: () => {} })));
    const d = dialogs()[0]!;
    const options = [...d.querySelectorAll('[role="option"]')];
    expect(options.length).toBeGreaterThan(3);
    expect(options.every((o) => o.getAttribute('tabindex') === '-1')).toBe(true);
    expect(document.activeElement?.getAttribute('role')).toBe('combobox');
    const tabStops = [...d.querySelectorAll<HTMLElement>('button, input, [tabindex]')].filter((el) => el.tabIndex >= 0);
    expect(tabStops).toEqual([document.activeElement]);
  });
});
