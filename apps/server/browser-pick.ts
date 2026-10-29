// Picking an element on a captured page (packages/shared/message-context-browser.ts `element`). Ben taps a spot on the
// screenshot; the server asks the page, through CDP, what is there, and answers with a bounded description of that one
// element. It only answers for the page the screenshot was taken of: the observation the capture made is remembered
// (`remember`), and a pick is refused unless the same tab, address, navigation count, window size and scroll are still
// there both before and after the page is asked. A pick that cannot be made is not an error: the answer says why and the
// screenshot, its marked area and Ben's note go on as before.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  ANCESTORS_MAX,
  ANCESTOR_MAX,
  ELEMENT_HTML_MAX,
  ELEMENT_TEXT_MAX,
  FRAMES_MAX,
  FRAME_URL_MAX,
  INSPECT_CLASSES_MAX,
  INSPECT_PATH_MAX,
  INSPECT_STEP_MAX,
  SELECTOR_MAX,
  STYLE_VALUE_MAX,
  ELEMENT_STYLE_KEYS,
  elementOf,
  type ElementInspect,
  type ElementPick,
  type ElementStyles,
  type InspectedElement,
  type PickedElement,
} from '@omni/shared/message-context-browser.ts';
import { FORBIDDEN_CLASS } from '@omni/shared/message-context-terminal.ts';
import type { PageObservation } from './browser.ts';
import { staleReason, type CaptureSource } from './browser-capture.ts';
import { pickScript, type RawInspect, type RawPick } from './browser-pick-script.ts';
import { threads } from './db.ts';

/** The part of ChannelBrowser a pick uses, on top of what a capture uses, so a test can stand in for Chrome. */
export interface PickSource extends CaptureSource {
  pick(x: number, y: number): Promise<RawPick | null>;
}

/** The pages captures were taken of, by thread and file name, so a pick can tell if the page is still that one. */
const taken = new Map<string, { page: PageObservation; at: number }>();
const KEEP_MS = 30 * 60_000;
const KEEP_MAX = 64;
const keyOf = (threadId: string, name: string) => `${threadId}/${name}`;

/** Called by a capture that made a screenshot, with the page as it observed it. */
export function remember(threadId: string, name: string, page: PageObservation, now = Date.now()) {
  for (const [k, v] of taken) if (now - v.at > KEEP_MS) taken.delete(k);
  taken.set(keyOf(threadId, name), { page, at: now });
  while (taken.size > KEEP_MAX) taken.delete(taken.keys().next().value!);
}

/** Forgets a capture, once it is deleted. */
export const forget = (threadId: string, name: string) => void taken.delete(keyOf(threadId, name));

const STALE_TEXT = {
  tab: 'The browser switched tabs after the screenshot.',
  navigated: 'The page navigated after the screenshot.',
  viewport: 'The browser was resized after the screenshot.',
  scrolled: 'The page scrolled after the screenshot.',
} as const;
const unavailable = (reason: 'stale' | 'unknown_capture' | 'nothing' | 'unreadable', message: string): ElementPick => ({
  unavailable: { reason, message: `${message} The screenshot and the area you mark still go with your message.` },
});

