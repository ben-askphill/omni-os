// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfirmDialog, Modal } from '../src/components/ui.tsx';

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
