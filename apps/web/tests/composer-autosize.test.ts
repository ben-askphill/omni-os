// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fieldSizes, useAutosize } from '../src/components/composer/controls.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The composer boxes grow with `field-sizing: content` where the browser has it, and an inline height would override
// that, so the hook must write none there. Older iOS Safari still gets the measured height.

function Box({ text }: { text: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, text);
  return createElement('textarea', { ref, value: text, readOnly: true, className: 'field-sizing-content max-h-[220px]' });
}

let root: Root;
let host: HTMLElement;
const render = (text: string) => act(() => root.render(createElement(Box, { text })));
const box = () => host.querySelector('textarea')!;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  // The text's height, as a browser would lay it out: 30px a line.
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
    return 30 * this.value.split('\n').length;
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const supports = (yes: boolean) => vi.stubGlobal('CSS', { supports: (p: string, v?: string) => yes && p === 'field-sizing' && v === 'content' });

describe('useAutosize', () => {
  it('writes no height where field-sizing works, as the text grows and shrinks', () => {
    supports(true);
    expect(fieldSizes()).toBe(true);
    render('one');
    render('one\ntwo\nthree');
    render('');
    expect(box().style.height).toBe('');
  });

  it('measures the height where it does not, following the text both ways', () => {
    supports(false);
    expect(fieldSizes()).toBe(false);
    render('one');
    expect(box().style.height).toBe('30px');
    render('one\ntwo\nthree');
    expect(box().style.height).toBe('90px');
    render('one');
    expect(box().style.height).toBe('30px');
  });
});
