import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { annotate, type BrowserCapture, type ElementPick, type PickedElement } from '@omni/shared/message-context-browser.ts';
import { startRunner } from './runner-boot.ts';
import { macFixture } from './fixture-shape.ts';
import type { PageObservation } from '../browser.ts';
import type { RawPick } from '../browser-pick-script.ts';
import type { PickSource } from '../browser-pick.ts';

// Picking an element on a captured page: what the server makes of what the page says, which page it will answer for,
// and the route. Chrome is a fake that answers observe, shot and pick, so each case sets exactly what the page does. The
// real page script runs in a real Chrome in browser-pick-cdp.test.ts.

process.env.SHELL = '/bin/sh';
let H: Awaited<ReturnType<typeof startRunner>>;
let pick: typeof import('../browser-pick.ts');
let cap: typeof import('../browser-capture.ts');
const T = { timeout: 30_000 };

beforeAll(async () => {
  H = await startRunner();
  pick = await import('../browser-pick.ts');
  cap = await import('../browser-capture.ts');
  const dir = mkdtempSync(join(tmpdir(), 'omni-pick-'));
  H.db.channels.create({ id: 'picks', name: 'Picks', kind: 'internal', use_worktree: 0, repo_path: dir, base_dir: dir });
  H.db.channels.create({ id: 'elsewhere', name: 'Elsewhere', kind: 'internal', use_worktree: 0, repo_path: dir, base_dir: dir });
});

const png = (width: number, height: number) => {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
};

const PAGE: PageObservation = {
  tab: 'tab-1',
  url: 'https://shop.example.com/cart',
  title: 'Your cart',
  navigations: 3,
  viewport: { width: 1280, height: 713 },
  scroll: { x: 0, y: 240 },
};

/** What the page script answers for a button in the cart. */
const BUTTON: RawPick = {
  ok: true,
  tag: 'button',
  selector: '#cart > div.summary > button.checkout',
  text: 'Check out · €48,50',
  html: '<button id="go" class="checkout" type="submit">Check out · €48,50</button>',
  ancestors: ['<div class="summary">', '<main id="cart">'],
  bounds: { x: 320.4, y: 96.2, width: 479.8, height: 159.5 },
  frames: [],
  opaque: false,
  truncated: false,
};

type Fake = PickSource & { page: PageObservation; answer: RawPick | null; asked: { x: number; y: number }[]; during?: (p: PageObservation) => void; fail?: boolean };
function fakeBrowser(over: { running?: boolean; answer?: RawPick | null; during?: (p: PageObservation) => void } = {}): Fake {
  const page: PageObservation = { ...PAGE, viewport: { ...PAGE.viewport }, scroll: { ...PAGE.scroll } };
  const src: Fake = {
    page,
    answer: over.answer === undefined ? BUTTON : over.answer,
    asked: [],
    during: over.during,
    running: over.running ?? true,
    observe: async () => ({ ...page, viewport: { ...page.viewport }, scroll: { ...page.scroll } }),
    shot: async () => png(2560, 1426),
    pick: async (x, y) => {
      src.asked.push({ x, y });
      if (src.fail) throw new Error('Runtime.evaluate timed out');
      src.during?.(page);
      return src.answer;
    },
  };
  return src;
}

const newThread = async (channel = 'picks') => {
  const t = await H.runner.createThread({ channel, prompt: 'CMD hi' });
  await H.untilResults(t.id, 1);
  return t;
};
/** A capture of the fake's page, remembered the way the capture route remembers it. */
async function captured(src: Fake, threadId: string) {
  const r = await cap.captureAnnotation(src, threadId);
  if (!r.ok) throw new Error(r.error);
  pick.remember(threadId, r.capture.image.name, r.page);
  return r.capture;
}
const POINT = { x: 400, y: 150 };
const VIEWPORT = { width: 1280, height: 713 };
const asElement = (r: ElementPick | 'bad_point') => {
  if (r === 'bad_point' || !('element' in r)) throw new Error(`no element: ${JSON.stringify(r)}`);
  return r.element;
};

