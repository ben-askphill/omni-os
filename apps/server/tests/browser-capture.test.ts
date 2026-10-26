import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { annotate, browserAnnotation, type BrowserAnnotation, type BrowserCapture } from '@omni/shared/message-context-browser.ts';
import { newContext } from '@omni/shared/message-context.ts';
import { startRunner } from './runner-boot.ts';
import { macFixture } from './fixture-shape.ts';
import type { PageObservation } from '../browser.ts';
import type { CaptureSource, StaleReason } from '../browser-capture.ts';

// The screenshot behind a browser_annotation: scale conversion, a page that moves while it is captured, image limits and
// the routes. Chrome is a fake that answers observe and shot, so each case sets exactly what the page does.

process.env.SHELL = '/bin/sh';
let H: Awaited<ReturnType<typeof startRunner>>;
let cap: typeof import('../browser-capture.ts');
let uploadsDir: (id: string) => string;
let MAX_INLINE_IMAGE: number;
const T = { timeout: 30_000 };

beforeAll(async () => {
  H = await startRunner();
  cap = await import('../browser-capture.ts');
  ({ uploadsDir } = await import('../config.ts'));
  ({ MAX_INLINE_IMAGE } = await import('../uploads.ts'));
  const dir = mkdtempSync(join(tmpdir(), 'omni-capture-'));
  H.db.channels.create({ id: 'shots', name: 'Shots', kind: 'internal', use_worktree: 0, repo_path: dir, base_dir: dir });
  H.db.channels.create({ id: 'other', name: 'Other', kind: 'internal', use_worktree: 0, repo_path: dir, base_dir: dir });
});

/** The header of a PNG of this size, padded to `bytes`. imageSize reads nothing else. */
function png(width: number, height: number, bytes = 64) {
  const b = Buffer.alloc(Math.max(bytes, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** A JPEG's start, an APP0 segment and a frame header of this size, padded to `bytes`. */
function jpeg(width: number, height: number, bytes = 64) {
  const b = Buffer.alloc(Math.max(bytes, 40));
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).copy(b);
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]).copy(b, 20);
  b.writeUInt16BE(height, 25);
  b.writeUInt16BE(width, 27);
  return b;
}

const PAGE: PageObservation = {
  tab: 'tab-1',
  url: 'https://shop.example.com/cart?coupon=SPRING',
  title: 'Your cart\n· Example Shop',
  navigations: 3,
  viewport: { width: 1280, height: 713 },
  scroll: { x: 0, y: 240 },
};

/**
 * A browser that answers with `page` and takes each screenshot from `images` in turn. `during` runs while a screenshot is
 * being taken: the page changing under the capture.
 */
function fakeBrowser(over: { images?: Buffer[]; during?: (page: PageObservation, shot: number) => void; running?: boolean; page?: Partial<PageObservation> } = {}) {
  const page: PageObservation = { ...PAGE, viewport: { ...PAGE.viewport }, scroll: { ...PAGE.scroll }, ...over.page };
  const images = over.images ?? [png(2560, 1426)];
  const shots: { format: string; quality?: number }[] = [];
  const src: CaptureSource & { page: PageObservation; shots: typeof shots } = {
    page,
    shots,
    running: over.running ?? true,
    observe: async () => ({ ...page, viewport: { ...page.viewport }, scroll: { ...page.scroll } }),
    shot: async (format, quality) => {
      shots.push({ format, ...(quality && { quality }) });
      over.during?.(page, shots.length);
      return images[Math.min(shots.length, images.length) - 1];
    },
  };
  return src;
}

const newThread = async (channel = 'shots') => {
  const t = await H.runner.createThread({ channel, prompt: 'CMD hi' });
  await H.untilResults(t.id, 1);
  return t;
};
const saved = (id: string) => (existsSync(uploadsDir(id)) ? readdirSync(uploadsDir(id)).filter((f) => f.startsWith('annotation-')) : []);
const must = async (src: CaptureSource, id: string): Promise<BrowserCapture> => {
  const r = await cap.captureAnnotation(src, id);
  if (!r.ok) throw new Error(r.error);
  return r.capture;
};
const RECT = { x: 320, y: 96, width: 480, height: 160 };

