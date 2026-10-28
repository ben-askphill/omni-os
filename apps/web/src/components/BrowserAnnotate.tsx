// Annotating the channel browser's page for the thread's next message: the server screenshots the real session, the
// screenshot replaces the live view while Ben marks it up (pen, shapes, text, or a tap or drag to pick an element or area), and a
// note and Add to message put a browser_annotation on the draft (packages/shared/message-context-browser.ts). The rectangle is drawn on the very image
// the server took, so nothing the page does afterwards can make it point somewhere else; the page is only read.
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NOTE_MAX, newContext } from '@omni/shared/message-context.ts';
import { RECT_MIN, annotate, browserAnnotation, dragToRect, elementRect, type AnnotationImage, type BrowserCapture, type Drag, type ElementPick, type PickedElement, type PixelRect } from '@omni/shared/message-context-browser.ts';
import {
  DEFAULT_MARK_COLOR,
  DEFAULT_MARK_STROKE,
  MARKS_MAX,
  MARK_TEXT_MAX,
  dragToMark,
  markAt,
  marksRect,
  moveMark,
  strokeToMark,
  textSize,
  textToMark,
  toPage,
  type Mark,
  type MarkShape,
  type MarkStyle,
} from '@omni/shared/message-context-marks.ts';
import { ApiError, api, errorText, uploadUrl } from '../api.ts';
import { addDraftContext } from '../message-context/draft.ts';
import { PickedElementDetails } from '../message-context/picked-element.tsx';
import { ShellCtx } from '../mobile/shell.tsx';
import { MarkToolbar, isShape, type Tool } from './BrowserMarkToolbar.tsx';
import { drawMarks, renderMarked } from './browser-marks-canvas.ts';
import { Button, ErrorNote, Icon, IconButton } from './ui.tsx';

/** A page the server can capture: the browser is up and shows a web page. */
export const canAnnotate = (s: { running: boolean; url: string } | null | undefined) => !!s?.running && /^https?:\/\//i.test(s.url);

/** Turns live Annotate on and off (BrowserAnnotationOverlay.tsx). */
export function AnnotateButton({ state, active, onClick }: { state: { running: boolean; url: string } | null | undefined; active?: boolean; onClick: () => void }) {
  return (
    <IconButton
      icon="annotate"
      label={active ? 'Stop annotating' : 'Annotate this page'}
      aria-pressed={!!active}
      size={15}
      active={active}
      disabled={!canAnnotate(state)}
      onClick={onClick}
      className={active ? 'bg-surface-3' : ''}
    />
  );
}

type Phase = { at: 'capturing' } | { at: 'draw'; capture: BrowserCapture } | { at: 'failed'; message: string; retryable: boolean };

/** A pick made on the live page (BrowserAnnotationOverlay.tsx), to draw on: its screenshot, which this layer then owns, and what was picked. */
export interface AnnotateFrom {
  capture: BrowserCapture;
  rect: PixelRect;
  element: PickedElement | null;
}

/** What the capture route said when it could not: its words, and whether asking again can work. */
function failure(e: unknown): Phase {
  const data = e instanceof ApiError && e.body && typeof e.body === 'object' ? (e.body as { retryable?: unknown }) : {};
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
 * Add to message deletes the screenshot it made. `onAdded` runs once the record is on the draft. `from` starts it on a
 * live pick's screenshot instead, with the pick marked.
 */
export function AnnotateLayer({ channelId, threadId, onClose, onAdded, from }: { channelId: string; threadId: string; onClose: () => void; onAdded: () => void; from?: AnnotateFrom }) {
  const [phase, setPhase] = useState<Phase>(() => (from ? { at: 'draw', capture: from.capture } : { at: 'capturing' }));
  const [attempt, setAttempt] = useState(0);
  const capture = phase.at === 'draw' ? phase.capture : null;
  const base = `/channels/${encodeURIComponent(channelId)}/browser/capture`;
  const added = useRef(false);

  // One capture per attempt. One that lands after the layer closed is discarded, not shown.
  // A live pick's screenshot is the first attempt's.
  const given = !!from;
  useEffect(() => {
    if (given && attempt === 0) return;
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
  }, [base, threadId, attempt, given]);

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
      // Escape in the text box being typed in cancels that text, not the whole layer.
      if (e.key !== 'Escape' || (e.target as HTMLElement | null)?.hasAttribute?.('data-mark-text')) return;
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
        <span className="min-w-0 flex-1 truncate text-fg-2">{phase.at === 'draw' ? 'Mark up the page.' : phase.at === 'capturing' ? 'Capturing the page' : 'Could not capture the page'}</span>
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
        <Draw capture={phase.capture} channelId={channelId} threadId={threadId} onClose={onClose} onAdded={() => ((added.current = true), onAdded())} from={from?.capture === phase.capture ? from : undefined} />
      )}
    </div>
  );
}

