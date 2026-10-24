// Capturing the channel browser for a browser_annotation (packages/shared/message-context-browser.ts): a screenshot of
// the page as it is in Ben's real session, with its address, title, viewport and scroll, saved in the thread's uploads
// folder. It reads the page and changes nothing on it. The page is observed before the screenshot and again after, and a
// navigation, a new tab, a resize or a scroll in between gives a stale result the client can retry, so the image and the
// numbers always describe the same page.
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { annotate, cleanTitle, type BrowserCapture } from '@omni/shared/message-context-browser.ts';
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
  | { ok: true; capture: BrowserCapture }
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
    return { ok: true, capture };
  }
  return fail(413, `This page is too large to attach as an image (over ${(MAX_INLINE_IMAGE / 1_000_000).toFixed(1)} MB even as a JPEG). Make the browser window smaller and try again.`, false);
}

/** A discarded capture is deleted only while it can still be a draft's. */
const DISCARD_WINDOW_MS = 6 * 3_600_000;

/** Deletes a capture nothing was made of. False when it is not one, is gone or is old enough to have been sent. */
export function discardCapture(threadId: string, name: string, now = Date.now()): boolean {
  if (!/^annotation-[0-9a-f]{8,32}\.(png|jpg)$/.test(name)) return false;
  const file = join(uploadsDir(threadId), name);
  try {
    if (now - statSync(file).mtimeMs > DISCARD_WINDOW_MS) return false;
    rmSync(file);
    return true;
  } catch {
    return false;
  }
}

/** The capture routes under /api/channels/:id/browser, for the channel's own browser session. */
export function captureApi(browserFor: (c: Context) => CaptureSource) {
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
    return c.json({ capture: r.capture });
  });

  api.delete('/:id/browser/capture/:name', (c) => {
    const t = threadOf(c, c.req.query('thread') ?? '');
    if (t.error) return t.error;
    return c.json({ removed: discardCapture(t.thread.id, c.req.param('name')) });
  });
  return api;
}
