// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSlidingThumb, type ThumbBox } from '../src/components/ui/thumb.tsx';

// The sidebar's highlight stretches over the old and new rows, then settles on the new one. Opening a thread changes
// the hook's key more than once (the hash, then the rows that load with it), and the highlight must still settle.

const ROW = 32;
let active = 0;
let seen: ThumbBox | null = null;

function List({ k }: { k: string }) {
  const ref = useRef<HTMLDivElement>(null);
  seen = useSlidingThumb(ref, k, true, '[data-active="true"]');
  return createElement(
    'div',
    { ref },
    [0, 1].map((i) => createElement('a', { key: i, 'data-active': i === active || undefined })),
  );
}

let root: Root;
let host: HTMLElement;
const render = (k: string) => act(() => root.render(createElement(List, { k })));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return [...(this.parentElement?.children ?? [])].indexOf(this) * ROW;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(ROW);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(0);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  active = 0;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useSlidingThumb', () => {
  it('settles on the next row when the key changes again mid-stretch', async () => {
    await render('a');
    active = 1;
    await render('b');
    expect(seen).toMatchObject({ y: 0, h: ROW * 2, phase: 'stretch' });
    await render('b+rows');
    await act(() => vi.advanceTimersByTime(200));
    expect(seen).toMatchObject({ y: ROW, h: ROW, phase: 'settle' });
  });
});
