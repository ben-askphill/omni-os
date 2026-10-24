import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserAnnotation } from '@omni/shared/message-context-browser.ts';
import type { MessageContext } from '@omni/shared/message-context.ts';
import { canAnnotate } from '../src/components/BrowserAnnotate.tsx';
import { ContextInspector } from '../src/message-context/ContextChips.tsx';
import { CONTEXT_VIEWS } from '../src/message-context/kinds.ts';
import { addDraftContext, draftContext, readStoredDrafts, removeDraftContext } from '../src/message-context/draft.ts';
import { readContexts } from '@omni/shared/message-context-kinds.ts';
import { ApiError } from '../src/api.ts';
import { PickedElementDetails } from '../src/message-context/picked-element.tsx';

// The Web UI's half of a browser_annotation: its view, the draft that keeps it across a reload, and when Annotate is on.
// Dragging and the capture round trip are driven in a real browser (the PR's screenshots), not here.

const corpus = JSON.parse(readFileSync(fixture('message-context.json'), 'utf8')) as { records: { name: string; raw: unknown }[] };
const record = corpus.records.find((r) => r.name === 'a browser annotation')!.raw as MessageContext<'browser_annotation', BrowserAnnotation>;

describe('the browser_annotation view', () => {
  const html = renderToStaticMarkup(createElement(ContextInspector, { reading: readContexts([record])[0] }));

  it('shows the screenshot from the thread uploads, with the marked area over it as fractions of the viewport', () => {
    expect(html).toContain(`src="/api/threads/${record.body.thread}/uploads/${record.body.image.name}"`);
    expect(html).toContain('aspect-ratio:2560 / 1426');
    // 320/1280, 96/713, 480/1280, 160/713
    expect(html).toContain('left:25%');
    expect(html).toContain('width:37.5%');
    expect(html).toMatch(/top:13\.46\d*%/);
    expect(html).toMatch(/height:22\.44\d*%/);
  });

  it('says what page it was, where, and at what size', () => {
    expect(html).toContain('shop.example.com/cart?coupon=SPRING');
    expect(html).toContain('Your cart · Example Shop');
    expect(html).toContain('Area 480×160 at 320, 96 · viewport 1280×713 at 2x · scrolled to 0, 240');
    expect(html).toContain("the total looks wrong here");
  });

  it('has an icon', () => {
    expect(CONTEXT_VIEWS.browser_annotation.icon).toBe('annotate');
  });
});

describe('a browser_annotation with a picked element', () => {
  const picked = (corpus as unknown as { parse: { name: string; expect: { records: MessageContext<'browser_annotation', BrowserAnnotation>[] } }[] }).parse.find((c) =>
    c.name.startsWith('a browser annotation with a picked element'),
  )!.expect.records[0];
  const html = renderToStaticMarkup(createElement(ContextInspector, { reading: readContexts([picked])[0] }));

  it('shows the tag and selector, and the text, as text', () => {
    expect(html).toContain('data-picked-element');
    expect(html).toContain('&lt;button&gt;');
    expect(html).toContain('#cart &gt; div.summary &gt; button.checkout');
  });

  it('opens on the details in the inspector, and keeps them behind Details beside the screenshot while picking', () => {
    expect(html).toContain('Parents, nearest first');
    expect(html).toContain('Hide details');
    const compact = renderToStaticMarkup(createElement(PickedElementDetails, { element: picked.body.element! }));
    expect(compact).not.toContain('Parents, nearest first');
    expect(compact).toContain('>Details<');
  });

  it('never renders the page\'s markup as markup', () => {
    const open = renderToStaticMarkup(createElement(PickedElementDetails, { element: { ...picked.body.element!, html: '<img src=x onerror=alert(1)>', text: '<b>bold</b>' }, defaultOpen: true }));
    expect(open).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(open).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(open).not.toContain('<img');
    expect(open).toContain('Parents, nearest first');
  });

  it('says a frame from another site cannot be read', () => {
    const frame = renderToStaticMarkup(createElement(PickedElementDetails, { element: { ...picked.body.element!, tag: 'iframe', opaque_frame: true } }));
    expect(frame).toContain('This is a frame from another site');
  });

  it('is absent from a record of an area', () => {
    expect(renderToStaticMarkup(createElement(ContextInspector, { reading: readContexts([record])[0] }))).not.toContain('data-picked-element');
  });
});

describe('when Annotate is on', () => {
  it('needs a running browser on a web page', () => {
    expect(canAnnotate({ running: true, url: 'https://shop.example.com/' })).toBe(true);
    expect(canAnnotate({ running: true, url: 'http://localhost:4748/#/' })).toBe(true);
    expect(canAnnotate({ running: true, url: 'about:blank' })).toBe(false);
    expect(canAnnotate({ running: true, url: '' })).toBe(false);
    expect(canAnnotate({ running: false, url: 'https://shop.example.com/' })).toBe(false);
    expect(canAnnotate(null)).toBe(false);
  });
});

describe('an api error', () => {
  it('keeps the response body, so a stale capture can say it is retryable', () => {
    const e = new ApiError('The page navigated', 409, { retryable: true, stale: 'navigated' });
    expect(e.body).toEqual({ retryable: true, stale: 'navigated' });
    expect(new ApiError('x', 500).body).toBeUndefined();
  });
});

describe('drafts kept across a reload', () => {
  const t = 'annotated-thread';
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const fake = () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    return data;
  };
  afterEach(() => {
    removeDraftContext(t, record.id);
    if (real) Object.defineProperty(globalThis, 'localStorage', real);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('writes the draft as it changes, and reads it back whole', () => {
    const data = fake();
    expect(addDraftContext(t, record)).toBeNull();
    const stored = data.get('omni.contextDrafts')!;
    expect(JSON.parse(stored)[t]).toEqual([record]);
    expect(readStoredDrafts(stored).get(t)).toEqual([record]);
    removeDraftContext(t, record.id);
    expect(data.has('omni.contextDrafts')).toBe(false);
  });

  it('drops what no longer parses, and anything that is not drafts, without throwing', () => {
    const bad = { ...record, body: { ...record.body, url: 'file:///etc/passwd' } };
    expect([...readStoredDrafts(JSON.stringify({ a: [record], b: [bad], c: 'x', d: [] })).keys()]).toEqual(['a']);
    for (const raw of [null, undefined, '', 'not json', '[]', '"x"', '{"a": 1}']) expect(readStoredDrafts(raw).size).toBe(0);
  });

  it('still keeps the draft when storage is blocked or full', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
      configurable: true,
    });
    expect(addDraftContext(t, record)).toBeNull();
    expect(draftContext(t)).toEqual([record]);
  });
});
