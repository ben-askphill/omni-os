// The mark editor behind the annotate screen: the marks, the tool and its style, the mark selected, the gesture in progress and
// the text being typed, with the pointer handlers that drive them and the canvas that draws them over the screenshot. A tap or a
// dragged area is not a mark, so it goes back to the caller (`onArea`, `onTap`), which owns the picked rectangle and element.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Drag } from '@omni/shared/message-context-browser.ts';
import {
  DEFAULT_MARK_COLOR,
  DEFAULT_MARK_STROKE,
  MARKS_MAX,
  dragToMark,
  markAt,
  moveMark,
  strokeToMark,
  textToMark,
  toPage,
  type Mark,
  type MarkShape,
  type MarkStyle,
} from '@omni/shared/message-context-marks.ts';
import { isShape, type Tool } from './BrowserMarkToolbar.tsx';
import { drawMarks } from './browser-marks-canvas.ts';

const DRAG_START = 3;
/** How far from a mark's line, in CSS pixels, a tap still grabs it. */
const GRAB = 6;

type Gesture =
  | { kind: 'area'; drag: Drag; moved: boolean }
  | { kind: 'pen'; path: [number, number][] }
  | { kind: 'shape'; drag: Drag }
  | { kind: 'move'; index: number; from: [number, number]; was: Mark };


export interface MarkEditorInput {
  viewport: { width: number; height: number };
  shown: { width: number; height: number };
  scale: number;
  /** True while the record is being added: pointer presses are ignored. */
  adding: boolean;
  setError: (message: string | null) => void;
  focusNote: () => void;
  onArea: (d: Drag) => void;
  onTap: (p: readonly [number, number]) => void;
}

export function useMarkEditor({ viewport, shown, scale, adding, setError, focusNote, onArea, onTap }: MarkEditorInput) {
  const stage = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
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

  const push = (m: Mark) => {
    if (marks.length >= MARKS_MAX) return setError(`A message holds at most ${MARKS_MAX} marks.`);
    setMarks([...marks, m]);
    setSelected(-1);
    setError(null);
    requestAnimationFrame(focusNote);
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
      if (g.moved) onArea(g.drag);
      else onTap(at(e));
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

  return { stage, overlay, tool, shape, setShape, color, stroke, marks, selected, gesture, setGesture, typing, setTyping, pickTool, recolor, restroke, undo, remove, commitText, down, move, up };
}
