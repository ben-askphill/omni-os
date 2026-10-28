// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BrowserCapture, InspectedElement, PickedElement } from '@omni/shared/message-context-browser.ts';

vi.mock('../src/store.tsx', () => ({ useApp: () => ({ channels: [], crew: [], status: null }) }));

import { LiveAnnotateCard, LiveAnnotateOverlay, useLiveAnnotate } from '../src/components/BrowserAnnotationOverlay.tsx';
import type { Browser } from '../src/components/LiveBrowser.tsx';
import { NO_ELEMENT, dragRect, elementName, initialLiveAnnotate, liveAnnotateReducer, resolveSelection, styleRows } from '../src/components/browser-live-annotate.ts';
import { draftContext, settleDraftContext } from '../src/message-context/draft.ts';

// Live Annotate on the Web UI: the overlay over the live page (hover inspects and still reaches the page, a click picks,
// a drag marks an area, Option gives the page the pointer) and the card that sends what was picked. The server routes
// are fakes here; apps/server/tests/browser-pick-cdp.test.ts runs inspect and pick against a real Chrome.

const CAPTURE: BrowserCapture = {
  thread: 't1',
  url: 'https://shop.example.com/cart',
  title: 'Your cart',
  viewport: { width: 1000, height: 600, scale: 2 },
  scroll: { x: 0, y: 240 },
  captured_at: '2026-10-28T09:30:00.000Z',
  image: { name: 'annotation-3f9a1c7e5b2d4a60.png', mime: 'image/png', width: 2000, height: 1200, bytes: 41_000 },
};
const HOVERED: InspectedElement = {
  tag: 'button',
  id: 'go',
  classes: ['checkout', 'primary'],
  path: ['body', 'main#cart', 'div.summary', 'button#go'],
  bounds: { x: 380, y: 180, width: 120, height: 40 },
  size: { width: 120, height: 40 },
  styles: { display: 'inline-flex', color: 'rgb(255, 255, 255)', background_color: 'rgb(43, 59, 255)', font_family: '"Inter", sans-serif', font_size: '15px', font_weight: '600', z_index: 'auto' },
  opaque_frame: false,
};
const PICKED: PickedElement = {
  tag: 'button',
  selector: '#go',
  text: 'Check out',
  html: '<button id="go" class="checkout primary">Check out</button>',
  ancestors: ['<div class="summary">'],
  bounds: { x: 380, y: 180, width: 120, height: 40 },
  point: { x: 400, y: 200 },
  frames: [],
  opaque_frame: false,
  truncated: false,
  styles: { display: 'inline-flex', color: 'rgb(255, 255, 255)' },
};

describe('the live Annotate state', () => {
  const frame = { width: 1000, height: 600, scroll: { x: 0, y: 240 } };
  const select = (s = initialLiveAnnotate) => liveAnnotateReducer(s, { type: 'select', seq: s.seq + 1, kind: 'element', live: HOVERED.bounds, frame, point: { x: 400, y: 200 }, inspected: HOVERED });

  it('numbers each pick, and drops the answer for one that was replaced', () => {
    const one = select();
    const two = select(one);
    expect(two.selection?.seq).toBe(2);
    const late = liveAnnotateReducer(two, { type: 'captured', seq: 1, capture: CAPTURE, rect: HOVERED.bounds, element: PICKED, notice: null });
    expect(late).toBe(two);
    const ready = liveAnnotateReducer(two, { type: 'captured', seq: 2, capture: CAPTURE, rect: HOVERED.bounds, element: PICKED, notice: null });
    expect(ready.selection).toMatchObject({ status: 'ready', element: PICKED, capture: CAPTURE });
  });

  it('keeps the pick when sending fails, and clears it with a word when it goes', () => {
    const s = liveAnnotateReducer(select(), { type: 'busy', busy: 'sending' });
    const failed = liveAnnotateReducer(s, { type: 'error', error: 'offline' });
    expect(failed).toMatchObject({ busy: null, selection: { error: 'offline' } });
    expect(liveAnnotateReducer(s, { type: 'done', flash: 'Sent' })).toMatchObject({ selection: null, busy: null, flash: 'Sent' });
  });

  it('uses the page\'s answer for an element, and the box the inspector showed when there is none', () => {
    const sel = { kind: 'element' as const, live: HOVERED.bounds, frame };
    expect(resolveSelection(sel, CAPTURE, { element: PICKED })).toEqual({ ok: true, rect: PICKED.bounds, element: PICKED, notice: null });
    expect(resolveSelection(sel, CAPTURE, { unavailable: { reason: 'nothing', message: 'Nothing there.' } })).toEqual({ ok: true, rect: HOVERED.bounds, element: null, notice: 'Nothing there.' });
    expect(resolveSelection(sel, CAPTURE, null)).toMatchObject({ ok: true, notice: NO_ELEMENT });
  });

  it('moves an area onto a screenshot taken after the page scrolled, and refuses one scrolled away', () => {
    const area = { kind: 'area' as const, live: { x: 100, y: 100, width: 300, height: 200 }, frame };
    expect(resolveSelection(area, { ...CAPTURE, scroll: { x: 0, y: 340 } }, null)).toEqual({ ok: true, rect: { x: 100, y: 0, width: 300, height: 200 }, element: null, notice: null });
    expect(resolveSelection(area, { ...CAPTURE, scroll: { x: 0, y: 900 } }, null)).toEqual({ ok: false, error: 'Draw a larger area.' });
  });

  it('turns a drag into a rectangle either way round, and nothing below the smallest area', () => {
    expect(dragRect({ x: 300, y: 200 }, { x: 100, y: 50 }, 8)).toEqual({ x: 100, y: 50, width: 200, height: 150 });
    expect(dragRect({ x: 10, y: 10 }, { x: 15, y: 100 }, 8)).toBeNull();
  });

  it('names an element as a selector and lists only the styles that say something', () => {
    expect(elementName(HOVERED)).toBe('button#go.checkout.primary');
    expect(styleRows(HOVERED.styles)).toEqual([
      { label: 'Color', value: 'rgb(255, 255, 255)', swatch: 'rgb(255, 255, 255)' },
      { label: 'Background', value: 'rgb(43, 59, 255)', swatch: 'rgb(43, 59, 255)' },
      { label: 'Font', value: '15px / 600 · Inter' },
      { label: 'Display', value: 'inline-flex' },
    ]);
    expect(styleRows({ background_color: 'rgba(0, 0, 0, 0)', padding: '0px', z_index: '3' })).toEqual([{ label: 'Z-index', value: '3' }]);
  });
});

