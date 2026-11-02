// Live Annotate on the desktop app's Web tab (NativeBrowser.tsx), as on the agent's Browser tab
// (BrowserAnnotationOverlay.tsx) and as the Mac app's Web tab did it: the page stays live under a transparent layer,
// the hover and the pick are read from the page itself by the pick preload, the screenshot is the app's own of its
// <webview>, saved by the server as the thread's capture (POST .../browser/capture/native). The record is the same
// browser_annotation, and the card that sends it or adds it to the next message is the Browser tab's.
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { newContext, type MessageContext } from '@omni/shared/message-context.ts';
import {
  RECT_MIN,
  annotate,
  browserAnnotation,
  captureToLive,
  livePointToCapture,
  type BrowserCapture,
  type ElementPick,
  type InspectedElement,
  type LiveFrame,
  type PixelRect,
} from '@omni/shared/message-context-browser.ts';
import { ApiError, api, errorText } from '../api.ts';
import { addDraftContext } from '../message-context/draft.ts';
import type { AnnotateFrom } from './BrowserAnnotate.tsx';
import { ElementInspector, type LiveAnnotate } from './BrowserAnnotationOverlay.tsx';
import { useReplySend } from './Composer.tsx';
import { dragRect, initialLiveAnnotate, liveAnnotateReducer, resolveSelection, type Selection } from './browser-live-annotate.ts';
import { NativeCaptureError } from './native-browser.ts';

/** What live Annotate needs of the Web tab's page (NativeBrowser.tsx `useNativePage`). */
export interface NativePage {
  /** The page's viewport and scroll as last reported, in its CSS pixels. Null until it has said. */
  frame: LiveFrame | null;
  url: string;
  inspect(p: { x: number; y: number }): Promise<InspectedElement | null>;
  /** A screenshot of the page saved as the thread's capture. Throws NativeCaptureError or ApiError. */
  capture(threadId: string): Promise<BrowserCapture>;
  /** The element at `at` (the capture's CSS pixels) of the page `capture` was taken of, while the page is still as it was. */
  pick(capture: BrowserCapture, at: { x: number; y: number }): Promise<ElementPick>;
  /** Moves the page's own pointer, so its hover states show. */
  move(p: { x: number; y: number }): void;
  wheel(p: { x: number; y: number }, deltaX: number, deltaY: number): void;
}

const DRAG_START = 3;
const CAPTURE_RETRIES = 2;

const retryable = (e: unknown) =>
  e instanceof NativeCaptureError ? e.retryable : e instanceof ApiError && !!e.body && typeof e.body === 'object' && (e.body as { retryable?: unknown }).retryable === true;

/**
 * The live Annotate state for the Web tab and a thread. The same states and words as the Browser tab's
 * (`useLiveAnnotate`); only where the page is read and screenshotted differs. A screenshot that is not sent, added or
 * handed to the editor is deleted when the pick is cleared or replaced, or when Annotate turns off.
 */