describe('imageSize', () => {
  it('reads a PNG and a JPEG from their headers, and nothing else', () => {
    expect(cap.imageSize(png(2560, 1426))).toEqual({ width: 2560, height: 1426 });
    expect(cap.imageSize(jpeg(1280, 713))).toEqual({ width: 1280, height: 713 });
    expect(cap.imageSize(Buffer.from('<svg/>'))).toBeNull();
    expect(cap.imageSize(Buffer.alloc(0))).toBeNull();
  });
});

describe('staleReason', () => {
  const same = () => ({ ...PAGE, viewport: { ...PAGE.viewport }, scroll: { ...PAGE.scroll } });
  it('names what changed between two looks at the page', () => {
    expect(cap.staleReason(PAGE, same())).toBeNull();
    expect(cap.staleReason(PAGE, { ...same(), tab: 'tab-2' })).toBe('tab');
    expect(cap.staleReason(PAGE, { ...same(), navigations: 4 })).toBe('navigated');
    expect(cap.staleReason(PAGE, { ...same(), url: `${PAGE.url}#reviews` })).toBe('navigated');
    expect(cap.staleReason(PAGE, { ...same(), viewport: { width: 1280, height: 600 } })).toBe('viewport');
    expect(cap.staleReason(PAGE, { ...same(), scroll: { x: 0, y: 400 } })).toBe('scrolled');
  });

  it('lets a page settle by a pixel', () => {
    expect(cap.staleReason(PAGE, { ...same(), scroll: { x: 1, y: 241 } })).toBeNull();
  });
});

