// Capturing the channel browser for a browser_annotation (packages/shared/message-context-browser.ts): a screenshot of
// the page as it is in Ben's real session, with its address, title, viewport and scroll, saved in the thread's uploads
// folder. It reads the page and changes nothing on it. The page is observed before the screenshot and again after, and a
// navigation, a new tab, a resize or a scroll in between gives a stale result the client can retry, so the image and the
// numbers always describe the same page.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { annotate, cleanTitle, type AnnotationImage, type BrowserCapture } from '@omni/shared/message-context-browser.ts';
import type { PageObservation } from './browser.ts';
import { uploadsDir } from './config.ts';
import { threads } from './db.ts';
import { MAX_INLINE_IMAGE } from './uploads.ts';

/** The part of ChannelBrowser a capture uses, so a test can stand in for Chrome. */
export interface CaptureSource {
  readonly running: boolean;
  observe(): Promise<PageObservation>;
  shot(format: 'png' | 'jpeg', quality?: number): Promise<Buffer>;
}

export type StaleReason = 'tab' | 'navigated' | 'viewport' | 'scrolled';

/** What a capture gives, or why not. `retryable`: trying again can work. */
export type CaptureResult =
  /** `page` is the page as the screenshot saw it, which an element pick compares the page against (browser-pick.ts). */
  | { ok: true; capture: BrowserCapture; page: PageObservation }
  | { ok: false; status: number; error: string; retryable: boolean; stale?: StaleReason };

/** A screenshot's encodings in the order they are tried: lossless, then JPEG at two qualities. */
const ENCODINGS = [{ format: 'png' as const }, { format: 'jpeg' as const, quality: 80 }, { format: 'jpeg' as const, quality: 50 }];
const STALE_TEXT: Record<StaleReason, string> = {
  tab: 'The browser switched tabs while the screenshot was taken. Try again.',
  navigated: 'The page navigated while the screenshot was taken. Try again once it has loaded.',
  viewport: 'The browser was resized while the screenshot was taken. Try again.',
  scrolled: 'The page scrolled while the screenshot was taken. Try again.',
};

/** What changed on the page between two observations, if anything. Scroll within a pixel is the page settling. */
export function staleReason(before: PageObservation, after: PageObservation): StaleReason | null {
  if (before.tab !== after.tab) return 'tab';
  if (before.navigations !== after.navigations || before.url !== after.url) return 'navigated';
  if (before.viewport.width !== after.viewport.width || before.viewport.height !== after.viewport.height) return 'viewport';
  if (Math.abs(before.scroll.x - after.scroll.x) > 1 || Math.abs(before.scroll.y - after.scroll.y) > 1) return 'scrolled';
  return null;
}

/** The pixel size of a PNG or a JPEG, from its header; null for anything else. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      // Start of frame: all but the tables and arithmetic-coding markers.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fail = (status: number, error: string, retryable: boolean, stale?: StaleReason): CaptureResult => ({ ok: false, status, error, retryable, ...(stale && { stale }) });

/**
 * The page as it is now, as an image under MAX_INLINE_IMAGE so every harness can take it inline, with what it shows. The
 * file is written only once the page held still, to the thread's uploads folder.
 */
export async function captureAnnotation(src: CaptureSource, threadId: string, now = new Date()): Promise<CaptureResult> {
  if (!src.running) return fail(409, 'The browser is not running. Open the Browser tab, then try again.', true);
  const before = await src.observe();
  if (!/^https?:\/\//i.test(before.url)) return fail(422, 'Only a web page can be annotated. Open one in the browser first.', false);
  for (const enc of ENCODINGS) {
    const buf = await src.shot(enc.format, 'quality' in enc ? enc.quality : undefined);
    const after = await src.observe();
    const stale = staleReason(before, after);
    if (stale) return fail(409, STALE_TEXT[stale], true, stale);
    const size = imageSize(buf);
    if (!size) return fail(502, 'The browser did not return an image. Try again.', true);
    // A screenshot at some other size than the viewport times one scale is not of this viewport.
    const sx = size.width / before.viewport.width;
    const sy = size.height / before.viewport.height;
    if (!(sx > 0 && sx <= 8) || Math.abs(sx - sy) > 0.02 * sx) return fail(409, STALE_TEXT.viewport, true, 'viewport');
    if (buf.length > MAX_INLINE_IMAGE) continue;
    const ext = enc.format === 'png' ? 'png' : 'jpg';
    const name = `annotation-${randomBytes(8).toString('hex')}.${ext}`;
    const capture: BrowserCapture = {
      thread: threadId,
      url: before.url,
      title: cleanTitle(before.title),
      viewport: { width: before.viewport.width, height: before.viewport.height, scale: round2(sx) },
      scroll: { x: Math.max(0, before.scroll.x), y: Math.max(0, before.scroll.y) },
      captured_at: now.toISOString(),
      image: { name, mime: enc.format === 'png' ? 'image/png' : 'image/jpeg', width: size.width, height: size.height, bytes: buf.length },
    };
    // The client will parse this with Ben's rectangle on it. Checked here with the whole viewport, so what it cannot
    // hold (an address too long, say) is said now and not when he presses Add.
    const whole = annotate(capture, { x: 0, y: 0, width: capture.viewport.width, height: capture.viewport.height });
    if (!whole.ok) return fail(422, `This page cannot be attached: ${whole.error}.`, false);
    const dir = uploadsDir(threadId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), buf);
    return { ok: true, capture, page: before };
  }
  return fail(413, `This page is too large to attach as an image (over ${(MAX_INLINE_IMAGE / 1_000_000).toFixed(1)} MB even as a JPEG). Make the browser window smaller and try again.`, false);
}

