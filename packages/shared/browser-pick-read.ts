// What the page scripts (browser-pick-script.ts) answered, as the panels show it and the record holds it. The answer is
// the page's own data, so every string is cleaned and cut and every box clipped, then the element is parsed as the
// message route will parse it. Both browsers read their page's answers here: the server for the channel's Chrome
// (apps/server/browser-pick.ts), the Mac app for its Web tab through JavaScriptCore (apps/mac/browser-pick/entry.ts),
// so the same answer gives the same element, styles and words on either.
import type { RawInspect, RawPick } from './browser-pick-script.ts';
import {
  ANCESTORS_MAX,
  ANCESTOR_MAX,
  ELEMENT_HTML_MAX,
  ELEMENT_STYLE_KEYS,
  ELEMENT_TEXT_MAX,
  FRAMES_MAX,
  FRAME_URL_MAX,
  INSPECT_CLASSES_MAX,
  INSPECT_PATH_MAX,
  INSPECT_STEP_MAX,
  SELECTOR_MAX,
  STYLE_VALUE_MAX,
  elementOf,
  type ElementInspect,
  type ElementPick,
  type ElementStyles,
  type ElementUnavailable,
  type InspectedElement,
  type PickedElement,
} from './message-context-browser.ts';
import { FORBIDDEN_CLASS } from './message-context-terminal.ts';

/** Why a pick gave no element, in words that say the screenshot and the area still go. */
export const pickUnavailable = (reason: ElementUnavailable, message: string): ElementPick => ({
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

/** The answer to a pick from what the page said at `point` of a `viewport` the screenshot was taken at. */
export function pickReply(raw: RawPick | null, point: { x: number; y: number }, viewport: { width: number; height: number }): ElementPick {
  if (isObj(raw) && raw.ok === false && raw.reason === 'nothing') return pickUnavailable('nothing', 'Nothing could be picked at that spot.');
  const element = elementFrom(raw, point, viewport);
  return element ? { element } : pickUnavailable('unreadable', 'That part of the page could not be read.');
}

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

export const noInspect = (reason: 'nothing' | 'unreadable' | 'stopped', message: string): ElementInspect => ({ unavailable: { reason, message } });

/** The answer to a hover from what the page said under the pointer. */
export function inspectReply(raw: RawInspect | null): ElementInspect {
  if (isObj(raw) && raw.ok === false && raw.reason === 'nothing') return noInspect('nothing', 'Nothing is under the pointer.');
  const element = inspectedFrom(raw);
  return element ? { element } : noInspect('unreadable', 'That part of the page could not be read.');
}