describe('elementFrom', () => {
  it('makes a record element: whole pixels outward inside the viewport, and a record the route accepts', () => {
    const e = pick.elementFrom(BUTTON, POINT, VIEWPORT)!;
    expect(e).toMatchObject({ tag: 'button', bounds: { x: 320, y: 96, width: 481, height: 160 }, point: POINT, opaque_frame: false, truncated: false });
    const base = { thread: 't', url: PAGE.url, title: '', viewport: { ...VIEWPORT, scale: 2 }, scroll: { x: 0, y: 0 }, captured_at: '2026-10-24T09:30:15.250Z', image: { name: 'annotation-0123456789abcdef.png', mime: 'image/png' as const, width: 2560, height: 1426, bytes: 64 } };
    expect(annotate(base as BrowserCapture, { x: 320, y: 96, width: 481, height: 160 }, e).ok).toBe(true);
  });

  it('clips a box that runs past the viewport, and refuses one that is not in it', () => {
    const big = pick.elementFrom({ ...BUTTON, bounds: { x: -50, y: -20, width: 5000, height: 5000 } }, POINT, VIEWPORT)!;
    expect(big.bounds).toEqual({ x: 0, y: 0, width: 1280, height: 713 });
    expect(pick.elementFrom({ ...BUTTON, bounds: { x: 2000, y: 0, width: 10, height: 10 } }, POINT, VIEWPORT)).toBeNull();
    expect(pick.elementFrom({ ...BUTTON, bounds: { x: 0, y: 0, width: 0, height: 0 } }, POINT, VIEWPORT)).toBeNull();
    expect(pick.elementFrom({ ...BUTTON, bounds: { x: NaN, y: 0, width: 10, height: 10 } }, POINT, VIEWPORT)).toBeNull();
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
    const e = pick.elementFrom(dump, POINT, VIEWPORT)!;
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
    const e = pick.elementFrom({ ...BUTTON, text: 'Total\u001b[2J\n\n  €48‮,50\t', html: '<p>\nTotal\u0000</p>' }, POINT, VIEWPORT)!;
    expect(e.text).toBe('Total [2J €48 ,50');
    expect(e.html).toBe('<p> Total </p>');
  });

  it('gives no element for an answer that is not one', () => {
    for (const raw of [null, { ok: false, reason: 'nothing' }, { ok: true }, { ...BUTTON, tag: '' }, { ...BUTTON, tag: 'Button onclick=' }, { ...BUTTON, html: '' }, { ...BUTTON, bounds: 'x' }, { ...BUTTON, selector: 5 }] as unknown as RawPick[])
      expect(pick.elementFrom(raw, POINT, VIEWPORT)).toBeNull();
    // The page is not asked to be well formed past what a record needs.
    expect(pick.elementFrom({ ...BUTTON, text: undefined, ancestors: 'x', frames: undefined, truncated: 'yes' }, POINT, VIEWPORT)).toMatchObject({ text: '', ancestors: [], frames: [], truncated: false });
  });
});

