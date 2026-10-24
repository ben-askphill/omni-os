// Annotating the channel browser's page for the thread's next message: the server screenshots the real session, the
// screenshot replaces the live view while Ben drags over the part he means, and a note and Add to message put a
// browser_annotation on the draft (packages/shared/message-context-browser.ts). The rectangle is drawn on the very image
// the server took, so nothing the page does afterwards can make it point somewhere else; the page is only read.
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NOTE_MAX, newContext } from '@omni/shared/message-context.ts';
import { RECT_MIN, annotate, browserAnnotation, dragToRect, elementRect, type BrowserCapture, type Drag, type ElementPick, type PickedElement, type PixelRect } from '@omni/shared/message-context-browser.ts';
import { ApiError, api, errorText, uploadUrl } from '../api.ts';
import { addDraftContext } from '../message-context/draft.ts';
import { PickedElementDetails } from '../message-context/picked-element.tsx';
import { ShellCtx } from '../mobile/shell.tsx';
import { Button, ErrorNote, Icon, IconButton } from './ui.tsx';

/** A page the server can capture: the browser is up and shows a web page. */
export const canAnnotate = (s: { running: boolean; url: string } | null | undefined) => !!s?.running && /^https?:\/\//i.test(s.url);

export function AnnotateButton({ state, onClick }: { state: { running: boolean; url: string } | null | undefined; onClick: () => void }) {
  return <IconButton icon="annotate" label="Annotate this page" size={15} disabled={!canAnnotate(state)} onClick={onClick} />;
}

type Phase = { at: 'capturing' } | { at: 'draw'; capture: BrowserCapture } | { at: 'failed'; message: string; retryable: boolean };

/** What the capture route said when it could not: its words, and whether asking again can work. */
function failure(e: unknown): Phase {
  const data = e instanceof ApiError && e.data && typeof e.data === 'object' ? (e.data as { retryable?: unknown }) : {};
  return { at: 'failed', message: errorText(e), retryable: data.retryable === true || (e instanceof ApiError && e.status === 0) };
}

/** The captured screenshot, fitted inside the box it is shown in: its size in CSS pixels per page pixel. */
function useFit(viewport: { width: number; height: number } | null) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = viewport && size.w && size.h ? Math.min(size.w / viewport.width, size.h / viewport.height) : 0;
  return { box, scale, shown: viewport ? { width: viewport.width * scale, height: viewport.height * scale } : { width: 0, height: 0 } };
}

/**
 * Over the browser's page area. It captures when it opens, then shows the screenshot to draw on. Leaving it any way but
 * Add to message deletes the screenshot it made. `onAdded` runs once the record is on the draft.
 */