const DRAG_START = 3;
const NO_ELEMENT = 'Element details are unavailable for this page. Drag over the area instead: the screenshot goes with your message.';
/** How far from a mark's line, in CSS pixels, a tap still grabs it. */
const GRAB = 6;

type Gesture =
  | { kind: 'area'; drag: Drag; moved: boolean }
  | { kind: 'pen'; path: [number, number][] }
  | { kind: 'shape'; drag: Drag }
  | { kind: 'move'; index: number; from: [number, number]; was: Mark };

function Draw({ capture, channelId, threadId, onClose, onAdded, from }: { capture: BrowserCapture; channelId: string; threadId: string; onClose: () => void; onAdded: () => void; from?: AnnotateFrom }) {
  const { viewport } = capture;
  const { box, scale, shown } = useFit(viewport);
  const stage = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [rect, setRect] = useState<PixelRect | null>(from?.rect ?? null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The element a tap picked, why a tap gave none, and a counter so a slow answer to an earlier tap is dropped.
  const [element, setElement] = useState<PickedElement | null>(from?.element ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const pickId = useRef(0);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // The marks, the tool and its style, the mark selected, the gesture in progress and the text being typed.
  const [tool, setTool] = useState<Tool>('select');
  const [shape, setShape] = useState<MarkShape>('rect');
  const [color, setColor] = useState<string>(DEFAULT_MARK_COLOR);
  const [stroke, setStroke] = useState<number>(DEFAULT_MARK_STROKE);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [selected, setSelected] = useState(-1);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [typing, setTyping] = useState<{ x: number; y: number; text: string } | null>(null);
  const style = { color: color as MarkStyle['color'], stroke };

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stage.current!.getBoundingClientRect();
    return [Math.min(r.width, Math.max(0, e.clientX - r.left)), Math.min(r.height, Math.max(0, e.clientY - r.top))];
  };
  const page = (p: readonly [number, number]) => toPage(p[0], p[1], shown, viewport);
  const asDrag = ([x0, y0]: readonly [number, number], [x1, y1]: readonly [number, number]): Drag => ({ x0, y0, x1, y1 });

  const clearPick = () => {
    pickId.current++;
    setPicking(false);
    setElement(null);
    setNotice(null);
  };
  const finishArea = useCallback(
    (d: Drag) => {
      const r = dragToRect(d, shown, viewport);
      // A dragged area is all Ben marked: an element picked before it no longer describes it.
      clearPick();
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
  const pick = (p: readonly [number, number]) => {
    const id = ++pickId.current;
    const x = Math.min(viewport.width - 1, Math.max(0, Math.floor(p[0] / scale)));
    const y = Math.min(viewport.height - 1, Math.max(0, Math.floor(p[1] / scale)));
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

  const push = (m: Mark) => {
    if (marks.length >= MARKS_MAX) return setError(`A message holds at most ${MARKS_MAX} marks.`);
    setMarks([...marks, m]);
    setSelected(-1);
    setError(null);
    requestAnimationFrame(() => noteRef.current?.focus());
  };
  const commitText = () => {
    const t = typing;
    setTyping(null);
    if (!t || !t.text.trim()) return;
    const m = textToMark(t.text, t, shown, viewport, style);
    if (m.ok) push(m.value);
    else setError(m.error);
  };
  const pickTool = (t: Tool) => {
    commitText();
    setTool(t);
    if (t !== 'select') setSelected(-1);
  };
  const remove = (i: number) => {
    setMarks(marks.filter((_, j) => j !== i));
    setSelected(-1);
  };
  const undo = () => remove(marks.length - 1);
  const recolor = (hex: string) => {
    setColor(hex);
    if (selected >= 0) setMarks(marks.map((m, i) => (i === selected ? { ...m, color: hex as Mark['color'] } : m)));
  };
  const restroke = (n: number) => {
    setStroke(n);
    if (selected >= 0) setMarks(marks.map((m, i) => (i === selected ? { ...m, stroke: n } : m)));
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (adding) return;
    const p = at(e);
    setError(null);
    if (tool === 'text') {
      commitText();
      setTyping({ x: p[0], y: p[1], text: '' });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pen') return setGesture({ kind: 'pen', path: [p] });
    if (isShape(tool)) return setGesture({ kind: 'shape', drag: asDrag(p, p) });
    const [px, py] = page(p);
    const hit = markAt(marks, px, py, GRAB);
    if (hit >= 0) {
      setSelected(hit);
      setColor(marks[hit].color);
      setStroke(marks[hit].stroke);
      return setGesture({ kind: 'move', index: hit, from: [px, py], was: marks[hit] });
    }
    setSelected(-1);
    setGesture({ kind: 'area', drag: asDrag(p, p), moved: false });
  };
  const move = (e: React.PointerEvent) => {
    if (!gesture) return;
    const p = at(e);
    if (gesture.kind === 'pen') return setGesture({ ...gesture, path: [...gesture.path, p] });
    if (gesture.kind === 'shape') return setGesture({ ...gesture, drag: { ...gesture.drag, x1: p[0], y1: p[1] } });
    if (gesture.kind === 'move') {
      const [px, py] = page(p);
      setMarks(marks.map((m, i) => (i === gesture.index ? moveMark(gesture.was, px - gesture.from[0], py - gesture.from[1], viewport) : m)));
      return;
    }
    const d = { ...gesture.drag, x1: p[0], y1: p[1] };
    setGesture({ kind: 'area', drag: d, moved: gesture.moved || Math.abs(p[0] - d.x0) + Math.abs(p[1] - d.y0) > DRAG_START });
  };
  const up = (e: React.PointerEvent) => {
    const g = gesture;
    setGesture(null);
    if (!g) return;
    if (g.kind === 'pen') {
      const m = strokeToMark(g.path, shown, viewport, style);
      if (m.ok) push(m.value);
      else setError(m.error);
    } else if (g.kind === 'shape') {
      const m = dragToMark(tool as MarkShape, g.drag, shown, viewport, style);
      if (m.ok) push(m.value);
      else setError(m.error);
    } else if (g.kind === 'area') {
      if (g.moved) finishArea(g.drag);
      else pick(at(e));
    }
  };

  const add = async () => {
    if (adding) return;
    commitText();
    // The area the record points at: the one picked or dragged, else the box the marks cover.
    const where = rect ?? marksRect(marks, viewport, RECT_MIN);
    if (!where) return;
    setAdding(true);
    setError(null);
    try {
      let marked: AnnotationImage | undefined;
      if (marks.length) {
        const blob = await renderMarked(uploadUrl(threadId, capture.image), marks, viewport.width);
        marked = (await api.post<{ marked: AnnotationImage }>(`/channels/${encodeURIComponent(channelId)}/browser/capture/${encodeURIComponent(capture.image.name)}/marked?thread=${encodeURIComponent(threadId)}`, blob)).marked;
      }
      const body = annotate(capture, where, element ?? undefined, { marks, marked });
      if (!body.ok) return setError(body.error);
      const why = addDraftContext(threadId, newContext(browserAnnotation, body.value, note));
      if (why) return setError(why);
      onAdded();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAdding(false);
    }
  };

  // Redraw the marks over the screenshot whenever they, the one selected or the stroke being drawn change.
  useLayoutEffect(() => {
    const c = overlay.current;
    if (!c || !scale) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(shown.width * dpr);
    c.height = Math.round(shown.height * dpr);
    const ctx = c.getContext('2d')!;
    drawMarks(ctx, marks, scale * dpr, selected);
    if (gesture?.kind === 'pen' && gesture.path.length > 1) {
      const m = strokeToMark(gesture.path, shown, viewport, style);
      if (m.ok) drawMarks(ctx, [m.value], scale * dpr);
    } else if (gesture?.kind === 'shape') {
      const m = dragToMark(tool as MarkShape, gesture.drag, shown, viewport, style);
      if (m.ok) drawMarks(ctx, [m.value], scale * dpr);
    }
  }, [marks, selected, gesture, scale, shown, viewport, tool, color, stroke]);

  // Delete removes the selected mark, unless Ben is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || selected < 0) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      e.preventDefault();
      remove(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The area outline: the drag in progress, else the rectangle in page pixels.
  const outline =
    gesture?.kind === 'area' && gesture.moved
      ? { x: Math.min(gesture.drag.x0, gesture.drag.x1), y: Math.min(gesture.drag.y0, gesture.drag.y1), w: Math.abs(gesture.drag.x1 - gesture.drag.x0), h: Math.abs(gesture.drag.y1 - gesture.drag.y0) }
      : rect
        ? { x: rect.x * scale, y: rect.y * scale, w: rect.width * scale, h: rect.height * scale }
        : null;
  const ready = !!rect || marks.length > 0;
  const cursor = tool === 'select' ? 'cursor-crosshair' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair';

  return (
    <>
      <MarkToolbar
        tool={tool}
        shape={shape}
        color={color}
        stroke={stroke}
        canUndo={marks.length > 0}
        canDelete={selected >= 0}
        onTool={pickTool}
        onShape={setShape}
        onColor={recolor}
        onStroke={restroke}
        onUndo={undo}
        onDelete={() => remove(selected)}
      />
      <div ref={box} className="relative flex min-h-0 flex-1 items-start justify-center overflow-hidden px-3">
        <div
          ref={stage}
          aria-label="Screenshot of the page. Pick a tool, then draw on it."
          role="img"
          className={`relative shrink-0 touch-none overflow-hidden rounded-lg select-none ${cursor}`}
          style={{ width: shown.width || undefined, height: shown.height || undefined }}
          onPointerDown={down}
          // A press with the text tool must not take focus from the field it opens.
          onMouseDown={(e) => tool === 'text' && e.preventDefault()}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => setGesture(null)}
        >
          <img src={uploadUrl(threadId, capture.image)} alt="" draggable={false} className="pointer-events-none absolute inset-0 block h-full w-full" style={{ imageRendering: 'auto' }} />
          {outline ? (
            <span
              className="pointer-events-none absolute rounded-[3px] border-2 border-[var(--vermilion,#ff4b2b)]"
              style={{ left: outline.x, top: outline.y, width: outline.w, height: outline.h, boxShadow: '0 0 0 9999px rgba(0,0,0,0.42)' }}
            />
          ) : marks.length ? null : (
            <span className="pointer-events-none absolute inset-0 bg-black/10" />
          )}
          <canvas ref={overlay} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
          {typing && (
            <input
              autoFocus
              data-mark-text
              value={typing.text}
              maxLength={MARK_TEXT_MAX}
              aria-label="Text for the page"
              onChange={(e) => setTyping({ ...typing, text: e.target.value })}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitText();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setTyping(null);
                }
              }}
              className="absolute m-0 border-0 bg-transparent p-0 font-semibold outline-none"
              style={{
                left: typing.x,
                top: typing.y,
                width: Math.max(80, shown.width - typing.x),
                color,
                fontSize: textSize(stroke) * scale,
                lineHeight: 1.25,
                caretColor: color,
                borderBottom: `1px dashed ${color}`,
              }}
            />
          )}
        </div>
      </div>
      <div className="shrink-0 px-3 pt-2 pb-3">
        {ready ? (
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
                  void add();
                }
              }}
              className="block w-full resize-none rounded-xl bg-surface px-3 py-2 text-[16px] leading-[1.45] outline-none placeholder:text-fg-4 focus:shadow-[inset_0_0_0_1px_var(--line-strong)] sm:text-[13px]"
            />
            {element && <PickedElementDetails element={element} />}
            {notice && <div className="mt-2 text-[11.5px] text-fg-3">{notice}</div>}
            {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
            <div className="mt-2 flex items-center justify-end gap-1.5">
              {rect && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    clearPick();
                    setRect(null);
                    setError(null);
                  }}
                >
                  Clear area
                </Button>
              )}
              <Button size="sm" variant="primary" icon="plus" disabled={adding} onClick={() => void add()}>
                {adding ? 'Adding…' : 'Add to message'}
              </Button>
            </div>
          </>
        ) : (
          <>
            {error && <ErrorNote>{error}</ErrorNote>}
            {notice && <div className="mt-1 text-[11.5px] text-fg-3">{notice}</div>}
            <div className="mt-1 text-[11.5px] text-fg-4">
              {error ? '' : picking ? 'Looking at the page…' : tool === 'select' ? `Tap an element to pick it, or drag an area of at least ${RECT_MIN} by ${RECT_MIN} page pixels, or draw with a tool above. The page itself is not touched.` : tool === 'text' ? 'Tap where the text goes, type, and press Enter.' : 'Draw on the screenshot. The page itself is not touched.'}
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