export function useNativeLiveAnnotate(page: NativePage, channelId: string, threadId: string): LiveAnnotate {
  const [state, dispatch] = useReducer(liveAnnotateReducer, initialLiveAnnotate);
  const base = `/channels/${encodeURIComponent(channelId)}/browser`;
  const sendReply = useReplySend(threadId);
  const latest = useRef(state);
  latest.current = state;
  const pageRef = useRef(page);
  pageRef.current = page;

  const owned = useRef<string | null>(null);
  const current = useRef(0);
  const discard = useCallback(
    (name: string | null | undefined) => {
      if (name) void api.del(`${base}/capture/${encodeURIComponent(name)}?thread=${encodeURIComponent(threadId)}`).catch(() => {});
    },
    [base, threadId],
  );
  const release = useCallback(() => {
    discard(owned.current);
    owned.current = null;
  }, [discard]);
  useEffect(() => release, [release]);

  // One question in flight, and when it answers, the newest point asked since.
  const want = useRef<{ x: number; y: number } | null>(null);
  const asking = useRef(false);
  const ask = useCallback((p: { x: number; y: number }) => pageRef.current.inspect({ x: Math.max(0, Math.floor(p.x)), y: Math.max(0, Math.floor(p.y)) }), []);
  const inspect = useCallback(
    async (p: { x: number; y: number } | null) => {
      want.current = p;
      if (!p) return dispatch({ type: 'hover', hover: null });
      if (asking.current) return;
      asking.current = true;
      while (want.current) {
        const point = want.current;
        const element = await ask(point);
        if (want.current === point) {
          dispatch({ type: 'hover', hover: { point, element } });
          break;
        }
      }
      asking.current = false;
    },
    [ask],
  );

  const capture = useCallback(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await pageRef.current.capture(threadId);
      } catch (e) {
        if (!retryable(e) || attempt >= CAPTURE_RETRIES) throw e;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }, [threadId]);

  const select = useCallback(
    async (kind: Selection['kind'], live: PixelRect, point?: { x: number; y: number }, inspected?: InspectedElement | null) => {
      const frame = pageRef.current.frame;
      if (!frame) return;
      release();
      const seq = ++current.current;
      want.current = null;
      dispatch({ type: 'hover', hover: null });
      dispatch({ type: 'select', seq, kind, live, frame, point, inspected });
      let shot: BrowserCapture;
      try {
        shot = await capture();
      } catch (e) {
        if (current.current === seq) dispatch({ type: 'failed', seq, error: errorText(e) });
        return;
      }
      if (current.current !== seq) return discard(shot.image.name);
      owned.current = shot.image.name;
      let pick: ElementPick | null = null;
      if (kind === 'element' && point) {
        const at = livePointToCapture(point, frame, shot);
        pick = at
          ? await pageRef.current.pick(shot, at).catch(() => null)
          : { unavailable: { reason: 'stale', message: 'The page scrolled before the screenshot. The area you picked still goes.' } };
      }
      if (current.current !== seq) return;
      const r = resolveSelection({ kind, live, frame }, shot, pick);
      if (r.ok) dispatch({ type: 'captured', seq, capture: shot, rect: r.rect, element: r.element, notice: r.notice });
      else dispatch({ type: 'failed', seq, error: r.error });
    },
    [capture, discard, release],
  );

  const pick = useCallback(
    async (p: { x: number; y: number }) => {
      const h = latest.current.hover;
      const near = h && Math.abs(h.point.x - p.x) < 2 && Math.abs(h.point.y - p.y) < 2 ? h.element : undefined;
      const inspected = near === undefined ? await ask(p) : near;
      const box = inspected?.bounds ?? { x: Math.max(0, p.x - 8), y: Math.max(0, p.y - 8), width: 16, height: 16 };
      await select('element', box, p, inspected);
    },
    [ask, select],
  );

  const clear = useCallback(() => {
    current.current++;
    release();
    dispatch({ type: 'clear' });
  }, [release]);

  const record = (note: string): { record: MessageContext; error?: never } | { error: string } => {
    const sel = latest.current.selection;
    if (!sel?.capture || !sel.rect) return { error: 'Wait for the screenshot.' };
    const body = annotate(sel.capture, sel.rect, sel.element ?? undefined);
    return body.ok ? { record: newContext(browserAnnotation, body.value, note) } : { error: body.error };
  };

  const send = useCallback(
    async (note: string) => {
      if (latest.current.busy) return false;
      const r = record('');
      if (r.error !== undefined) return dispatch({ type: 'error', error: r.error }), false;
      dispatch({ type: 'busy', busy: 'sending' });
      try {
        await sendReply(note.trim(), undefined, [], [r.record]);
      } catch (e) {
        dispatch({ type: 'error', error: errorText(e) });
        return false;
      }
      owned.current = null;
      dispatch({ type: 'done', flash: 'Sent' });
      return true;
    },
    [sendReply],
  );

  const add = useCallback(
    (note: string) => {
      const r = record(note.trim());
      if (r.error !== undefined) return dispatch({ type: 'error', error: r.error }), false;
      const why = addDraftContext(threadId, r.record);
      if (why) return dispatch({ type: 'error', error: why }), false;
      owned.current = null;
      dispatch({ type: 'done', flash: 'Added to the message' });
      return true;
    },
    [threadId],
  );

  const handOff = useCallback((): AnnotateFrom | null => {
    const sel = latest.current.selection;
    if (!sel?.capture || !sel.rect) return null;
    current.current++;
    owned.current = null;
    dispatch({ type: 'clear' });
    return { capture: sel.capture, rect: sel.rect, element: sel.element };
  }, []);

  useEffect(() => {
    if (!state.flash) return;
    const t = setTimeout(() => dispatch({ type: 'unflash' }), 2500);
    return () => clearTimeout(t);
  }, [state.flash]);

  return { state, inspect, pick, select, clear, send, add, handOff };
}

function useWidth(box: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);
  return w;
}

const css = (r: PixelRect, s: number): CSSProperties => ({ left: r.x * s, top: r.y * s, width: r.width * s, height: r.height * s });