describe('captureAnnotation', () => {
  it('saves the page as an image in the thread uploads, with the numbers the record needs', T, async () => {
    const t = await newThread();
    const src = fakeBrowser();
    const c = await must(src, t.id);
    expect(c).toMatchObject({
      thread: t.id,
      url: PAGE.url,
      title: 'Your cart · Example Shop',
      viewport: { width: 1280, height: 713, scale: 2 },
      scroll: { x: 0, y: 240 },
      image: { mime: 'image/png', width: 2560, height: 1426, bytes: 64 },
    });
    expect(c.image.name).toMatch(/^annotation-[0-9a-f]{16}\.png$/);
    expect(readFileSync(join(uploadsDir(t.id), c.image.name))).toEqual(png(2560, 1426));
    expect(src.shots).toEqual([{ format: 'png' }]);
    // A record the route and the clients accept once Ben draws on it.
    expect(annotate(c, RECT).ok).toBe(true);
  });

  it('works out the display scale from the image, 1x as well as 2x and in between', T, async () => {
    const t = await newThread();
    expect((await must(fakeBrowser({ images: [png(1280, 713)] }), t.id)).viewport.scale).toBe(1);
    expect((await must(fakeBrowser({ images: [png(1920, 1070)] }), t.id)).viewport.scale).toBe(1.5);
    const narrow = fakeBrowser({ page: { viewport: { width: 390, height: 700 } }, images: [png(1170, 2100)] });
    expect((await must(narrow, t.id)).viewport).toEqual({ width: 390, height: 700, scale: 3 });
  });

  it('says stale, and saves nothing, when the page navigates while the screenshot is taken', T, async () => {
    const t = await newThread();
    const r = await cap.captureAnnotation(fakeBrowser({ during: (p) => void p.navigations++ }), t.id);
    expect(r).toMatchObject({ ok: false, status: 409, retryable: true, stale: 'navigated' });
    expect(saved(t.id)).toEqual([]);
  });

  const changes: [string, (p: PageObservation) => void, StaleReason][] = [
    ['the address changes within the page', (p) => { p.url += '#reviews'; }, 'navigated'],
    ['the browser switches tabs', (p) => { p.tab = 'tab-2'; }, 'tab'],
    ['another client resizes the browser', (p) => { p.viewport = { width: 390, height: 700 }; }, 'viewport'],
    ['the page scrolls', (p) => { p.scroll.y += 300; }, 'scrolled'],
  ];
  it.each(changes)('says stale when %s mid-capture', T, async (_, change, why) => {
    const t = await newThread();
    const r = await cap.captureAnnotation(fakeBrowser({ during: change }), t.id);
    expect(r).toMatchObject({ ok: false, status: 409, retryable: true, stale: why });
    expect(saved(t.id)).toEqual([]);
  });

  it('can be retried once the page holds still', T, async () => {
    const t = await newThread();
    const src = fakeBrowser({ during: (p, n) => void (n === 1 && p.navigations++) });
    expect((await cap.captureAnnotation(src, t.id)).ok).toBe(false);
    expect((await cap.captureAnnotation(src, t.id)).ok).toBe(true);
    expect(saved(t.id)).toHaveLength(1);
  });

  it('refuses an image that is not the viewport at one scale, as a viewport change', T, async () => {
    const t = await newThread();
    const r = await cap.captureAnnotation(fakeBrowser({ images: [png(1000, 1426)] }), t.id);
    expect(r).toMatchObject({ ok: false, retryable: true, stale: 'viewport' });
    expect(saved(t.id)).toEqual([]);
  });

  it('keeps a screenshot under the inline limit: PNG, then JPEG, then a lower JPEG', T, async () => {
    const t = await newThread();
    const big = png(2560, 1426, MAX_INLINE_IMAGE + 1);
    const src = fakeBrowser({ images: [big, jpeg(2560, 1426, 900_000)] });
    const c = await must(src, t.id);
    expect(src.shots).toEqual([{ format: 'png' }, { format: 'jpeg', quality: 80 }]);
    expect(c.image).toMatchObject({ mime: 'image/jpeg', bytes: 900_000 });
    expect(c.image.name).toMatch(/\.jpg$/);
    expect(saved(t.id)).toEqual([c.image.name]);

    const lower = fakeBrowser({ images: [big, jpeg(2560, 1426, MAX_INLINE_IMAGE + 1), jpeg(2560, 1426, 1_200_000)] });
    expect((await must(lower, t.id)).image.bytes).toBe(1_200_000);
    expect(lower.shots.map((s) => s.quality)).toEqual([undefined, 80, 50]);
  });

  it('refuses a page that is too large even as a JPEG, not retryably, saving nothing', T, async () => {
    const t = await newThread();
    const huge = [png(2560, 1426, MAX_INLINE_IMAGE + 1), jpeg(2560, 1426, MAX_INLINE_IMAGE + 1), jpeg(2560, 1426, MAX_INLINE_IMAGE + 1)];
    const r = await cap.captureAnnotation(fakeBrowser({ images: huge }), t.id);
    expect(r).toMatchObject({ ok: false, status: 413, retryable: false });
    expect(r.ok ? '' : r.error).toMatch(/too large to attach as an image/);
    expect(saved(t.id)).toEqual([]);
  });

  it('refuses when the browser is off, on a page that is not a web page, or at an address a record cannot hold', T, async () => {
    const t = await newThread();
    expect(await cap.captureAnnotation(fakeBrowser({ running: false }), t.id)).toMatchObject({ ok: false, status: 409, retryable: true });
    expect(await cap.captureAnnotation(fakeBrowser({ page: { url: 'about:blank' } }), t.id)).toMatchObject({ ok: false, status: 422, retryable: false });
    expect(await cap.captureAnnotation(fakeBrowser({ page: { url: 'chrome-error://chromewebdata/' } }), t.id)).toMatchObject({ ok: false, status: 422 });
    const long = await cap.captureAnnotation(fakeBrowser({ page: { url: `https://x.test/${'a'.repeat(2100)}` } }), t.id);
    expect(long).toMatchObject({ ok: false, status: 422, retryable: false });
    expect(saved(t.id)).toEqual([]);
  });
});

