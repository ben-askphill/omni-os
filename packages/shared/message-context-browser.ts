// The browser_annotation kind of message context: a rectangle Ben drew on a screenshot of the channel's browser, with
// the page it was taken of. The screenshot is a file in the thread's uploads folder and the record names it; the
// rectangle is in the page's own CSS pixels, so it means the same thing on any client and at any display scale. The
// server takes the screenshot and everything but the rectangle (`BrowserCapture`), so the rectangle is drawn on the very
// image it describes and cannot disagree with it; the client adds the rectangle and the note.
// apps/mac/OmniKit/Sources/OmniKit/BrowserAnnotationContext.swift ports it.
import { ID_MAX, cutLabel, overLimit, type MessageContextKind, type Parsed } from './message-context.ts';
import { FORBIDDEN_CLASS, plain } from './message-context-terminal.ts';

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The screenshot, as the server saved it. */
export interface AnnotationImage {
  /** A file in the thread's uploads folder: `annotation-<hex>.png` or `.jpg`. */
  name: string;
  mime: 'image/png' | 'image/jpeg';
  /** In image pixels: the viewport's CSS size times the display scale. */
  width: number;
  height: number;
  bytes: number;
}

export interface BrowserAnnotation {
  /** The thread the screenshot was saved for. The route refuses a record from another thread. */
  thread: string;
  /** The page's address when the screenshot was taken. */
  url: string;
  /** The page's title then, with whitespace collapsed. May be empty. */
  title: string;
  /** The page's viewport in CSS pixels, and how many image pixels one CSS pixel is. */
  viewport: { width: number; height: number; scale: number };
  /** How far the page was scrolled, in CSS pixels. */
  scroll: { x: number; y: number };
  /** What Ben marked, in CSS pixels from the viewport's top left, inside the viewport. */
  rect: PixelRect;
  /** When the screenshot was taken, as `Date.toISOString` writes it. */
  captured_at: string;
  image: AnnotationImage;
  // An element picked on the page (#216) is an optional `element` here, at v1: a record without it stays valid.
}

/** What the server makes: everything about the page and the image, before Ben marks anything. */
export type BrowserCapture = Omit<BrowserAnnotation, 'rect'>;

export const URL_MAX = 2_048;
export const TITLE_MAX = 300;
/** The most a screenshot may weigh. The server keeps to MAX_INLINE_IMAGE (apps/server/uploads.ts) so every harness can take it inline. */
export const IMAGE_BYTES_MAX = 5_000_000;
const SIZE_MAX = 20_000;
/** The smallest rectangle, per side, in CSS pixels. */
export const RECT_MIN = 8;
const LABEL_URL_MAX = 60;
const IMAGE_NAME = /^annotation-[0-9a-f]{8,32}\.(png|jpg)$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const validTime = (v: unknown): v is string => typeof v === 'string' && ISO_TIME.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
const round2 = (n: number) => Math.round(n * 100) / 100;

function rectOf(v: unknown, viewport: { width: number; height: number }): Parsed<PixelRect> {
  if (!isObj(v)) return { ok: false, error: 'rect must be an object' };
  const { x, y, width, height } = v;
  if (!whole(x, 0, viewport.width) || !whole(y, 0, viewport.height) || !whole(width, 1, viewport.width) || !whole(height, 1, viewport.height))
    return { ok: false, error: 'rect must be whole CSS pixels inside the viewport' };
  if (x + width > viewport.width || y + height > viewport.height) return { ok: false, error: 'rect reaches outside the viewport' };
  return { ok: true, value: { x, y, width, height } };
}

function imageOf(v: unknown): Parsed<AnnotationImage> {
  if (!isObj(v)) return { ok: false, error: 'image must be an object' };
  const { name, mime, width, height, bytes } = v;
  const m = typeof name === 'string' ? IMAGE_NAME.exec(name) : null;
  if (!m) return { ok: false, error: 'image.name must be an annotation-<hex>.png or .jpg file name' };
  if (mime !== (m[1] === 'png' ? 'image/png' : 'image/jpeg')) return { ok: false, error: 'image.mime does not match the file name' };
  if (!whole(width, 1, SIZE_MAX) || !whole(height, 1, SIZE_MAX)) return { ok: false, error: 'image.width and image.height must be whole pixels' };
  if (!whole(bytes, 1, IMAGE_BYTES_MAX)) return { ok: false, error: `image.bytes must be 1 to ${IMAGE_BYTES_MAX}` };
  return { ok: true, value: { name: name as string, mime: mime as AnnotationImage['mime'], width, height, bytes } };
}

/** The address without its scheme, query or fragment, for a label: shop.example.com/cart. */
export function shortUrl(url: string) {
  return url.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/$/, '');
}