// ---------- the overlay and its card, against fake routes ----------

let root: Root;
let host: HTMLDivElement;
let page: HTMLDivElement;
let calls: { method: string; url: string; body: unknown }[];
let input: ReturnType<typeof vi.fn>;
let failSend: boolean;
let onDone: ReturnType<typeof vi.fn<() => void>>;

function fakeBrowser(): Browser {
  const listeners = new Set<() => void>();
  return {
    state: { running: true, url: CAPTURE.url, title: 'Your cart', loading: false, canBack: false, canForward: false, tabs: [], active: 'tab' },
    hasFrame: true,
    frame: { current: { bitmap: {} as ImageBitmap, width: 1000, height: 600, scroll: { x: 0, y: 240 } } },
    draw: { current: null },
    error: null,
    input,
    action: vi.fn(),
    restart: vi.fn(),
    copy: vi.fn(),
    opened: 1,
    scroll: { listeners, subscribe: (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn)) },
  } as unknown as Browser;
}

function Harness({ b }: { b: Browser }) {
  const box = useRef<HTMLDivElement>(page);
  const live = useLiveAnnotate(b, 'c1', 't1');
  return createElement('div', null, createElement(LiveAnnotateOverlay, { b, box, live, drive: true }), createElement(LiveAnnotateCard, { live, threadId: 't1', onDone, onDraw: () => {} }));
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.setPointerCapture = vi.fn();
  calls = [];
  input = vi.fn();
  failSend = false;
  onDone = vi.fn<() => void>();
  settleDraftContext('t1', draftContext('t1').map((r) => r.id));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ method, url, body });
      if (url === '/api/channels/c1/browser/inspect') return Response.json({ element: HOVERED });
      if (url === '/api/channels/c1/browser/capture' && method === 'POST') return Response.json({ capture: CAPTURE });
      if (url.endsWith('/element')) return Response.json({ element: PICKED });
      if (method === 'DELETE') return Response.json({ removed: true });
      if (url === '/api/threads/t1/messages') return failSend ? Response.json({ error: 'The thread is gone.' }, { status: 404 }) : Response.json({ id: 't1' });
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
  // The page's box: 500 CSS pixels wide for a 1000-pixel frame, so the panel shows the page at half size.
  page = document.createElement('div');
  Object.defineProperty(page, 'clientWidth', { value: 500 });
  Object.defineProperty(page, 'clientHeight', { value: 300 });
  page.focus = vi.fn();
  document.body.append(page);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Harness, { b: fakeBrowser() })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  page.remove();
  vi.unstubAllGlobals();
});