describe('pickElement', () => {
  it('answers with the element at the point of the page the screenshot was taken of', T, async () => {
    const t = await newThread();
    const src = fakeBrowser();
    const c = await captured(src, t.id);
    const r = await pick.pickElement(src, t.id, c.image.name, POINT);
    expect(asElement(r)).toMatchObject({ tag: 'button', selector: '#cart > div.summary > button.checkout', point: POINT });
    expect(src.asked).toEqual([POINT]);
  });

  it('does not know a screenshot it did not take, or one for another thread', T, async () => {
    const t = await newThread();
    const other = await newThread();
    const src = fakeBrowser();
    const c = await captured(src, t.id);
    expect(await pick.pickElement(src, t.id, 'annotation-0123456789abcdef.png', POINT)).toMatchObject({ unavailable: { reason: 'unknown_capture' } });
    expect(await pick.pickElement(src, other.id, c.image.name, POINT)).toMatchObject({ unavailable: { reason: 'unknown_capture' } });
    expect(src.asked).toEqual([]);
  });

  it('forgets a screenshot that was discarded, and one that is old', T, async () => {
    const t = await newThread();
    const src = fakeBrowser();
    const c = await captured(src, t.id);
    pick.forget(t.id, c.image.name);
    expect(await pick.pickElement(src, t.id, c.image.name, POINT)).toMatchObject({ unavailable: { reason: 'unknown_capture' } });
    const r = await cap.captureAnnotation(src, t.id);
    if (!r.ok) throw new Error(r.error);
    pick.remember(t.id, r.capture.image.name, r.page, Date.now() - 31 * 60_000);
    pick.remember(t.id, 'annotation-aaaaaaaaaaaaaaaa.png', r.page);
    expect(await pick.pickElement(src, t.id, r.capture.image.name, POINT)).toMatchObject({ unavailable: { reason: 'unknown_capture' } });
  });

  const moved: [string, (p: PageObservation) => void, RegExp][] = [
    ['navigates', (p) => void p.navigations++, /navigated/],
    ['changes address within the page', (p) => void (p.url += '#reviews'), /navigated/],
    ['switches tabs', (p) => void (p.tab = 'tab-2'), /switched tabs/],
    ['is resized', (p) => void (p.viewport = { width: 390, height: 700 }), /resized/],
    ['scrolls', (p) => void (p.scroll.y += 300), /scrolled/],
  ];
  it.each(moved)('is unavailable, and does not ask the page, when it %s after the screenshot', T, async (_, change, words) => {
    const t = await newThread();
    const src = fakeBrowser();
    const c = await captured(src, t.id);
    change(src.page);
    const r = await pick.pickElement(src, t.id, c.image.name, POINT);
    expect(r).toMatchObject({ unavailable: { reason: 'stale', message: expect.stringMatching(words) } });
    expect(src.asked).toEqual([]);
  });

  it.each(moved)('is unavailable when it %s while the page is being asked: a navigation race', T, async (_, change, words) => {
    const t = await newThread();
    const src = fakeBrowser();
    const c = await captured(src, t.id);
    src.during = change;
    const r = await pick.pickElement(src, t.id, c.image.name, POINT);
    expect(r).toMatchObject({ unavailable: { reason: 'stale', message: expect.stringMatching(words) } });
    expect(JSON.stringify(r)).not.toContain('button');
  });

  it('says the screenshot and the area still go, in every unavailable answer', T, async () => {
    const t = await newThread();
    const src = fakeBrowser();
    const c = await captured(src, t.id);
    src.answer = { ok: false, reason: 'nothing' };
    const r = await pick.pickElement(src, t.id, c.image.name, POINT);
    expect(r).toMatchObject({ unavailable: { reason: 'nothing', message: expect.stringMatching(/screenshot and the area you mark still go with your message/) } });
  });

  it('is unavailable, not an error, when the browser throws, answers nonsense or is not running', T, async () => {
    const t = await newThread();
    const src = fakeBrowser();
    const c = await captured(src, t.id);
    src.fail = true;
    expect(await pick.pickElement(src, t.id, c.image.name, POINT)).toMatchObject({ unavailable: { reason: 'unreadable' } });
    src.fail = false;
    src.answer = { ok: true, tag: 'x' };
    expect(await pick.pickElement(src, t.id, c.image.name, POINT)).toMatchObject({ unavailable: { reason: 'unreadable' } });
    src.answer = null;
    expect(await pick.pickElement(src, t.id, c.image.name, POINT)).toMatchObject({ unavailable: { reason: 'unreadable' } });
    (src as { running: boolean }).running = false;
    expect(await pick.pickElement(src, t.id, c.image.name, POINT)).toMatchObject({ unavailable: { reason: 'stale' } });
  });

  it('refuses a point outside the screenshot without asking the page', T, async () => {
    const t = await newThread();
    const src = fakeBrowser();
    const c = await captured(src, t.id);
    for (const p of [{ x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1280, y: 10 }, { x: 10, y: 713 }]) expect(await pick.pickElement(src, t.id, c.image.name, p)).toBe('bad_point');
    expect(src.asked).toEqual([]);
  });

  it('answers for a frame from another site with the frame element itself', T, async () => {
    const t = await newThread();
    const src = fakeBrowser({ answer: { ...BUTTON, tag: 'iframe', text: '', selector: '#pay-frame', html: '<iframe id="pay-frame" src="https://pay.example.com/card">', opaque: true } });
    const c = await captured(src, t.id);
    const e = asElement(await pick.pickElement(src, t.id, c.image.name, POINT));
    expect(e).toMatchObject({ tag: 'iframe', opaque_frame: true, text: '' });
  });
});

