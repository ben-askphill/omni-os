// Picking an element on a captured page (packages/shared/message-context-browser.ts `element`). Ben taps a spot on the
// screenshot; the server asks the page, through CDP, what is there, and answers with a bounded description of that one
// element. It only answers for the page the screenshot was taken of: the observation the capture made is remembered
// (`remember`), and a pick is refused unless the same tab, address, navigation count, window size and scroll are still
// there both before and after the page is asked. A pick that cannot be made is not an error: the answer says why and the
// screenshot, its marked area and Ben's note go on as before.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { RawInspect, RawPick } from '@omni/shared/browser-pick-script.ts';
import { inspectReply, noInspect, pickReply, pickUnavailable as unavailable } from '@omni/shared/browser-pick-read.ts';
import type { ElementInspect, ElementPick } from '@omni/shared/message-context-browser.ts';
import type { PageObservation } from './browser.ts';
import { staleReason, type CaptureSource } from './browser-capture.ts';
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
    return pickReply(raw, point, viewport);
  } catch {
    return unavailable('unreadable', 'That part of the page could not be read.');
  }
}

/** The part of ChannelBrowser the hover inspector uses, so a test can stand in for Chrome. */
export interface InspectSource {
  readonly running: boolean;
  inspect(x: number, y: number): Promise<RawInspect | null>;
}

/** The element under the pointer at `point` (CSS pixels from the viewport's top left) of the live page, or why there is none. Never throws for the page. */
export async function inspectElement(src: InspectSource, point: { x: number; y: number }): Promise<ElementInspect> {
  if (!src.running) return noInspect('stopped', 'The browser is not running.');
  try {
    return inspectReply(await src.inspect(point.x, point.y));
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
  return api;
}