export const browserAnnotation: MessageContextKind<BrowserAnnotation> = {
  kind: 'browser_annotation',
  v: 1,
  parse(body, v): Parsed<BrowserAnnotation> {
    if (v !== 1) return { ok: false, error: `browser_annotation has no version ${v}` };
    if (!isObj(body)) return { ok: false, error: 'not an object' };
    const thread = plain(body.thread, 'thread', ID_MAX);
    if (!thread.ok) return thread;
    const url = plain(body.url, 'url', URL_MAX);
    if (!url.ok) return url;
    if (!/^https?:\/\/[^\s/]/i.test(url.value)) return { ok: false, error: 'url must be a web page address' };
    // An empty title is a page with none.
    const title = body.title === '' ? ({ ok: true, value: '' } as const) : plain(body.title, 'title', TITLE_MAX);
    if (!title.ok) return title;
    const vp = body.viewport;
    if (!isObj(vp) || !whole(vp.width, 1, SIZE_MAX) || !whole(vp.height, 1, SIZE_MAX) || typeof vp.scale !== 'number' || !(vp.scale > 0 && vp.scale <= 8))
      return { ok: false, error: 'viewport must be a whole CSS width and height and a scale up to 8' };
    const viewport = { width: vp.width, height: vp.height };
    const sc = body.scroll;
    if (!isObj(sc) || !whole(sc.x, 0, 10_000_000) || !whole(sc.y, 0, 10_000_000)) return { ok: false, error: 'scroll must be whole CSS pixels' };
    const rect = rectOf(body.rect, viewport);
    if (!rect.ok) return rect;
    if (!validTime(body.captured_at)) return { ok: false, error: 'captured_at must be a time like 2026-10-24T09:30:00.000Z' };
    const image = imageOf(body.image);
    if (!image.ok) return image;
    return {
      ok: true,
      value: {
        thread: thread.value,
        url: url.value,
        title: title.value,
        viewport: { width: viewport.width, height: viewport.height, scale: round2(vp.scale) },
        scroll: { x: sc.x, y: sc.y },
        rect: rect.value,
        captured_at: body.captured_at,
        image: image.value,
      },
    };
  },
  label(b) {
    const at = [...shortUrl(b.url)];
    const where = at.length > LABEL_URL_MAX ? `${at.slice(0, LABEL_URL_MAX - 1).join('')}…` : at.join('');
    return cutLabel(`Browser, ${b.rect.width}×${b.rect.height} area on ${where}`);
  },
};

/** The capture with Ben's rectangle on it, checked as the route will check it. */
export function annotate(capture: BrowserCapture, rect: PixelRect): Parsed<BrowserAnnotation> {
  return browserAnnotation.parse({ ...capture, rect }, 1);
}

/** A title as a record holds it: whitespace collapsed, control characters dropped, cut to TITLE_MAX. */
export function cleanTitle(raw: string): string {
  const flat = raw.replace(new RegExp(FORBIDDEN_CLASS, 'gu'), ' ').replace(/\s+/g, ' ').trim();
  return overLimit(flat, TITLE_MAX) ? `${[...flat].slice(0, TITLE_MAX - 1).join('')}…` : flat;
}

/** A drag across the screenshot as it is shown: corner to corner, in the shown image's own pixels. */
export interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Ben's drag on the screenshot, shown at `shown` (width and height in on-screen pixels), as a rectangle in the page's
 * CSS pixels. The corners are put in order, rounded outward so the rectangle holds what he dragged over, and kept
 * inside the viewport. Refused when it is smaller than RECT_MIN either way.
 */
export function dragToRect(drag: Drag, shown: { width: number; height: number }, viewport: { width: number; height: number }): Parsed<PixelRect> {
  if (!(shown.width > 0 && shown.height > 0 && viewport.width > 0 && viewport.height > 0)) return { ok: false, error: 'There is no screenshot to draw on.' };
  const sx = viewport.width / shown.width;
  const sy = viewport.height / shown.height;
  const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
  const x0 = Math.floor(clamp(Math.min(drag.x0, drag.x1) * sx, viewport.width));
  const y0 = Math.floor(clamp(Math.min(drag.y0, drag.y1) * sy, viewport.height));
  const x1 = Math.ceil(clamp(Math.max(drag.x0, drag.x1) * sx, viewport.width));
  const y1 = Math.ceil(clamp(Math.max(drag.y0, drag.y1) * sy, viewport.height));
  if (x1 - x0 < RECT_MIN || y1 - y0 < RECT_MIN) return { ok: false, error: 'Draw a larger area.' };
  return { ok: true, value: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
}

/** The rectangle in image pixels, for a view that draws it over the image itself. */
export function rectInImage(rect: PixelRect, image: { width: number; height: number }, viewport: { width: number; height: number }): PixelRect {
  const sx = image.width / viewport.width;
  const sy = image.height / viewport.height;
  return { x: Math.round(rect.x * sx), y: Math.round(rect.y * sy), width: Math.round(rect.width * sx), height: Math.round(rect.height * sy) };
}