describe('the pick route', () => {
  const mount = (src: Fake) => new Hono().route('/api/channels', pick.pickApi(() => src)).route('/api/channels', cap.captureApi(() => src, { captured: pick.remember, discarded: pick.forget }));
  const post = (app: Hono, channel: string, name: string, body: unknown) =>
    app.request(`/api/channels/${channel}/browser/capture/${name}/element`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const capture = async (app: Hono, thread: string) =>
    ((await (await app.request('/api/channels/picks/browser/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ thread }) })).json()) as { capture: BrowserCapture }).capture;

  it('answers with the element after a capture of the same route', T, async () => {
    const t = await newThread();
    const app = mount(fakeBrowser());
    const c = await capture(app, t.id);
    const res = await post(app, 'picks', c.image.name, { thread: t.id, ...POINT });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { element: PickedElement };
    // The Mac app decodes this (OmniKit's ElementPickReply): the same keys and types as its recorded fixture.
    macFixture('browser-pick-element.json', body);
    expect(body.element).toMatchObject({ tag: 'button', point: POINT });
  });

  it('answers 200 with why there is none, for the Mac app to read', T, async () => {
    const t = await newThread();
    const src = fakeBrowser();
    const app = mount(src);
    const c = await capture(app, t.id);
    src.page.navigations++;
    const res = await post(app, 'picks', c.image.name, { thread: t.id, ...POINT });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ unavailable: { reason: 'stale' } });
    macFixture('browser-pick-unavailable.json', body);
  });

  it('refuses a thread of another channel, an unknown thread and a point that is not whole pixels', T, async () => {
    const t = await newThread('elsewhere');
    const mine = await newThread();
    const app = mount(fakeBrowser());
    const c = await capture(app, mine.id);
    expect((await post(app, 'picks', c.image.name, { thread: t.id, ...POINT })).status).toBe(400);
    expect((await post(app, 'picks', c.image.name, { thread: 'nope', ...POINT })).status).toBe(404);
    expect((await post(app, 'picks', c.image.name, { thread: mine.id, x: 1.5, y: 3 })).status).toBeGreaterThanOrEqual(400);
    expect((await post(app, 'picks', c.image.name, { thread: mine.id, x: 5000, y: 3 })).status).toBe(400);
  });

  it('forgets a capture when the client discards it', T, async () => {
    const t = await newThread();
    const app = mount(fakeBrowser());
    const c = await capture(app, t.id);
    await app.request(`/api/channels/picks/browser/capture/${c.image.name}?thread=${t.id}`, { method: 'DELETE' });
    const res = await post(app, 'picks', c.image.name, { thread: t.id, ...POINT });
    expect(await res.json()).toMatchObject({ unavailable: { reason: 'unknown_capture' } });
  });
});

describe('the native pick routes', () => {
  const app = () => new Hono().route('/api/channels', pick.pickApi(() => fakeBrowser()));
  const native = (a: Hono, name: string, body: unknown) =>
    a.request(`/api/channels/picks/browser/capture/${name}/element/native`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('hands out the page script for a point, the very one the server runs in its own Chrome', T, async () => {
    const res = await app().request('/api/channels/picks/browser/pick-script?x=400&y=150');
    expect(res.status).toBe(200);
    const { script } = (await res.json()) as { script: string };
    expect(script).toContain('const x = 400, y = 150;');
    expect((await app().request('/api/channels/picks/browser/pick-script?x=1.5&y=2')).status).toBe(400);
  });

  it('bounds and checks what the Mac\'s page answered, as it does for the server\'s browser', T, async () => {
    const t = await newThread();
    const res = await native(app(), 'annotation-0123456789abcdef.png', { thread: t.id, ...POINT, viewport: VIEWPORT, raw: BUTTON });
    expect(res.status).toBe(200);
    expect(asElement((await res.json()) as ElementPick)).toMatchObject({ tag: 'button', bounds: { x: 320, y: 96, width: 481, height: 160 }, point: POINT });
  });

  it('says why when the page gave nothing usable, and refuses a thread of another channel or a point off the screenshot', T, async () => {
    const t = await newThread();
    const a = app();
    expect(await (await native(a, 'x', { thread: t.id, ...POINT, viewport: VIEWPORT, raw: { ok: false, reason: 'nothing' } })).json()).toMatchObject({ unavailable: { reason: 'nothing' } });
    expect(await (await native(a, 'x', { thread: t.id, ...POINT, viewport: VIEWPORT, raw: 'not a pick' })).json()).toMatchObject({ unavailable: { reason: 'unreadable' } });
    const other = await newThread('elsewhere');
    expect((await native(a, 'x', { thread: other.id, ...POINT, viewport: VIEWPORT, raw: BUTTON })).status).toBe(400);
    expect((await native(a, 'x', { thread: t.id, x: 5000, y: 3, viewport: VIEWPORT, raw: BUTTON })).status).toBe(400);
  });
});