/** What a client that shows the page itself (the Mac app's own web view) says about it with the screenshot it took. */
export interface NativePage {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
}

/**
 * Saves a screenshot the client took of its own web view, as `captureAnnotation` saves the server browser's: the same file
 * name, the same record numbers, the same checks. The image must be of the viewport at one scale and under the inline
 * limit; a client that sent a PNG too large for it is told so (413) and may send a JPEG.
 */
export function saveNativeCapture(threadId: string, page: NativePage, body: Buffer, contentType: string, now = new Date()): CaptureResult {
  if (!/^https?:\/\//i.test(page.url)) return fail(422, 'Only a web page can be annotated. Open one in the browser first.', false);
  const type = contentType.split(';')[0].trim().toLowerCase();
  const enc = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpeg' : null;
  if (!enc) return fail(415, 'Send the screenshot as image/png or image/jpeg.', false);
  const size = imageSize(body);
  const isPng = body.length > 8 && body.readUInt32BE(0) === 0x89504e47;
  if (!size || isPng !== (enc === 'png')) return fail(422, 'That is not the image it says it is.', false);
  const { viewport } = page;
  if (!(viewport.width > 0 && viewport.height > 0)) return fail(422, 'The page has no size.', false);
  const sx = size.width / viewport.width;
  const sy = size.height / viewport.height;
  if (!(sx > 0 && sx <= 8) || Math.abs(sx - sy) > 0.02 * sx) return fail(409, STALE_TEXT.viewport, true, 'viewport');
  if (body.length > MAX_INLINE_IMAGE) return fail(413, `The screenshot is over ${(MAX_INLINE_IMAGE / 1_000_000).toFixed(1)} MB.`, false);
  const name = `annotation-${randomBytes(8).toString('hex')}.${enc === 'png' ? 'png' : 'jpg'}`;
  const capture: BrowserCapture = {
    thread: threadId,
    url: page.url,
    title: cleanTitle(page.title),
    viewport: { width: viewport.width, height: viewport.height, scale: round2(sx) },
    scroll: { x: Math.max(0, Math.round(page.scroll.x)), y: Math.max(0, Math.round(page.scroll.y)) },
    captured_at: now.toISOString(),
    image: { name, mime: enc === 'png' ? 'image/png' : 'image/jpeg', width: size.width, height: size.height, bytes: body.length },
  };
  const whole = annotate(capture, { x: 0, y: 0, width: capture.viewport.width, height: capture.viewport.height });
  if (!whole.ok) return fail(422, `This page cannot be attached: ${whole.error}.`, false);
  const dir = uploadsDir(threadId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
  // No server-side page was observed: a native pick is checked against what the client says in the pick itself.
  return { ok: true, capture, page: { tab: null, url: page.url, title: page.title, navigations: 0, viewport, scroll: page.scroll } };
}

/** A discarded capture is deleted only while it can still be a draft's. */
const DISCARD_WINDOW_MS = 6 * 3_600_000;

const CAPTURE_NAME = /^annotation-([0-9a-f]{8,32})\.(png|jpg)$/;

/** The files a capture's marked image may be saved as: one per encoding, so a second upload in the other one replaces the first. */
const markedNames = (hex: string) => [`annotation-${hex}-marked.png`, `annotation-${hex}-marked.jpg`];

/** Deletes a capture nothing was made of, and the marked image made of it. False when it is not one, is gone or is old enough to have been sent. */
export function discardCapture(threadId: string, name: string, now = Date.now()): boolean {
  const m = CAPTURE_NAME.exec(name);
  if (!m) return false;
  const dir = uploadsDir(threadId);
  const file = join(dir, name);
  try {
    if (now - statSync(file).mtimeMs > DISCARD_WINDOW_MS) return false;
    rmSync(file);
    for (const marked of markedNames(m[1])) rmSync(join(dir, marked), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** What saving a marked image gives, or why not. */
export type MarkedResult = { ok: true; marked: AnnotationImage } | { ok: false; status: number; error: string };

/**
 * Saves the screenshot `name` with Ben's marks rendered on it by his client, beside it as `annotation-<hex>-marked.png` or
 * `.jpg`. The server cannot tell what is drawn on it, only that it is an image of the very size of the capture and small
 * enough for every harness to take inline; the marks themselves are in the record, and are what the agent is told in words.
 */
export function saveMarked(threadId: string, name: string, body: Buffer, contentType: string, now = Date.now()): MarkedResult {
  const m = CAPTURE_NAME.exec(name);
  if (!m) return { ok: false, status: 400, error: 'That is not a capture.' };
  const dir = uploadsDir(threadId);
  const source = join(dir, name);
  let original: Buffer;
  try {
    if (now - statSync(source).mtimeMs > DISCARD_WINDOW_MS) return { ok: false, status: 404, error: 'That capture is too old to mark. Annotate the page again.' };
    original = readFileSync(source);
  } catch {
    return { ok: false, status: 404, error: 'That capture is no longer saved. Annotate the page again.' };
  }
  const type = contentType.split(';')[0].trim().toLowerCase();
  const ext = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : null;
  if (!ext) return { ok: false, status: 415, error: 'Send the marked screenshot as image/png or image/jpeg.' };
  if (body.length > MAX_INLINE_IMAGE) return { ok: false, status: 413, error: `The marked screenshot is over ${(MAX_INLINE_IMAGE / 1_000_000).toFixed(1)} MB.` };
  const size = imageSize(body);
  const isPng = body.length > 8 && body.readUInt32BE(0) === 0x89504e47;
  if (!size || isPng !== (ext === 'png')) return { ok: false, status: 422, error: 'That is not the image it says it is.' };
  const was = imageSize(original);
  if (!was || was.width !== size.width || was.height !== size.height) return { ok: false, status: 422, error: 'The marked screenshot is not the size of the capture.' };
  const saved = `annotation-${m[1]}-marked.${ext}`;
  for (const old of markedNames(m[1])) if (old !== saved) rmSync(join(dir, old), { force: true });
  writeFileSync(join(dir, saved), body);
  return { ok: true, marked: { name: saved, mime: type as AnnotationImage['mime'], width: size.width, height: size.height, bytes: body.length } };
}

/** The capture routes under /api/channels/:id/browser, for the channel's own browser session. */
export function captureApi(browserFor: (c: Context) => CaptureSource, hooks: { captured?: (threadId: string, name: string, page: PageObservation) => void; discarded?: (threadId: string, name: string) => void } = {}) {
  const api = new Hono();
  /** The thread the capture is for, which must belong to this channel. */
  const threadOf = (c: Context, id: string) => {
    const t = threads.get(id);
    if (!t) return { error: c.json({ error: 'not found' }, 404) };
    if (t.channel_id !== c.req.param('id')) return { error: c.json({ error: 'That thread is not in this channel.' }, 400) };
    return { thread: t };
  };

  api.post('/:id/browser/capture', async (c) => {
    const { thread: id } = z.object({ thread: z.string().min(1).max(200) }).parse(await c.req.json());
    const t = threadOf(c, id);
    if (t.error) return t.error;
    const r = await captureAnnotation(browserFor(c), id).catch((e: Error) => fail(502, `The browser could not be captured: ${e.message}`, true));
    if (!r.ok) return c.json({ error: r.error, retryable: r.retryable, ...(r.stale && { stale: r.stale }) }, r.status as 409);
    hooks.captured?.(id, r.capture.image.name, r.page);
    return c.json({ capture: r.capture });
  });

  // A screenshot the client took of its own web view (the Mac app's native browser): the image as bytes, the page's numbers in the query.
  api.post('/:id/browser/capture/native', async (c) => {
    const q = z
      .object({
        thread: z.string().min(1).max(200),
        url: z.string().min(1).max(4000),
        title: z.string().max(1000).default(''),
        vw: z.coerce.number().int().min(1).max(20_000),
        vh: z.coerce.number().int().min(1).max(20_000),
        sx: z.coerce.number().min(0).max(1_000_000).default(0),
        sy: z.coerce.number().min(0).max(1_000_000).default(0),
      })
      .safeParse(c.req.query());
    if (!q.success) return c.json({ error: 'The screenshot needs thread, url, vw and vh.', retryable: false }, 400);
    const t = threadOf(c, q.data.thread);
    if (t.error) return t.error;
    const r = saveNativeCapture(t.thread.id, { url: q.data.url, title: q.data.title, viewport: { width: q.data.vw, height: q.data.vh }, scroll: { x: q.data.sx, y: q.data.sy } }, Buffer.from(await c.req.arrayBuffer()), c.req.header('content-type') ?? '');
    if (!r.ok) return c.json({ error: r.error, retryable: r.retryable, ...(r.stale && { stale: r.stale }) }, r.status as 409);
    return c.json({ capture: r.capture });
  });

  // The marked screenshot: the image as bytes, which is what a client has once it has drawn Ben's marks on the capture.
  api.post('/:id/browser/capture/:name/marked', async (c) => {
    const t = threadOf(c, c.req.query('thread') ?? '');
    if (t.error) return t.error;
    const r = saveMarked(t.thread.id, c.req.param('name'), Buffer.from(await c.req.arrayBuffer()), c.req.header('content-type') ?? '');
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ marked: r.marked });
  });

  api.delete('/:id/browser/capture/:name', (c) => {
    const t = threadOf(c, c.req.query('thread') ?? '');
    if (t.error) return t.error;
    const name = c.req.param('name');
    hooks.discarded?.(t.thread.id, name);
    return c.json({ removed: discardCapture(t.thread.id, name) });
  });
  return api;
}
