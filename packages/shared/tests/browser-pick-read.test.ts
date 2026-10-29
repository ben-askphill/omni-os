import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import { elementFrom, inspectReply, inspectedFrom, pickReply } from '../browser-pick-read.ts';
import { inspectScript, pickScript, type RawInspect, type RawPick } from '../browser-pick-script.ts';
import { ELEMENT_STYLE_KEYS, annotate, type BrowserCapture } from '../message-context-browser.ts';

// What is made of the page scripts' answers, which both browsers read here: the server for the channel's Chrome, the Mac
// app for its Web tab (through JavaScriptCore). packages/test-fixtures/browser-pick.json holds answers and the replies
// they must give; apps/mac/OmniKit's BrowserPickEngineTests read the same file, so the two browsers cannot drift.

interface Corpus {
  point: { x: number; y: number };
  viewport: { width: number; height: number };
  picks: { name: string; raw: unknown; reply: unknown }[];
  inspects: { name: string; raw: unknown; reply: unknown }[];
}
const CORPUS = JSON.parse(readFileSync(fixture('browser-pick.json'), 'utf8')) as Corpus;
const { point: POINT, viewport: VIEWPORT } = CORPUS;
const BUTTON = CORPUS.picks[0].raw as RawPick;
const HOVER = CORPUS.inspects[0].raw as RawInspect;
const PAGE = { url: 'https://shop.example.com/cart' };

describe('the corpus both browsers read', () => {
  for (const c of CORPUS.picks) it(`pick: ${c.name}`, () => expect(pickReply(c.raw as RawPick, POINT, VIEWPORT)).toEqual(c.reply));
  for (const c of CORPUS.inspects) it(`inspect: ${c.name}`, () => expect(inspectReply(c.raw as RawInspect)).toEqual(c.reply));
});

describe('the page scripts', () => {
  it('read the point they are made for, as one expression', () => {
    for (const script of [pickScript(400.4, 150.6), inspectScript(400.4, 150.6)]) {
      expect(script).toContain('const x = 400, y = 151;');
      expect(script.startsWith('(() => {')).toBe(true);
      expect(script.endsWith('})()')).toBe(true);
    }
  });

  it('read every computed style a record keeps, by its CSS name', () => {
    for (const key of ELEMENT_STYLE_KEYS) expect(inspectScript(0, 0)).toContain(`["${key}","${key.replaceAll('_', '-')}"]`);
  });
});

describe('elementFrom', () => {
  it('makes a record element: whole pixels outward inside the viewport, and a record the route accepts', () => {
    const e = elementFrom(BUTTON, POINT, VIEWPORT)!;
    expect(e).toMatchObject({ tag: 'button', bounds: { x: 320, y: 96, width: 481, height: 160 }, point: POINT, opaque_frame: false, truncated: false });
    const base = { thread: 't', url: PAGE.url, title: '', viewport: { ...VIEWPORT, scale: 2 }, scroll: { x: 0, y: 0 }, captured_at: '2026-10-24T09:30:15.250Z', image: { name: 'annotation-0123456789abcdef.png', mime: 'image/png' as const, width: 2560, height: 1426, bytes: 64 } };
    expect(annotate(base as BrowserCapture, { x: 320, y: 96, width: 481, height: 160 }, e).ok).toBe(true);
  });

  it('clips a box that runs past the viewport, and refuses one that is not in it', () => {
    const big = elementFrom({ ...BUTTON, bounds: { x: -50, y: -20, width: 5000, height: 5000 } }, POINT, VIEWPORT)!;
    expect(big.bounds).toEqual({ x: 0, y: 0, width: 1280, height: 713 });
    expect(elementFrom({ ...BUTTON, bounds: { x: 2000, y: 0, width: 10, height: 10 } }, POINT, VIEWPORT)).toBeNull();
    expect(elementFrom({ ...BUTTON, bounds: { x: 0, y: 0, width: 0, height: 0 } }, POINT, VIEWPORT)).toBeNull();
    expect(elementFrom({ ...BUTTON, bounds: { x: NaN, y: 0, width: 10, height: 10 } }, POINT, VIEWPORT)).toBeNull();
  });

  it('cuts a page that answers with the whole DOM to the record limits, marking it cut', () => {
    const dump: RawPick = {
      ...BUTTON,
      tag: 'body',
      selector: 'html > body > div'.repeat(500),
      text: 'lorem ipsum '.repeat(100_000),
      html: '<div>'.repeat(200_000),
      ancestors: Array.from({ length: 100 }, (_, i) => `<div class="level-${i}">`.repeat(40)),
      frames: Array.from({ length: 50 }, (_, i) => `https://f${i}.example.com/${'a'.repeat(2000)}`),
    };
    const e = elementFrom(dump, POINT, VIEWPORT)!;
    expect(e).not.toBeNull();
    expect([...e.text]).toHaveLength(600);
    expect([...e.html]).toHaveLength(2000);
    expect([...e.selector].length).toBeLessThanOrEqual(300);
    expect(e.ancestors).toHaveLength(4);
    expect(e.ancestors.every((a) => [...a].length <= 160)).toBe(true);
    expect(e.frames).toHaveLength(3);
    expect(e.frames.every((f) => [...f].length <= 512)).toBe(true);
    expect(e.truncated).toBe(true);
    expect(JSON.stringify(e).length).toBeLessThan(6_500);
  });

  it('drops control characters and collapses whitespace, so a record accepts the page text', () => {
    const e = elementFrom({ ...BUTTON, text: 'Total\u001b[2J\n\n  €48‮,50\t', html: '<p>\nTotal\u0000</p>' }, POINT, VIEWPORT)!;
    expect(e.text).toBe('Total [2J €48 ,50');
    expect(e.html).toBe('<p> Total </p>');
  });

  it('gives no element for an answer that is not one', () => {
    for (const raw of [null, { ok: false, reason: 'nothing' }, { ok: true }, { ...BUTTON, tag: '' }, { ...BUTTON, tag: 'Button onclick=' }, { ...BUTTON, html: '' }, { ...BUTTON, bounds: 'x' }, { ...BUTTON, selector: 5 }] as unknown as RawPick[])
      expect(elementFrom(raw, POINT, VIEWPORT)).toBeNull();
    // The page is not asked to be well formed past what a record needs.
    expect(elementFrom({ ...BUTTON, text: undefined, ancestors: 'x', frames: undefined, truncated: 'yes' }, POINT, VIEWPORT)).toMatchObject({ text: '', ancestors: [], frames: [], truncated: false });
  });
});