const layer = () => host.querySelector<HTMLDivElement>('[data-live-annotate]')!;
const pointer = async (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
  act(async () => {
    layer().dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse', button: 0, pointerId: 1, ...extra }));
    await new Promise((r) => setTimeout(r, 0));
  });
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));
/** Waits for the pick's screenshot and the page's answer to land. */
const picked = async () => {
  for (let i = 0; i < 50 && !card()?.querySelector('textarea, img'); i++) await settle();
  for (let i = 0; i < 50 && card()?.textContent?.includes('Taking the screenshot'); i++) await settle();
};
const card = () => host.querySelector('[data-live-annotate-card]');
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name)!;

describe('the live Annotate overlay', () => {
  it('passes a hover to the page at its own pixels, and shows what is under the pointer', async () => {
    await pointer('pointermove', 200, 100);
    await settle();
    expect(input).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouse', event: 'mouseMoved', x: 400, y: 200, buttons: 0 }));
    expect(calls.find((c) => c.url.endsWith('/inspect'))?.body).toEqual({ x: 400, y: 200 });
    const tip = host.querySelector('[data-element-inspector]')!.textContent!;
    expect(tip).toContain('button#go.checkout.primary');
    expect(tip).toContain('120 × 40');
    expect(tip).toContain('body › main#cart › div.summary › button#go');
    expect(tip).toContain('rgb(43, 59, 255)');
    expect(host.querySelector<HTMLElement>('[data-live-hover]')!.style.left).toBe('190px');
  });

  it('picks on a click: screenshots the page and asks it about that spot, and never clicks the page', async () => {
    await pointer('pointermove', 200, 100);
    await settle();
    await pointer('pointerdown', 200, 100);
    await pointer('pointerup', 200, 100);
    await picked();
    expect(input.mock.calls.every(([e]) => e.event === 'mouseMoved')).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain(`POST /api/channels/c1/browser/capture/${CAPTURE.image.name}/element`);
    expect(calls.find((c) => c.url.endsWith('/element'))?.body).toEqual({ thread: 't1', x: 400, y: 200 });
    expect(card()!.textContent).toContain('<button>');
    expect(card()!.textContent).toContain('#go');
    expect(host.querySelector('[data-live-selection]')).toBeTruthy();
  });

  it('marks an area on a drag, with no element', async () => {
    await pointer('pointerdown', 50, 50);
    await pointer('pointermove', 120, 90);
    await pointer('pointerup', 200, 150);
    await picked();
    expect(calls.some((c) => c.url.endsWith('/element'))).toBe(false);
    expect(card()!.textContent).toContain('Area 300×200');
  });

  it('steps aside while Option is held, so a click reaches the page', async () => {
    expect(layer().className).not.toContain('pointer-events-none');
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' })));
    expect(layer().className).toContain('pointer-events-none');
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' })));
    expect(layer().className).not.toContain('pointer-events-none');
  });

  it('sends the pick to the thread: the words as the message, the annotation as its context', async () => {
    await pointer('pointerdown', 200, 100);
    await pointer('pointerup', 200, 100);
    await picked();
    const note = card()!.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Make this full width');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Send').click());
    await settle();
    const sent = calls.find((c) => c.url === '/api/threads/t1/messages')!.body as { prompt: string; context: { kind: string; note: string; body: { rect: unknown; element: PickedElement } }[] };
    expect(sent.prompt).toBe('Make this full width');
    expect(sent.context).toHaveLength(1);
    expect(sent.context[0]).toMatchObject({ kind: 'browser_annotation', note: '', body: { rect: PICKED.bounds, element: { selector: '#go', styles: PICKED.styles } } });
    expect(card()).toBeNull();
    expect(host.querySelector('[data-live-annotate-hint]')!.textContent).toContain('Sent');
    // The screenshot is the message's now.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('keeps the pick and says why when the send fails', async () => {
    failSend = true;
    await pointer('pointerdown', 200, 100);
    await pointer('pointerup', 200, 100);
    await picked();
    await act(async () => button('Send').click());
    await settle();
    expect(card()!.textContent).toContain('The thread is gone.');
    expect(button('Send').disabled).toBe(false);
  });

  it('adds it to the next message with the note instead, when asked', async () => {
    await pointer('pointerdown', 200, 100);
    await pointer('pointerup', 200, 100);
    await picked();
    await act(async () => button('Add to message').click());
    expect(draftContext('t1')).toEqual([expect.objectContaining({ kind: 'browser_annotation', label: 'Browser, <button> on shop.example.com/cart' })]);
    expect(calls.some((c) => c.url === '/api/threads/t1/messages')).toBe(false);
  });

  it('deletes the screenshot of a pick that is cleared, and Escape clears it, then turns Annotate off', async () => {
    await pointer('pointerdown', 200, 100);
    await pointer('pointerup', 200, 100);
    await picked();
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await settle();
    expect(card()).toBeNull();
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([`/api/channels/c1/browser/capture/${CAPTURE.image.name}?thread=t1`]);
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onDone).toHaveBeenCalledOnce();
  });
});