describe('discardCapture', () => {
  it('deletes a fresh capture, and only a capture: not another file, not one old enough to have been sent', T, async () => {
    const t = await newThread();
    const c = await must(fakeBrowser(), t.id);
    writeFileSync(join(uploadsDir(t.id), 'notes.png'), png(10, 10));
    expect(cap.discardCapture(t.id, 'notes.png')).toBe(false);
    expect(cap.discardCapture(t.id, '../../x.png')).toBe(false);
    expect(cap.discardCapture(t.id, 'annotation-0123456789abcdef.png')).toBe(false);
    const old = new Date(Date.now() - 7 * 3_600_000);
    utimesSync(join(uploadsDir(t.id), c.image.name), old, old);
    expect(cap.discardCapture(t.id, c.image.name)).toBe(false);
    const fresh = await must(fakeBrowser(), t.id);
    expect(cap.discardCapture(t.id, fresh.image.name)).toBe(true);
    expect(saved(t.id)).toEqual([c.image.name]);
    expect(existsSync(join(uploadsDir(t.id), 'notes.png'))).toBe(true);
  });
});

describe('saveMarked', () => {
  const MARKS = [{ type: 'arrow' as const, color: '#ff4420' as const, stroke: 4, x0: 200, y0: 300, x1: 420, y1: 180 }];

  it('saves the screenshot with Ben\'s marks beside the capture, of the capture\'s size', T, async () => {
    const t = await newThread();
    const c = await must(fakeBrowser(), t.id);
    const r = cap.saveMarked(t.id, c.image.name, png(2560, 1426, 900), 'image/png');
    expect(r).toEqual({ ok: true, marked: { name: c.image.name.replace('.png', '-marked.png'), mime: 'image/png', width: 2560, height: 1426, bytes: 900 } });
    expect(saved(t.id).sort()).toEqual([c.image.name, c.image.name.replace('.png', '-marked.png')].sort());
    // The record the clients make from it is valid.
    expect(annotate(c, { x: 150, y: 150, width: 300, height: 200 }, undefined, { marks: MARKS, marked: r.ok ? r.marked : undefined }).ok).toBe(true);
  });

  it('replaces an earlier marked image, in whichever encoding it was', T, async () => {
    const t = await newThread();
    const c = await must(fakeBrowser(), t.id);
    cap.saveMarked(t.id, c.image.name, png(2560, 1426), 'image/png');
    const again = cap.saveMarked(t.id, c.image.name, jpeg(2560, 1426), 'image/jpeg');
    expect(again.ok && again.marked.name).toBe(c.image.name.replace('.png', '-marked.jpg'));
    expect(saved(t.id).filter((f) => f.includes('-marked'))).toEqual([c.image.name.replace('.png', '-marked.jpg')]);
  });

  it('refuses what is not the capture\'s own image: another size, another type, not an image, too big, not a capture', T, async () => {
    const t = await newThread();
    const c = await must(fakeBrowser(), t.id);
    const bad = (body: Buffer, type: string, name = c.image.name) => cap.saveMarked(t.id, name, body, type);
    expect(bad(png(1280, 713), 'image/png')).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/not the size of the capture/) });
    expect(bad(jpeg(2560, 1426), 'image/png')).toMatchObject({ ok: false, status: 422 });
    expect(bad(png(2560, 1426), 'image/gif')).toMatchObject({ ok: false, status: 415 });
    expect(bad(Buffer.from('<svg/>'), 'image/png')).toMatchObject({ ok: false, status: 422 });
    expect(bad(png(2560, 1426, MAX_INLINE_IMAGE + 1), 'image/png')).toMatchObject({ ok: false, status: 413 });
    expect(bad(png(2560, 1426), 'image/png', 'notes.png')).toMatchObject({ ok: false, status: 400 });
    expect(bad(png(2560, 1426), 'image/png', 'annotation-0123456789abcdef.png')).toMatchObject({ ok: false, status: 404 });
    expect(saved(t.id)).toEqual([c.image.name]);
  });

  it('is refused for a capture old enough to have been sent', T, async () => {
    const t = await newThread();
    const c = await must(fakeBrowser(), t.id);
    const old = new Date(Date.now() - 7 * 3_600_000);
    utimesSync(join(uploadsDir(t.id), c.image.name), old, old);
    expect(cap.saveMarked(t.id, c.image.name, png(2560, 1426), 'image/png')).toMatchObject({ ok: false, status: 404 });
  });

  it('goes with the capture when it is discarded', T, async () => {
    const t = await newThread();
    const c = await must(fakeBrowser(), t.id);
    cap.saveMarked(t.id, c.image.name, png(2560, 1426), 'image/png');
    expect(cap.discardCapture(t.id, c.image.name)).toBe(true);
    expect(saved(t.id)).toEqual([]);
  });
});