/**
 * The layer over the Web tab's page while Annotate is on: a hover outlines what is under the pointer and the page keeps
 * its own hover, a click picks, a drag marks an area, the wheel scrolls the page. With Option (Alt) held it steps aside
 * and the page takes the pointer.
 */
export function NativeAnnotateOverlay({ page, box, live, alt }: { page: NativePage; box: RefObject<HTMLDivElement | null>; live: LiveAnnotate; alt: boolean }) {
  const width = useWidth(box);
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: { x: number; y: number }; to: { x: number; y: number }; at: [number, number]; moved: boolean } | null>(null);
  const frame = page.frame;
  const s = frame && width ? width / frame.width : 0;
  const { hover, selection } = live.state;

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(frame!.width - 1, Math.max(0, (e.clientX - r.left) / s)), y: Math.min(frame!.height - 1, Math.max(0, (e.clientY - r.top) / s)) };
  };

  const down = (e: React.PointerEvent) => {
    if (!s || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPage(e);
    setDrag({ from: p, to: p, at: [e.clientX, e.clientY], moved: false });
  };
  const move = (e: React.PointerEvent) => {
    if (!s) return;
    const p = toPage(e);
    if (drag) {
      setDrag({ ...drag, to: p, moved: drag.moved || Math.abs(e.clientX - drag.at[0]) + Math.abs(e.clientY - drag.at[1]) > DRAG_START });
      return;
    }
    if (e.pointerType !== 'mouse') return;
    page.move(p);
    void live.inspect(p);
  };
  const up = (e: React.PointerEvent) => {
    const d = drag;
    setDrag(null);
    if (!d || !s) return;
    if (!d.moved) return void live.pick(toPage(e));
    const r = dragRect(d.from, toPage(e), RECT_MIN);
    if (r) void live.select('area', r);
  };

  // The wheel is the page's: React's onWheel is passive, and the panel must not scroll.
  const pageRef = useRef(page);
  pageRef.current = page;
  const scale = useRef(s);
  scale.current = s;
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const k = scale.current;
      const r = box.current?.getBoundingClientRect();
      if (!k || !r) return;
      e.preventDefault();
      const line = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? r.height : 1;
      pageRef.current.wheel({ x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }, (e.deltaX * line) / k, (e.deltaY * line) / k);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [box]);

  // Scrolling moves the page under a still pointer: ask again what is under it once the page settles.
  const sx = frame?.scroll?.x;
  const sy = frame?.scroll?.y;
  useEffect(() => {
    if (!hover) return;
    const t = setTimeout(() => void live.inspect(hover.point), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sx, sy]);

  const picked =
    selection && frame
      ? selection.capture && selection.rect
        ? captureToLive(selection.rect, selection.capture, frame)
        : { ...selection.live, x: selection.live.x - ((frame.scroll?.x ?? 0) - (selection.frame.scroll?.x ?? 0)), y: selection.live.y - ((frame.scroll?.y ?? 0) - (selection.frame.scroll?.y ?? 0)) }
      : null;
  const navigated = !!selection?.capture && page.url !== selection.capture.url;
  const band = drag?.moved ? dragRect(drag.from, drag.to, 0) : null;
  const showHover = !alt && !drag && hover?.element;

  return (
    <div
      ref={layer}
      data-live-annotate
      className={`absolute inset-0 z-10 touch-none select-none ${alt ? 'pointer-events-none' : 'cursor-crosshair'}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => !drag && void live.inspect(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {s > 0 && picked && !navigated && (
        <span
          data-live-selection
          className="pointer-events-none absolute rounded-[3px] border-2 border-[var(--vermilion)] transition-[left,top,width,height] duration-75"
          style={{ ...css(picked, s), boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.22)' }}
        />
      )}
      {s > 0 && showHover && hover.element && (
        <span
          data-live-hover
          className="pointer-events-none absolute rounded-[2px] border border-dashed border-[var(--vermilion)] bg-[color-mix(in_srgb,var(--vermilion)_9%,transparent)]"
          style={css(hover.element.bounds, s)}
        />
      )}
      {s > 0 && band && <span className="pointer-events-none absolute rounded-[3px] border-2 border-[var(--vermilion)] bg-[color-mix(in_srgb,var(--vermilion)_8%,transparent)]" style={css(band, s)} />}
      {s > 0 && showHover && hover.element && <ElementInspector element={hover.element} at={{ x: hover.point.x * s, y: hover.point.y * s }} bounds={{ width, height: box.current?.clientHeight ?? 0 }} />}
    </div>
  );
}
