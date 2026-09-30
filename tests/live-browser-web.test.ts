import { describe, it, expect } from 'vitest';
import { displayUrl, enqueueInput } from '../web/src/components/LiveBrowser.tsx';

describe('enqueueInput: batching panel input while Chrome catches up', () => {
  const move = (x: number) => ({ type: 'mouse', event: 'mouseMoved', x, y: 0 });
  const wheel = (dy: number, modifiers = 0) => ({ type: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: dy, modifiers });

  it('keeps only the newest of consecutive moves', () => {
    const q: any[] = [];
    for (const x of [1, 2, 3]) enqueueInput(q, move(x));
    expect(q).toEqual([move(3)]);
  });

  it('adds up consecutive scrolls with the same modifiers', () => {
    const q: any[] = [];
    enqueueInput(q, wheel(10));
    enqueueInput(q, wheel(15));
    enqueueInput(q, wheel(5, 2));
    expect(q.map((e) => e.deltaY)).toEqual([25, 5]);
  });

  it('never merges across a click or a key', () => {
    const q: any[] = [];
    enqueueInput(q, move(1));
    enqueueInput(q, { type: 'mouse', event: 'mousePressed', x: 1, y: 0 });
    enqueueInput(q, move(2));
    enqueueInput(q, { type: 'key', event: 'keyDown', key: 'a' });
    enqueueInput(q, { type: 'key', event: 'keyDown', key: 'a' });
    expect(q).toHaveLength(5);
  });
});

describe('displayUrl: the address bar at rest', () => {
  it('drops the scheme, www and a bare trailing slash', () => {
    expect(displayUrl('https://www.example.com/')).toBe('example.com');
    expect(displayUrl('https://shop.example.com/a/b?c=1')).toBe('shop.example.com/a/b?c=1');
    expect(displayUrl('http://localhost:4748/#/')).toBe('localhost:4748/#/');
    expect(displayUrl('about:blank')).toBe('');
  });
});