export function AnnotateLayer({ channelId, threadId, onClose, onAdded }: { channelId: string; threadId: string; onClose: () => void; onAdded: () => void }) {
  const [phase, setPhase] = useState<Phase>({ at: 'capturing' });
  const [attempt, setAttempt] = useState(0);
  const capture = phase.at === 'draw' ? phase.capture : null;
  const base = `/channels/${encodeURIComponent(channelId)}/browser/capture`;
  const added = useRef(false);

  // One capture per attempt. One that lands after the layer closed is discarded, not shown.
  useEffect(() => {
    let live = true;
    setPhase({ at: 'capturing' });
    api
      .post<{ capture: BrowserCapture }>(base, { thread: threadId })
      .then(({ capture: c }) => {
        if (live) setPhase({ at: 'draw', capture: c });
        else void api.del(`${base}/${c.image.name}?thread=${encodeURIComponent(threadId)}`).catch(() => {});
      })
      .catch((e) => live && setPhase(failure(e)));
    return () => {
      live = false;
    };
  }, [base, threadId, attempt]);

  // Whatever ends the layer, a screenshot nothing was made of goes with it.
  const latest = useRef<BrowserCapture | null>(null);
  latest.current = capture;
  useEffect(
    () => () => {
      const c = latest.current;
      if (c && !added.current) void api.del(`${base}/${c.image.name}?thread=${encodeURIComponent(threadId)}`).catch(() => {});
    },
    [base, threadId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div role="dialog" aria-label="Annotate the page" className="absolute inset-0 z-20 flex min-h-0 flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-[12px]">
        <Icon name="annotate" size={13} className="shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 truncate text-fg-2">{phase.at === 'draw' ? 'Tap an element, or drag over the part of the page you mean.' : phase.at === 'capturing' ? 'Capturing the page' : 'Could not capture the page'}</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {phase.at === 'failed' ? (
        <div className="px-3">
          <ErrorNote>{phase.message}</ErrorNote>
          <div className="mt-2 flex justify-end gap-1.5">
            {phase.retryable ? (
              <Button size="sm" variant="primary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            ) : (
              <Button size="sm" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
      ) : phase.at === 'capturing' ? (
        <div className="grid min-h-0 flex-1 place-items-center text-[12.5px] text-fg-3">
          <span className="flex items-center gap-2">
            <span className="pulse h-1.5 w-1.5 rounded-full bg-fg-4" /> Capturing the page
          </span>
        </div>
      ) : (
        <Draw capture={phase.capture} channelId={channelId} threadId={threadId} onClose={onClose} onAdded={() => ((added.current = true), onAdded())} />
      )}
    </div>
  );
}

const DRAG_START = 3;
const NO_ELEMENT = 'Element details are unavailable for this page. Drag over the area instead: the screenshot goes with your message.';

function Draw({ capture, channelId, threadId, onClose, onAdded }: { capture: BrowserCapture; channelId: string; threadId: string; onClose: () => void; onAdded: () => void }) {
  const { viewport } = capture;
  const { box, scale, shown } = useFit(viewport);
  const stage = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [rect, setRect] = useState<PixelRect | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  // The element a tap picked, why a tap gave none, and a counter so a slow answer to an earlier tap is dropped.
  const [element, setElement] = useState<PickedElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const pickId = useRef(0);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.min(r.width, Math.max(0, e.clientX - r.left)), y: Math.min(r.height, Math.max(0, e.clientY - r.top)) };
  };
  const finish = useCallback(
    (d: Drag) => {
      const r = dragToRect(d, shown, viewport);
      // A dragged area is all Ben marked: an element picked before it no longer describes it.
      pickId.current++;
      setPicking(false);
      setElement(null);
      setNotice(null);
      if (!r.ok) {
        setRect(null);
        setError(r.error);
      } else {
        setRect(r.value);
        setError(null);
        requestAnimationFrame(() => noteRef.current?.focus());
      }
    },
    [shown, viewport],
  );

  // A tap, not a drag: ask the page what is there. Whatever it cannot give leaves the screenshot as it is, says why, and a drag still works.
  const pick = (p: { x: number; y: number }) => {
    const id = ++pickId.current;
    const x = Math.min(viewport.width - 1, Math.max(0, Math.floor(p.x / scale)));
    const y = Math.min(viewport.height - 1, Math.max(0, Math.floor(p.y / scale)));
    setPicking(true);
    setError(null);
    api
      .post<ElementPick>(`/channels/${encodeURIComponent(channelId)}/browser/capture/${encodeURIComponent(capture.image.name)}/element`, { thread: threadId, x, y })
      .catch((): ElementPick => ({ unavailable: { reason: 'unreadable', message: NO_ELEMENT } }))
      .then((r) => {
        if (id !== pickId.current) return;
        setPicking(false);
        if ('element' in r) {
          setElement(r.element);
          setNotice(null);
          setRect(elementRect(r.element.bounds, viewport));
          requestAnimationFrame(() => noteRef.current?.focus());
        } else {
          setElement(null);
          setNotice(r.unavailable.message || NO_ELEMENT);
        }
      });
  };

  const add = () => {
    if (!rect) return;
    const body = annotate(capture, rect, element ?? undefined);
    if (!body.ok) return setError(body.error);
    const why = addDraftContext(threadId, newContext(browserAnnotation, body.value, note));
    if (why) return setError(why);
    onAdded();
  };

  // What is drawn, in the shown image's pixels: the drag in progress, else the rectangle in page pixels.
  const outline = drag
    ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
    : rect
      ? { x: rect.x * scale, y: rect.y * scale, w: rect.width * scale, h: rect.height * scale }
      : null;

  return (
    <>
      <div ref={box} className="relative flex min-h-0 flex-1 items-start justify-center overflow-hidden px-3">
        <div
          ref={stage}
          aria-label="Screenshot of the page. Drag to mark an area."
          role="img"
          className="relative shrink-0 cursor-crosshair touch-none overflow-hidden rounded-lg select-none"
          style={{ width: shown.width || undefined, height: shown.height || undefined }}
          onPointerDown={(e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = at(e);
            setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            setMoved(false);
            setError(null);
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const p = at(e);
            setDrag({ ...drag, x1: p.x, y1: p.y });
            if (Math.abs(p.x - drag.x0) + Math.abs(p.y - drag.y0) > DRAG_START) setMoved(true);
          }}
          onPointerUp={(e) => {
            if (!drag) return;
            const d = drag;
            setDrag(null);
            if (moved) finish(d);
            else pick(at(e));
          }}
          onPointerCancel={() => setDrag(null)}
        >
          <img
            src={uploadUrl(threadId, capture.image)}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 block h-full w-full"
            style={{ imageRendering: 'auto' }}
          />
          {outline ? (
            <span
              className="pointer-events-none absolute rounded-[3px] border-2 border-[var(--vermilion,#ff4b2b)]"
              style={{ left: outline.x, top: outline.y, width: outline.w, height: outline.h, boxShadow: '0 0 0 9999px rgba(0,0,0,0.42)' }}
            />
          ) : (
            <span className="pointer-events-none absolute inset-0 bg-black/10" />
          )}
        </div>
      </div>
      <div className="shrink-0 px-3 pt-2 pb-3">
        {rect ? (
          <>
            <textarea
              ref={noteRef}
              value={note}
              maxLength={NOTE_MAX}
              rows={1}
              aria-label="Note for the agent"
              placeholder="What about this?"
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  add();
                }
              }}
              className="block w-full resize-none rounded-xl bg-surface px-3 py-2 text-[16px] leading-[1.45] outline-none placeholder:text-fg-4 focus:shadow-[inset_0_0_0_1px_var(--line-strong)] sm:text-[13px]"
            />
            {element && <PickedElementDetails element={element} />}
            {notice && <div className="mt-2 text-[11.5px] text-fg-3">{notice}</div>}
            {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  pickId.current++;
                  setPicking(false);
                  setRect(null);
                  setElement(null);
                  setNotice(null);
                  setError(null);
                }}
              >
                Redraw
              </Button>
              <Button size="sm" variant="primary" icon="plus" onClick={add}>
                Add to message
              </Button>
            </div>
          </>
        ) : (
          <>
            {error && <ErrorNote>{error}</ErrorNote>}
            {notice && <div className="mt-1 text-[11.5px] text-fg-3">{notice}</div>}
            <div className="mt-1 text-[11.5px] text-fg-4">
              {error ? '' : picking ? 'Looking at the page…' : `Tap an element to pick it, or drag an area of at least ${RECT_MIN} by ${RECT_MIN} page pixels. The page itself is not touched.`}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** After Add to message: the phone goes back to the thread, where the composer shows it; the desktop focuses the reply box. */
export function useAfterAdd(close: () => void) {
  const shell = useContext(ShellCtx);
  return useCallback(() => {
    close();
    if (shell) shell.back();
    else requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-reply-composer]')?.focus());
  }, [close, shell]);
}