describe('the capture routes', () => {
  const mount = (src: CaptureSource) => new Hono().route('/api/channels', cap.captureApi(() => src));
  const post = (app: Hono, channel: string, body: unknown) =>
    app.request(`/api/channels/${channel}/browser/capture`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('captures for a thread of the channel and answers with the capture', T, async () => {
    const t = await newThread();
    const res = await post(mount(fakeBrowser()), 'shots', { thread: t.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The Mac app decodes this (OmniKit's BrowserCapture): the same keys and types as its recorded fixture.
    macFixture('browser-capture.json', body);
    const { capture } = body as { capture: BrowserCapture };
    expect(capture).toMatchObject({ thread: t.id, url: PAGE.url, viewport: { scale: 2 } });
    expect(saved(t.id)).toEqual([capture.image.name]);
  });

  it('answers a stale capture 409 with retryable and why', T, async () => {
    const t = await newThread();
    const res = await post(mount(fakeBrowser({ during: (p) => void p.navigations++ })), 'shots', { thread: t.id });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ stale: 'navigated', retryable: true, error: expect.stringMatching(/navigated/) });
    macFixture('browser-capture-stale.json', body);
  });

  it('refuses a thread that is not in the channel, and an unknown one', T, async () => {
    const t = await newThread('other');
    expect((await post(mount(fakeBrowser()), 'shots', { thread: t.id })).status).toBe(400);
    expect((await post(mount(fakeBrowser()), 'shots', { thread: 'nope' })).status).toBe(404);
    expect(saved(t.id)).toEqual([]);
  });

  it('takes the marked screenshot as bytes, and answers with its image', T, async () => {
    const t = await newThread();
    const app = mount(fakeBrowser());
    const { capture } = (await (await post(app, 'shots', { thread: t.id })).json()) as { capture: BrowserCapture };
    const url = `/api/channels/shots/browser/capture/${capture.image.name}/marked?thread=${t.id}`;
    const res = await app.request(url, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png(2560, 1426, 700) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The Mac app decodes this (OmniKit's MarkedReply).
    macFixture('browser-capture-marked.json', body);
    expect(body).toEqual({ marked: { name: capture.image.name.replace('.png', '-marked.png'), mime: 'image/png', width: 2560, height: 1426, bytes: 700 } });
    const wrong = await app.request(url, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png(10, 10) });
    expect(wrong.status).toBe(422);
    expect((await app.request(`/api/channels/shots/browser/capture/${capture.image.name}/marked?thread=nope`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png(2560, 1426) })).status).toBe(404);
  });

  it('discards a capture that was never made into a record', T, async () => {
    const t = await newThread();
    const app = mount(fakeBrowser());
    const { capture } = (await (await post(app, 'shots', { thread: t.id })).json()) as { capture: BrowserCapture };
    const res = await app.request(`/api/channels/shots/browser/capture/${capture.image.name}?thread=${t.id}`, { method: 'DELETE' });
    expect(await res.json()).toEqual({ removed: true });
    expect(saved(t.id)).toEqual([]);
  });
});

describe('a browser_annotation through the message route', () => {
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  beforeAll(async () => {
    ({ app } = await import('../app.ts'));
  });
  const send = (id: string, body: Record<string, unknown>) =>
    app.request(`/api/threads/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const record = (c: BrowserCapture, note = 'the total looks wrong here', over: Partial<BrowserAnnotation> = {}) => {
    const body = annotate(c, RECT);
    if (!body.ok) throw new Error(body.error);
    return newContext(browserAnnotation, { ...body.value, ...over }, note, { id: () => 'shot-1' });
  };

  it('is accepted with a screenshot this thread saved, and refused for any other', T, async () => {
    const t = await newThread();
    const other = await newThread();
    const c = await must(fakeBrowser(), t.id);
    expect((await send(t.id, { prompt: 'look', context: [record(c)] })).status).toBe(200);
    // Taken for another thread: its file is not this thread's to send.
    const elsewhere = await send(other.id, { prompt: 'look', context: [record(c)] });
    expect(elsewhere.status).toBe(400);
    expect((await elsewhere.json()).error).toMatch(/taken for another thread/);
  });

  it('takes marks and the marked screenshot, and refuses them once that file is gone', T, async () => {
    const t = await newThread();
    const c = await must(fakeBrowser(), t.id);
    const marked = cap.saveMarked(t.id, c.image.name, png(2560, 1426, 800), 'image/png');
    if (!marked.ok) throw new Error(marked.error);
    const marks = [
      { type: 'arrow' as const, color: '#ff4420' as const, stroke: 4, x0: 200, y0: 300, x1: 420, y1: 180 },
      { type: 'text' as const, color: '#3b82f6' as const, stroke: 4, x: 500, y: 100, text: 'wrong total' },
    ];
    const body = annotate(c, { x: 150, y: 90, width: 400, height: 220 }, undefined, { marks, marked: marked.marked });
    if (!body.ok) throw new Error(body.error);
    const rec = newContext(browserAnnotation, body.value, 'these', { id: () => 'shot-1' });
    expect(rec.label).toBe('Browser, 2 marks on shop.example.com/cart');
    expect((await send(t.id, { prompt: 'look', context: [rec] })).status).toBe(200);
    rmSync(join(uploadsDir(t.id), marked.marked.name));
    const gone = await send(t.id, { prompt: 'look', context: [rec] });
    expect(gone.status).toBe(400);
    expect((await gone.json()).error).toMatch(/marked screenshot is no longer saved/);
  });

  it('is refused, saying so, when the screenshot is gone', T, async () => {
    const t = await newThread();
    const c = await must(fakeBrowser(), t.id);
    cap.discardCapture(t.id, c.image.name);
    const res = await send(t.id, { prompt: 'look', context: [record(c)] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/screenshot is no longer saved. Annotate the page again/);
  });

  it('refuses a record that points outside the uploads folder or at a page that is not a web page', T, async () => {
    const t = await newThread();
    const c = await must(fakeBrowser(), t.id);
    const good = record(c);
    for (const [body, error] of [
      [{ ...good.body, image: { ...good.body.image, name: '../../../etc/passwd.png' } }, /image.name must be an annotation/],
      [{ ...good.body, url: 'file:///etc/passwd' }, /url must be a web page address/],
      [{ ...good.body, rect: { x: 1200, y: 0, width: 400, height: 50 } }, /rect reaches outside the viewport/],
    ] as const) {
      const res = await send(t.id, { prompt: 'look', context: [{ ...good, body }] });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(error);
    }
  });
});