describe('the computed styles on a pick', () => {
  it('keeps the known ones, cleaned, cut and in the record\'s order', () => {
    const e = elementFrom({ ...BUTTON, styles: { z_index: 'auto', cursor: 'pointer', font_family: `"Inter",\n${'x'.repeat(300)}`, display: 'block', color: '' } }, POINT, VIEWPORT)!;
    expect(Object.keys(e.styles!)).toEqual(['display', 'font_family', 'z_index']);
    const family = e.styles!.font_family!;
    expect(family).toHaveLength(120);
    expect(family.startsWith('"Inter", xxx')).toBe(true);
    expect(family.endsWith('…')).toBe(true);
  });

  it('leaves them out when the page gave none, so a record from before them is the same bytes', () => {
    expect(elementFrom({ ...BUTTON, styles: undefined }, POINT, VIEWPORT)).not.toHaveProperty('styles');
    expect(elementFrom({ ...BUTTON, styles: 'red' }, POINT, VIEWPORT)).not.toHaveProperty('styles');
  });
});

describe('inspectedFrom', () => {
  it('clips the box to the viewport the page reported and keeps the element\'s own size', () => {
    const e = inspectedFrom(HOVER)!;
    expect(e).toEqual({
      tag: 'button',
      id: 'go',
      classes: ['checkout', 'primary'],
      path: ['body', 'main#cart', 'div.summary', 'button#go'],
      bounds: { x: 1200, y: 96, width: 80, height: 160 },
      size: { width: 480, height: 160 },
      styles: { display: 'inline-flex', color: 'rgb(255, 255, 255)' },
      opaque_frame: false,
    });
  });

  it('bounds every string and list a page could make huge', () => {
    const e = inspectedFrom({ ...HOVER, id: 'i'.repeat(500), classes: Array.from({ length: 40 }, (_, i) => `c${i}\u0007`), path: Array.from({ length: 40 }, () => 'div.'.repeat(80)) })!;
    expect(e.id).toHaveLength(100);
    expect(e.classes).toHaveLength(6);
    expect(e.classes.every((c) => !c.includes('\u0007'))).toBe(true);
    expect(e.path).toHaveLength(8);
    expect(e.path.every((p) => [...p].length <= 80)).toBe(true);
  });

  it('gives nothing for an answer that is not an element, or one off the page', () => {
    expect(inspectedFrom(null)).toBeNull();
    expect(inspectedFrom({ ...HOVER, ok: false })).toBeNull();
    expect(inspectedFrom({ ...HOVER, viewport: undefined })).toBeNull();
    expect(inspectedFrom({ ...HOVER, tag: '<img onerror=x>' })).toBeNull();
    expect(inspectedFrom({ ...HOVER, bounds: { x: 2000, y: 0, width: 10, height: 10 } })).toBeNull();
  });
});
