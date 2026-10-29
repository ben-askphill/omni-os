// Live Annotate: marking the channel browser's page while it stays live. With Annotate on, the page is covered by a
// transparent layer: hovering shows what element is under the pointer (the server asks the page, browser-pick.ts
// `inspectApi`), a click picks it and a drag marks an area. Moves, scrolling and keys still reach the page, and holding
// Option takes the layer away so a click does too. A pick is screenshotted at once (browser-capture.ts), so the
// browser_annotation it becomes describes the page as Ben saw it, and a card sends it to the thread or adds it to the
// next message. The screenshot-first editor (BrowserAnnotate.tsx) is one click away for pen, shapes and text.
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import { NOTE_MAX, newContext, type MessageContext } from '@omni/shared/message-context.ts';
import {
  RECT_MIN,
  annotate,
  browserAnnotation,
  captureToLive,
  livePointToCapture,
  type BrowserCapture,
  type ElementInspect,
  type ElementPick,
  type InspectedElement,
  type LiveFrame,
  type PixelRect,
} from '@omni/shared/message-context-browser.ts';
import { ApiError, api, errorText, uploadUrl } from '../api.ts';
import { addDraftContext } from '../message-context/draft.ts';
import { PickedElementDetails } from '../message-context/picked-element.tsx';
import type { AnnotateFrom } from './BrowserAnnotate.tsx';
import { useReplySend } from './Composer.tsx';
import type { Browser } from './LiveBrowser.tsx';
import { dragRect, elementName, initialLiveAnnotate, liveAnnotateReducer, resolveSelection, styleRows, type Selection } from './browser-live-annotate.ts';
import { Button, ErrorNote, Icon, IconButton, Kbd } from './ui.tsx';

/** A press that moves less than this many screen pixels is a click. */
const DRAG_START = 3;
/** How many times a screenshot is tried again when the page moved while it was taken. */
const CAPTURE_RETRIES = 2;

/** The newest frame's scroll, re-rendering only when it changes. Undefined until a frame says. */
function useFrameScroll(b: Browser) {
  return useSyncExternalStore(
    b.scroll.subscribe,
    () => b.frame.current?.scroll,
    () => undefined,
  );
}

/** The frame being shown, as the geometry wants it. */
const liveFrame = (b: Browser): LiveFrame | null => {
  const f = b.frame.current;
  return f ? { width: f.width, height: f.height, ...(f.scroll && { scroll: f.scroll }) } : null;
};

/**
 * The live Annotate state for one channel browser and thread: the inspector's newest answer, the current pick and its
 * screenshot, and sending it. A screenshot that is not sent, added or handed to the editor is deleted when the pick is
 * cleared or replaced, or when Annotate turns off.
 */
export function useLiveAnnotate(b: Browser, channelId: string, threadId: string) {
  const [state, dispatch] = useReducer(liveAnnotateReducer, initialLiveAnnotate);
  const base = `/channels/${encodeURIComponent(channelId)}/browser`;
  const sendReply = useReplySend(threadId);
  const latest = useRef(state);
  latest.current = state;

  // The screenshot the current pick owns, deleted unless it goes somewhere, and which pick is current: kept here and
  // not read from state, which an answer can land before React has rendered.
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

  // The inspector: one question in flight, and when it answers, the newest point asked since.
  const want = useRef<{ x: number; y: number } | null>(null);
  const asking = useRef(false);
  const ask = useCallback(
    async (p: { x: number; y: number }) => {
      const r = await api.post<ElementInspect>(`${base}/inspect`, { x: Math.max(0, Math.floor(p.x)), y: Math.max(0, Math.floor(p.y)) }).catch(() => null);
      return r && 'element' in r ? r.element : null;
    },
    [base],
  );
  const inspect = useCallback(
    async (p: { x: number; y: number } | null) => {
      want.current = p;
      if (!p) return dispatch({ type: 'hover', hover: null });
      if (asking.current) return;
      asking.current = true;
      while (want.current) {
        const point = want.current;
        const element = await ask(point);
        // Moved away, or left, while the page answered: ask again for where the pointer is now.
        if (want.current === point) {
          dispatch({ type: 'hover', hover: { point, element } });
          break;
        }
      }
      asking.current = false;
    },
    [ask],
  );

  /** A screenshot of the page, tried again while the page is moving. */
  const capture = useCallback(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await api.post<{ capture: BrowserCapture }>(`${base}/capture`, { thread: threadId })).capture;
      } catch (e) {
        const retryable = e instanceof ApiError && !!e.body && typeof e.body === 'object' && (e.body as { retryable?: unknown }).retryable === true;
        if (!retryable || attempt >= CAPTURE_RETRIES) throw e;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }, [base, threadId]);

  /** Marks what Ben picked or dragged, screenshots the page and, for an element, asks the page about it there. */
  const select = useCallback(
    async (kind: Selection['kind'], live: PixelRect, point?: { x: number; y: number }, inspected?: InspectedElement | null) => {
      const frame = liveFrame(b);
      if (!frame) return;
      release();
      const seq = ++current.current;
      // The pick's outline replaces the hover's until the pointer moves on.
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
          ? await api.post<ElementPick>(`${base}/capture/${encodeURIComponent(shot.image.name)}/element`, { thread: threadId, ...at }).catch(() => null)
          : { unavailable: { reason: 'stale', message: 'The page scrolled before the screenshot. The area you picked still goes.' } };
      }
      if (current.current !== seq) return;
      const r = resolveSelection({ kind, live, frame }, shot, pick);
      if (r.ok) dispatch({ type: 'captured', seq, capture: shot, rect: r.rect, element: r.element, notice: r.notice });
      else dispatch({ type: 'failed', seq, error: r.error });
    },
    [b, base, capture, discard, release, threadId],
  );

  /** A click: the element the inspector showed there, or the page's answer to a fresh question when it showed none. */
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

  /** The record of the current pick, or why there is none yet. */
  const record = (note: string): { record: MessageContext; error?: never } | { error: string } => {
    const sel = latest.current.selection;
    if (!sel?.capture || !sel.rect) return { error: 'Wait for the screenshot.' };
    const body = annotate(sel.capture, sel.rect, sel.element ?? undefined);
    return body.ok ? { record: newContext(browserAnnotation, body.value, note) } : { error: body.error };
  };

  /** Sends it to the thread now: Ben's words as the message, the annotation as its context. */
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

  /** Puts it on the thread's next message with the note, as the screenshot editor does. */
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

  /** Gives the pick and its screenshot to the screenshot editor, which owns it from then on. */
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

