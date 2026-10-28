// The live Annotate overlay's state (BrowserAnnotationOverlay.tsx), kept apart from React so it can be tested: what is
// under Ben's pointer, and the one element or area he has picked on the live page. A pick is screenshotted at once, so
// the record describes the page as he saw it however it scrolls afterwards; the record itself is the existing
// browser_annotation (packages/shared/message-context-browser.ts).
import {
  elementRect,
  liveToCapture,
  type BrowserCapture,
  type ElementPick,
  type InspectedElement,
  type LiveFrame,
  type PickedElement,
  type PixelRect,
} from '@omni/shared/message-context-browser.ts';

export interface Hover {
  /** The pointer, in the frame's CSS pixels. */
  point: { x: number; y: number };
  element: InspectedElement | null;
}

export interface Selection {
  /** Which pick this is: an answer for an earlier one is dropped. */
  seq: number;
  kind: 'element' | 'area';
  /** What Ben marked on the frame he saw: the hovered element's box or the dragged area, in that frame's CSS pixels. */
  live: PixelRect;
  frame: LiveFrame;
  /** Where he clicked, for an element. */
  point: { x: number; y: number } | null;
  /** What the inspector showed there, until the page's own answer comes. */
  inspected: InspectedElement | null;
  status: 'capturing' | 'ready' | 'failed';
  capture: BrowserCapture | null;
  /** The record's rectangle, in the capture's CSS pixels. */
  rect: PixelRect | null;
  element: PickedElement | null;
  /** Why a pick gave no element; the area still goes. */
  notice: string | null;
  error: string | null;
}

export interface LiveAnnotateState {
  hover: Hover | null;
  selection: Selection | null;
  seq: number;
  busy: 'sending' | 'adding' | null;
  /** A word that the last send or add went through. */
  flash: string | null;
}

export type LiveAnnotateAction =
  | { type: 'hover'; hover: Hover | null }
  | { type: 'select'; seq: number; kind: Selection['kind']; live: PixelRect; frame: LiveFrame; point?: { x: number; y: number }; inspected?: InspectedElement | null }
  | { type: 'captured'; seq: number; capture: BrowserCapture; rect: PixelRect; element: PickedElement | null; notice: string | null }
  | { type: 'failed'; seq: number; error: string }
  | { type: 'clear' }
  | { type: 'busy'; busy: LiveAnnotateState['busy'] }
  | { type: 'done'; flash: string }
  | { type: 'error'; error: string }
  | { type: 'unflash' };

export const initialLiveAnnotate: LiveAnnotateState = { hover: null, selection: null, seq: 0, busy: null, flash: null };

export function liveAnnotateReducer(s: LiveAnnotateState, a: LiveAnnotateAction): LiveAnnotateState {
  const sel = s.selection;
  switch (a.type) {
    case 'hover':
      return { ...s, hover: a.hover };
    case 'select': {
      const seq = Math.max(a.seq, s.seq + 1);
      const selection: Selection = {
        seq,
        kind: a.kind,
        live: a.live,
        frame: a.frame,
        point: a.point ?? null,
        inspected: a.inspected ?? null,
        status: 'capturing',
        capture: null,
        rect: null,
        element: null,
        notice: null,
        error: null,
      };
      return { ...s, seq, selection, busy: null, flash: null };
    }
    case 'captured':
      if (sel?.seq !== a.seq) return s;
      return { ...s, selection: { ...sel, status: 'ready', capture: a.capture, rect: a.rect, element: a.element, notice: a.notice, error: null } };
    case 'failed':
      if (sel?.seq !== a.seq) return s;
      return { ...s, selection: { ...sel, status: 'failed', error: a.error } };
    case 'clear':
      return { ...s, selection: null, busy: null };
    case 'busy':
      return { ...s, busy: a.busy, selection: sel && { ...sel, error: null } };
    case 'done':
      return { ...s, selection: null, busy: null, flash: a.flash };
    case 'error':
      return { ...s, busy: null, selection: sel && { ...sel, error: a.error } };
    case 'unflash':
      return { ...s, flash: null };
  }
}

export const NO_ELEMENT = 'Element details are unavailable here. The screenshot of the area still goes with your message.';

/**
 * What a selection becomes once its screenshot is in: the record's rectangle and element, or why it cannot be one. An
 * element the page answered for marks its own box; one it could not give falls back to the box the inspector showed,
 * moved onto the screenshot, with the page's reason as a notice.
 */
export function resolveSelection(
  sel: Pick<Selection, 'kind' | 'live' | 'frame'>,
  capture: BrowserCapture,
  pick: ElementPick | null,
): { ok: true; rect: PixelRect; element: PickedElement | null; notice: string | null } | { ok: false; error: string } {
  if (sel.kind === 'element' && pick && 'element' in pick) return { ok: true, rect: elementRect(pick.element.bounds, capture.viewport), element: pick.element, notice: null };
  const rect = liveToCapture(sel.live, sel.frame, capture);
  if (!rect) return { ok: false, error: sel.kind === 'area' ? 'Draw a larger area.' : 'The page scrolled it out of view. Pick it again.' };
  const notice = sel.kind === 'element' ? (pick && 'unavailable' in pick && pick.unavailable.message) || NO_ELEMENT : null;
  return { ok: true, rect, element: null, notice };
}

/** A drag's two corners, in the frame's CSS pixels, as a rectangle; null below `min` either way. */
export function dragRect(a: { x: number; y: number }, b: { x: number; y: number }, min: number): PixelRect | null {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  return width >= min && height >= min ? { x, y, width, height } : null;
}

/** The inspector's first line: `button#go.checkout.primary`. */
export function elementName(e: Pick<InspectedElement, 'tag' | 'id' | 'classes'>) {
  return `${e.tag}${e.id ? `#${e.id}` : ''}${e.classes.map((c) => `.${c}`).join('')}`;
}

/** The styles the inspector lists, as label and value, leaving out what says nothing (no z-index, no padding). */
export function styleRows(styles: InspectedElement['styles']): { label: string; value: string; swatch?: string }[] {
  const rows: { label: string; value: string; swatch?: string }[] = [];
  const blank = (v: string | undefined) => !v || v === '0px' || v === 'auto' || v === 'normal' || v === 'static' || v === 'rgba(0, 0, 0, 0)';
  if (styles.color) rows.push({ label: 'Color', value: styles.color, swatch: styles.color });
  if (!blank(styles.background_color)) rows.push({ label: 'Background', value: styles.background_color!, swatch: styles.background_color });
  const family = styles.font_family?.split(',')[0]?.replace(/["']/g, '').trim();
  const font = [styles.font_size && styles.font_weight ? `${styles.font_size} / ${styles.font_weight}` : styles.font_size, family].filter(Boolean).join(' · ');
  if (font) rows.push({ label: 'Font', value: font });
  const layout = [styles.display, blank(styles.position) ? '' : styles.position].filter(Boolean).join(' · ');
  if (layout) rows.push({ label: 'Display', value: layout });
  if (!blank(styles.padding)) rows.push({ label: 'Padding', value: styles.padding! });
  if (!blank(styles.margin)) rows.push({ label: 'Margin', value: styles.margin! });
  if (!blank(styles.z_index)) rows.push({ label: 'Z-index', value: styles.z_index! });
  return rows;
}