const FORBIDDEN = new RegExp(FORBIDDEN_CLASS, 'gu');
/** Text as a record holds it: control characters and whitespace runs become one space, cut to `max` with an ellipsis. */
function clean(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const flat = raw.slice(0, max * 4).replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat;
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The page's computed styles, known keys only, each cleaned and cut. Empty values are left out. */
function cleanStyles(raw: unknown): ElementStyles {
  const out: ElementStyles = {};
  if (!isObj(raw)) return out;
  for (const key of ELEMENT_STYLE_KEYS) {
    const v = clean(raw[key], STYLE_VALUE_MAX);
    if (v) out[key] = v;
  }
  return out;
}

/** A box the page reported, outward to whole pixels and clipped to the viewport. Null when none of it is inside. */
function clipBox(raw: unknown, viewport: { width: number; height: number }) {
  if (!isObj(raw)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const left = Math.max(0, Math.floor(num(raw.x)));
  const top = Math.max(0, Math.floor(num(raw.y)));
  const right = Math.min(viewport.width, Math.ceil(num(raw.x) + num(raw.width)));
  const bottom = Math.min(viewport.height, Math.ceil(num(raw.y) + num(raw.height)));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * What the page said, as a record's element: every string cleaned and cut, the box clipped to the viewport, then parsed
 * as the message route will parse it. Null when it is not an element at all, so a page that answers with something else
 * (or a script it has patched) gives no pick.
 */
export function elementFrom(raw: RawPick | null, point: { x: number; y: number }, viewport: { width: number; height: number }): PickedElement | null {
  if (!isObj(raw) || raw.ok !== true) return null;
  // Outward to whole pixels, then inside the viewport.
  const bounds = clipBox(raw.bounds, viewport);
  if (!bounds) return null;
  const styles = cleanStyles(raw.styles);
  const list = (v: unknown, max: number, each: number) => (Array.isArray(v) ? v.slice(0, max).map((s) => clean(s, each)).filter(Boolean) : []);
  const html = clean(raw.html, ELEMENT_HTML_MAX);
  const text = clean(raw.text, ELEMENT_TEXT_MAX);
  const candidate = {
    tag: clean(raw.tag, 40).toLowerCase(),
    selector: clean(raw.selector, SELECTOR_MAX),
    text,
    html,
    ancestors: list(raw.ancestors, ANCESTORS_MAX, ANCESTOR_MAX),
    bounds,
    point,
    frames: list(raw.frames, FRAMES_MAX, FRAME_URL_MAX),
    opaque_frame: raw.opaque === true,
    truncated: raw.truncated === true || (typeof raw.html === 'string' && raw.html.length > ELEMENT_HTML_MAX) || (typeof raw.text === 'string' && raw.text.length > ELEMENT_TEXT_MAX),
    ...(Object.keys(styles).length > 0 && { styles }),
  };
  const parsed = elementOf(candidate, viewport);
  return parsed.ok ? parsed.value : null;
}

/**
 * The element at `point` (CSS pixels from the viewport's top left) on the page `name` was captured of, or why there is
 * none. Never throws for the page: a browser that errors, answers nonsense or moved on is an `unavailable`.
 */
export async function pickElement(src: PickSource, threadId: string, name: string, point: { x: number; y: number }): Promise<ElementPick | 'bad_point'> {
  const shot = taken.get(keyOf(threadId, name));
  if (!shot) return unavailable('unknown_capture', 'This screenshot is too old to look elements up in.');
  const { viewport } = shot.page;
  if (point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height) return 'bad_point';
  if (!src.running) return unavailable('stale', 'The browser is not running any more.');
  try {
    const before = await src.observe();
    const early = staleReason(shot.page, before);
    if (early) return unavailable('stale', STALE_TEXT[early]);
    const raw = await src.pick(point.x, point.y);
    const after = await src.observe();
    const late = staleReason(shot.page, after);
    if (late) return unavailable('stale', STALE_TEXT[late]);
    if (isObj(raw) && raw.ok === false && raw.reason === 'nothing') return unavailable('nothing', 'Nothing could be picked at that spot.');
    const element = elementFrom(raw, point, viewport);
    return element ? { element } : unavailable('unreadable', 'That part of the page could not be read.');
  } catch {
    return unavailable('unreadable', 'That part of the page could not be read.');
  }
}

/** The part of ChannelBrowser the hover inspector uses, so a test can stand in for Chrome. */
export interface InspectSource {
  readonly running: boolean;
  inspect(x: number, y: number): Promise<RawInspect | null>;
}

const noInspect = (reason: 'nothing' | 'unreadable' | 'stopped', message: string): ElementInspect => ({ unavailable: { reason, message } });

/**
 * What the page said is under the pointer, as the inspector shows it: strings cleaned and cut, the box clipped to the
 * viewport the page reported. Null when it is not an element at all.
 */
export function inspectedFrom(raw: RawInspect | null): InspectedElement | null {
  if (!isObj(raw) || raw.ok !== true || !isObj(raw.viewport)) return null;
  const vw = raw.viewport.width;
  const vh = raw.viewport.height;
  if (typeof vw !== 'number' || typeof vh !== 'number' || !(vw >= 1 && vw <= 20_000 && vh >= 1 && vh <= 20_000)) return null;
  const bounds = clipBox(raw.bounds, { width: Math.round(vw), height: Math.round(vh) });
  const tag = clean(raw.tag, 40).toLowerCase();
  if (!bounds || !/^[a-z][a-z0-9-]*$/.test(tag)) return null;
  const box = raw.bounds as Record<string, unknown>;
  const size = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const list = (v: unknown, max: number, each: number) => (Array.isArray(v) ? v.slice(-max).map((s) => clean(s, each)).filter(Boolean) : []);
  return {
    tag,
    id: clean(raw.id, 100),
    classes: list(raw.classes, INSPECT_CLASSES_MAX, 60),
    path: list(raw.path, INSPECT_PATH_MAX, INSPECT_STEP_MAX),
    bounds,
    size: { width: size(box.width), height: size(box.height) },
    styles: cleanStyles(raw.styles),
    opaque_frame: raw.opaque === true,
  };
}

/** The element under the pointer at `point` (CSS pixels from the viewport's top left) of the live page, or why there is none. Never throws for the page. */
export async function inspectElement(src: InspectSource, point: { x: number; y: number }): Promise<ElementInspect> {
  if (!src.running) return noInspect('stopped', 'The browser is not running.');
  try {
    const raw = await src.inspect(point.x, point.y);
    if (isObj(raw) && raw.ok === false && raw.reason === 'nothing') return noInspect('nothing', 'Nothing is under the pointer.');
    const element = inspectedFrom(raw);
    return element ? { element } : noInspect('unreadable', 'That part of the page could not be read.');
  } catch {
    return noInspect('unreadable', 'That part of the page could not be read.');
  }
}

/** POST /api/channels/:id/browser/inspect: the live page under Ben's pointer, for the Annotate overlay's inspector. Reads, never sends. */
export function inspectApi(browserFor: (c: Context) => InspectSource) {
  const api = new Hono();
  api.post('/:id/browser/inspect', async (c) => {
    const body = z.object({ x: z.number().int().min(0).max(100_000), y: z.number().int().min(0).max(100_000) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'x and y are whole CSS pixels.' }, 400);
    return c.json(await inspectElement(browserFor(c), body.data));
  });
  return api;
}

/** POST /api/channels/:id/browser/capture/:name/element, for the channel's own browser session. */
export function pickApi(browserFor: (c: Context) => PickSource) {
  const api = new Hono();
  api.post('/:id/browser/capture/:name/element', async (c) => {
    const body = z.object({ thread: z.string().min(1).max(200), x: z.number().int().min(0).max(100_000), y: z.number().int().min(0).max(100_000) }).parse(await c.req.json());
    const t = threads.get(body.thread);
    if (!t) return c.json({ error: 'not found' }, 404);
    if (t.channel_id !== c.req.param('id')) return c.json({ error: 'That thread is not in this channel.' }, 400);
    const r = await pickElement(browserFor(c), t.id, c.req.param('name'), { x: body.x, y: body.y });
    if (r === 'bad_point') return c.json({ error: 'That spot is outside the screenshot.' }, 400);
    return c.json(r);
  });

  // For a client that shows the page itself (the Mac app's native browser): the script to run in the page at a point...
  api.get('/:id/browser/pick-script', (c) => {
    const q = z.object({ x: z.coerce.number().int().min(0).max(100_000), y: z.coerce.number().int().min(0).max(100_000) }).safeParse(c.req.query());
    if (!q.success) return c.json({ error: 'x and y are whole numbers.' }, 400);
    return c.json({ script: pickScript(q.data.x, q.data.y) });
  });

  // ...and what the page answered, bounded and checked here as it is for the server's own browser.
  api.post('/:id/browser/capture/:name/element/native', async (c) => {
    const body = z
      .object({
        thread: z.string().min(1).max(200),
        x: z.number().int().min(0).max(100_000),
        y: z.number().int().min(0).max(100_000),
        viewport: z.object({ width: z.number().int().min(1).max(20_000), height: z.number().int().min(1).max(20_000) }),
        raw: z.unknown(),
      })
      .parse(await c.req.json());
    const t = threads.get(body.thread);
    if (!t) return c.json({ error: 'not found' }, 404);
    if (t.channel_id !== c.req.param('id')) return c.json({ error: 'That thread is not in this channel.' }, 400);
    if (body.x >= body.viewport.width || body.y >= body.viewport.height) return c.json({ error: 'That spot is outside the screenshot.' }, 400);
    const raw = body.raw as RawPick | null;
    if (isObj(raw) && raw.ok === false && raw.reason === 'nothing') return c.json(unavailable('nothing', 'Nothing could be picked at that spot.'));
    const element = elementFrom(raw, { x: body.x, y: body.y }, body.viewport);
    return c.json(element ? { element } : unavailable('unreadable', 'That part of the page could not be read.'));
  });
  return api;
}