export type LiveAnnotate = ReturnType<typeof useLiveAnnotate>;

/** The box's width, so the overlay redraws at the new scale when the panel is resized. */
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

/** True while Option is held: the layer steps aside and the page takes the pointer. */
function useAltHeld() {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Alt' && setAlt(e.type === 'keydown');
    const off = () => setAlt(false);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return alt;
}

const css = (r: PixelRect, s: number): CSSProperties => ({ left: r.x * s, top: r.y * s, width: r.width * s, height: r.height * s });

/**
 * The layer over the page, inside the page's own box so keys and scrolling still reach it. `drive`: forward pointer
 * moves to the page and show the inspector on hover (the desktop panel); the phone only watches, so it only picks.
 */
export function LiveAnnotateOverlay({ b, box, live, drive }: { b: Browser; box: RefObject<HTMLDivElement | null>; live: LiveAnnotate; drive: boolean }) {
  const width = useWidth(box);
  const scroll = useFrameScroll(b);
  const alt = useAltHeld();
  const [drag, setDrag] = useState<{ from: { x: number; y: number }; to: { x: number; y: number }; at: [number, number]; moved: boolean } | null>(null);
  const f = b.frame.current;
  const s = f && width ? width / f.width : 0;
  const { hover, selection } = live.state;

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(f!.width - 1, Math.max(0, (e.clientX - r.left) / s)), y: Math.min(f!.height - 1, Math.max(0, (e.clientY - r.top) / s)) };
  };

  const down = (e: React.PointerEvent) => {
    if (!s || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    if (drive) box.current?.focus();
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
    if (!drive || e.pointerType !== 'mouse') return;
    b.input({ type: 'mouse', event: 'mouseMoved', x: Math.round(p.x), y: Math.round(p.y), button: 'none', buttons: 0, clickCount: 0, modifiers: 0 });
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

  // Scrolling moves the page under a still pointer: ask again what is under it once the page settles.
  useEffect(() => {
    if (!drive || !hover) return;
    const t = setTimeout(() => void live.inspect(hover.point), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroll?.x, scroll?.y]);

  const frame: LiveFrame | null = f ? { width: f.width, height: f.height, ...(scroll && { scroll }) } : null;
  // The pick's outline on the page as it is now: from the screenshot once there is one, else from where it was marked.
  const picked =
    selection && frame
      ? selection.capture && selection.rect
        ? captureToLive(selection.rect, selection.capture, frame)
        : { ...selection.live, x: selection.live.x - ((frame.scroll?.x ?? 0) - (selection.frame.scroll?.x ?? 0)), y: selection.live.y - ((frame.scroll?.y ?? 0) - (selection.frame.scroll?.y ?? 0)) }
      : null;
  const navigated = !!selection?.capture && !!b.state && b.state.url !== selection.capture.url;
  const band = drag?.moved ? dragRect(drag.from, drag.to, 0) : null;
  const showHover = drive && !alt && !drag && hover?.element;

  return (
    <div
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

/** The tooltip by the pointer: what the element is, where it sits, and how it is styled. Page text is shown as text. */
export function ElementInspector({ element: e, at, bounds }: { element: InspectedElement; at: { x: number; y: number }; bounds: { width: number; height: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (el.offsetWidth !== size.w || el.offsetHeight !== size.h)) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  });
  // Below and right of the pointer, flipped where it would leave the page.
  const gap = 14;
  const left = at.x + gap + size.w > bounds.width ? Math.max(4, at.x - gap - size.w) : at.x + gap;
  const top = at.y + gap + size.h > bounds.height ? Math.max(4, at.y - gap - size.h) : at.y + gap;
  const rows = styleRows(e.styles);
  return (
    <div
      ref={ref}
      role="tooltip"
      data-element-inspector
      className="pointer-events-none absolute z-20 w-max max-w-[min(300px,calc(100%-8px))] rounded-[var(--r-sm)] bg-elev px-[var(--sp-6)] py-[var(--sp-4)] text-[length:var(--fs-code)] leading-[var(--lh-body)] text-fg-2 shadow-[var(--shadow-menu)]"
      style={{ left, top, visibility: size.w ? 'visible' : 'hidden' }}
    >
      <div className="flex items-baseline gap-[var(--sp-4)]">
        <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-12)] text-fg">{elementName(e)}</span>
        <span className="shrink-0 font-num text-fg-4">{`${e.size.width} × ${e.size.height}`}</span>
      </div>
      {e.path.length > 1 && (
        <div className="mt-[var(--sp-1)] truncate text-left font-mono text-[length:var(--fs-label)] text-fg-4" dir="rtl" title={e.path.join(' › ')}>
          <bdi>{e.path.join(' › ')}</bdi>
        </div>
      )}
      {e.opaque_frame && <div className="mt-[var(--sp-2)] text-fg-3">A frame from another site. Its contents cannot be read.</div>}
      {rows.length > 0 && (
        <dl className="mt-[var(--sp-3)] grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--sp-6)] gap-y-[var(--sp-1)] border-t border-line pt-[var(--sp-3)]">
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-fg-4">{r.label}</dt>
              <dd className="m-0 flex min-w-0 items-center gap-[var(--sp-3)] font-mono text-[length:var(--fs-meta)]">
                {r.swatch && <span className="h-2.5 w-2.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_var(--line-strong)]" style={{ background: r.swatch }} />}
                <span className="truncate">{r.value}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** The screenshot cropped to what was picked: exactly what goes with the message. */
function Crop({ threadId, capture, rect }: { threadId: string; capture: BrowserCapture; rect: PixelRect }) {
  const k = Math.min(88 / rect.width, 64 / rect.height, 1.5);
  return (
    <span className="relative block shrink-0 overflow-hidden rounded-[var(--r-xs)] bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]" style={{ width: Math.max(24, rect.width * k), height: Math.max(24, rect.height * k) }}>
      <img
        src={uploadUrl(threadId, capture.image)}
        alt="What goes with the message"
        draggable={false}
        className="absolute max-w-none"
        style={{ width: capture.viewport.width * k, height: capture.viewport.height * k, left: -rect.x * k, top: -rect.y * k }}
      />
    </span>
  );
}

/**
 * What sits over the page while Annotate is on, outside its box so typing here never reaches the page: along the bottom,
 * the hint, or once something is picked, its card with Send, Add to message and Draw.
 */
export function LiveAnnotateCard({ live, threadId, onDraw, onDone, onSent, phone }: { live: LiveAnnotate; threadId: string; onDraw: () => void; onDone: () => void; onSent?: () => void; phone?: boolean }) {
  const { selection: sel, busy, flash } = live.state;
  const [note, setNote] = useState('');
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const ready = sel?.status === 'ready';
  useEffect(() => {
    if (!sel) setNote('');
  }, [sel]);
  useEffect(() => {
    if (ready && !phone) noteRef.current?.focus();
  }, [ready, phone]);

  // Escape clears the pick, then turns Annotate off. It never reaches the page while Annotate is on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // The address bar's Escape is its own.
      if (e.key !== 'Escape' || t?.tagName === 'INPUT') return;
      e.preventDefault();
      e.stopPropagation();
      if (live.state.selection) live.clear();
      else onDone();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [live, onDone]);

  const send = async () => {
    if (await live.send(note)) onSent?.();
  };
  const add = () => {
    if (live.add(note)) onSent?.();
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-[var(--sp-6)]">
      {!sel ? (
        <div className="pointer-events-auto flex max-w-full items-center gap-[var(--sp-4)] rounded-[var(--r-pill)] bg-elev py-[var(--sp-2)] pr-[var(--sp-2)] pl-[var(--sp-6)] text-[length:var(--fs-12)] text-fg-2 shadow-[var(--shadow-menu)]" data-live-annotate-hint>
          <Icon name="annotate" size={13} className="shrink-0 text-fg-3" />
          <span className="min-w-0 truncate">
            {flash ?? (phone ? 'Tap an element or drag an area' : 'Click an element or drag an area')}
            {!flash && !phone && (
              <span className="text-fg-4">
                {' · '}
                <Kbd>⌥</Kbd> click uses the page
              </span>
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      ) : (
        <div
          role="group"
          aria-label="What you picked"
          data-live-annotate-card
          className="@container pointer-events-auto w-full max-w-[440px] min-w-0 rounded-[var(--r-md)] bg-elev p-[var(--sp-6)] text-[length:var(--fs-small)] shadow-[var(--shadow-menu)]"
          onKeyDown={(e) => e.stopPropagation()}
        >
          {/* Its width is the panel's, never its content's. Narrower than 22rem inside, the crop and Clear sit above the
              details, which then have the whole width. */}
          <div className="flex items-start gap-[var(--sp-6)] @max-[22rem]:flex-wrap @max-[22rem]:gap-[var(--sp-4)]">
            {ready && sel.capture && sel.rect ? (
              <Crop threadId={threadId} capture={sel.capture} rect={sel.rect} />
            ) : (
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--r-xs)] bg-surface-2">
                {sel.status === 'capturing' ? <span className="pulse h-1.5 w-1.5 rounded-[var(--r-pill)] bg-fg-4" /> : <Icon name="alert" size={14} className="text-fg-3" />}
              </span>
            )}
            <div className="min-w-0 flex-1 @max-[22rem]:order-last @max-[22rem]:basis-full">
              {sel.element ? (
                <PickedElementDetails element={sel.element} className="" />
              ) : (
                <>
                  <div className="truncate font-mono text-[length:var(--fs-12)] text-fg">
                    {sel.kind === 'element' && sel.inspected ? elementName(sel.inspected) : sel.rect ? `Area ${sel.rect.width}×${sel.rect.height}` : 'Area'}
                  </div>
                  <div className="mt-[var(--sp-1)] text-[length:var(--fs-code)] text-fg-3">
                    {sel.status === 'capturing' ? 'Taking the screenshot' : sel.status === 'failed' ? 'Could not take the screenshot' : 'The screenshot of this area goes with your message.'}
                  </div>
                </>
              )}
            </div>
            <IconButton icon="x" label="Clear" size={13} className="-mt-[var(--sp-2)] -mr-[var(--sp-2)] h-7 w-7 @max-[22rem]:ml-auto" onClick={live.clear} />
          </div>
          {sel.notice && <div className="mt-[var(--sp-4)] text-[length:var(--fs-code)] text-fg-3">{sel.notice}</div>}
          {sel.error && <ErrorNote className="mt-[var(--sp-4)]">{sel.error}</ErrorNote>}
          {sel.status !== 'failed' && (
            <textarea
              ref={noteRef}
              value={note}
              maxLength={NOTE_MAX}
              rows={1}
              aria-label="What about it?"
              placeholder="What about this?"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (ready) void send();
                }
              }}
              className="mt-[var(--sp-5)] block w-full resize-none rounded-[var(--r-sm)] bg-surface px-[var(--sp-6)] py-[var(--sp-4)] text-[length:var(--fs-input)] leading-[var(--lh-body)] outline-none placeholder:text-fg-4 focus:shadow-[inset_0_0_0_1px_var(--line-strong)] sm:text-[length:var(--fs-ui)]"
            />
          )}
          {/* Where the three don't fit on one line, Add to message and Send go above Draw. */}
          <div className="mt-[var(--sp-4)] flex flex-wrap-reverse items-center justify-end gap-[var(--sp-3)]">
            {sel.status === 'failed' ? (
              <Button size="sm" variant="primary" onClick={() => void live.select(sel.kind, sel.live, sel.point ?? undefined, sel.inspected)}>
                Try again
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" icon="pencil" className="mr-auto" disabled={!ready || !!busy} onClick={onDraw}>
                  Draw
                </Button>
                <span className="flex flex-wrap justify-end gap-[var(--sp-3)]">
                  <Button size="sm" icon="plus" disabled={!ready || !!busy} onClick={add}>
                    Add to message
                  </Button>
                  <Button size="sm" variant="primary" icon="send" disabled={!ready} busy={busy === 'sending'} onClick={() => void send()}>
                    Send
                  </Button>
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
