// The marks Ben draws on a browser_annotation's screenshot (message-context-browser.ts): freehand strokes, rectangles,
// ellipses, arrows, lines and text, in the page's own CSS pixels like the rectangle, so they mean the same thing on any
// client and at any display scale. Pure geometry and checking: every client draws them itself (canvas on the web,
// CoreGraphics and SwiftUI on the Mac) and the server describes them to the agent in words (apps/server/message-context/).
// apps/mac/OmniKit/Sources/OmniKit/BrowserMarks.swift ports it.
import type { Parsed } from './message-context.ts';
import { plain } from './message-context-terminal.ts';

/** The colors a mark may have, in the order the picker shows them. Names are what the agent is told. */
export const MARK_COLORS = [
  { name: 'red', hex: '#ff4420' },
  { name: 'orange', hex: '#ff9f1c' },
  { name: 'yellow', hex: '#ffd23f' },
  { name: 'green', hex: '#2ec27e' },
  { name: 'blue', hex: '#3b82f6' },
  { name: 'purple', hex: '#a855f7' },
  { name: 'white', hex: '#ffffff' },
  { name: 'black', hex: '#111111' },
] as const;
export type MarkColor = (typeof MARK_COLORS)[number]['hex'];
export const DEFAULT_MARK_COLOR: MarkColor = '#ff4420';

/** The line widths the picker offers, in CSS pixels. A text mark takes its size from the width (`textSize`). */
export const MARK_STROKES = [2, 4, 8] as const;
export const DEFAULT_MARK_STROKE = 4;
export const STROKE_MAX = 16;

/** What a record may hold: with the 32,000 characters of a message's records in mind, at most about 9,000 for marks. */
export const MARKS_MAX = 24;
export const PEN_POINTS_MAX = 200;
export const MARK_POINTS_MAX = 800;
export const MARK_TEXT_MAX = 120;

export type MarkShape = 'rect' | 'ellipse' | 'arrow' | 'line';
export type MarkTool = 'pen' | MarkShape | 'text';

interface Styled {
  color: MarkColor;
  /** Line width in CSS pixels, whole, 1 to STROKE_MAX. */
  stroke: number;
}
export interface PenMark extends Styled {
  type: 'pen';
  /** At least two points, whole CSS pixels from the viewport's top left, inside it. */
  points: [number, number][];
}
export interface BoxMark extends Styled {
  type: 'rect' | 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LineMark extends Styled {
  type: 'arrow' | 'line';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface TextMark extends Styled {
  type: 'text';
  /** The text's top left. */
  x: number;
  y: number;
  text: string;
}
export type Mark = PenMark | BoxMark | LineMark | TextMark;

export interface Size {
  width: number;
  height: number;
}
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const COLOR_HEX: readonly string[] = MARK_COLORS.map((c) => c.hex);
/** The smallest a text, box or line mark may be, per side, in CSS pixels. Below it a drag was a click. */
export const MARK_MIN = 4;
/** The most the page's text can be taken to weigh, per character, as a share of its size. Clients draw the real text; this is for bounds and hits. */
const TEXT_ADVANCE = 0.58;
const TEXT_LINE = 1.25;

export const colorName = (hex: string) => MARK_COLORS.find((c) => c.hex === hex)?.name ?? 'red';
/** A text mark's size in CSS pixels, from its line width. */
export const textSize = (stroke: number) => 12 + 3 * stroke;

/** The mark as `parse` holds it, or why not. `at` names it in the error: `marks[2]`. Strict: a half of a mark is refused. */
export function markOf(v: unknown, at: string, viewport: Size): Parsed<Mark> {
  if (!isObj(v)) return { ok: false, error: `${at} must be an object` };
  const { type, color, stroke } = v;
  if (typeof color !== 'string' || !COLOR_HEX.includes(color)) return { ok: false, error: `${at}.color must be one of the picker's colors` };
  if (!whole(stroke, 1, STROKE_MAX)) return { ok: false, error: `${at}.stroke must be a whole width of 1 to ${STROKE_MAX}` };
  const base = { color: color as MarkColor, stroke };
  const inX = (n: unknown): n is number => whole(n, 0, viewport.width);
  const inY = (n: unknown): n is number => whole(n, 0, viewport.height);
  switch (type) {
    case 'pen': {
      const pts = v.points;
      if (!Array.isArray(pts) || pts.length < 2 || pts.length > PEN_POINTS_MAX) return { ok: false, error: `${at}.points must be 2 to ${PEN_POINTS_MAX} points` };
      const points: [number, number][] = [];
      for (const p of pts) {
        if (!Array.isArray(p) || p.length !== 2 || !inX(p[0]) || !inY(p[1])) return { ok: false, error: `${at}.points must be whole CSS pixels inside the viewport` };
        points.push([p[0], p[1]]);
      }
      return { ok: true, value: { type, ...base, points } };
    }
    case 'rect':
    case 'ellipse': {
      const { x, y, width, height } = v;
      if (!inX(x) || !inY(y) || !whole(width, 1, viewport.width) || !whole(height, 1, viewport.height) || x + width > viewport.width || y + height > viewport.height)
        return { ok: false, error: `${at} must be whole CSS pixels inside the viewport` };
      return { ok: true, value: { type, ...base, x, y, width, height } };
    }
    case 'arrow':
    case 'line': {
      const { x0, y0, x1, y1 } = v;
      if (!inX(x0) || !inY(y0) || !inX(x1) || !inY(y1)) return { ok: false, error: `${at} must be whole CSS pixels inside the viewport` };
      return { ok: true, value: { type, ...base, x0, y0, x1, y1 } };
    }
    case 'text': {
      const { x, y } = v;
      if (!whole(x, 0, viewport.width - 1) || !whole(y, 0, viewport.height - 1)) return { ok: false, error: `${at} must be whole CSS pixels inside the viewport` };
      const text = plain(v.text, `${at}.text`, MARK_TEXT_MAX);
      if (!text.ok) return text;
      if (!text.value.trim()) return { ok: false, error: `${at}.text is empty` };
      return { ok: true, value: { type, ...base, x, y, text: text.value } };
    }
    default:
      return { ok: false, error: `${at}.type must be pen, rect, ellipse, arrow, line or text` };
  }
}

/** The record's marks, or why not. Absent or null is none. An empty list is none too, and is not kept. */
export function marksOf(v: unknown, viewport: Size): Parsed<Mark[]> {
  if (v === undefined || v === null) return { ok: true, value: [] };
  if (!Array.isArray(v) || v.length > MARKS_MAX) return { ok: false, error: `marks must be a list of at most ${MARKS_MAX} marks` };
  const out: Mark[] = [];
  let points = 0;
  for (const [i, m] of v.entries()) {
    const one = markOf(m, `marks[${i}]`, viewport);
    if (!one.ok) return one;
    if (one.value.type === 'pen') points += one.value.points.length;
    out.push(one.value);
  }
  if (points > MARK_POINTS_MAX) return { ok: false, error: `marks hold more than ${MARK_POINTS_MAX} pen points in all` };
  return { ok: true, value: out };
}

/** What the mark covers, stroke excluded, in CSS pixels. A text mark's box is an estimate: clients draw the real text. */
export function markBox(m: Mark): Box {
  switch (m.type) {
    case 'pen': {
      const xs = m.points.map((p) => p[0]);
      const ys = m.points.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    case 'rect':
    case 'ellipse':
      return { x: m.x, y: m.y, width: m.width, height: m.height };
    case 'arrow':
    case 'line':
      return { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), width: Math.abs(m.x1 - m.x0), height: Math.abs(m.y1 - m.y0) };
    case 'text': {
      const size = textSize(m.stroke);
      return { x: m.x, y: m.y, width: Math.ceil([...m.text].length * size * TEXT_ADVANCE), height: Math.ceil(size * TEXT_LINE) };
    }
  }
}

/** Every mark's box together, grown by half a stroke, kept inside the viewport and at least RECT_MIN either way. Null when there are none. */
export function marksRect(marks: readonly Mark[], viewport: Size, min: number): Box | null {
  if (!marks.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of marks) {
    const b = markBox(m);
    const pad = Math.ceil(m.stroke / 2);
    x0 = Math.min(x0, b.x - pad);
    y0 = Math.min(y0, b.y - pad);
    x1 = Math.max(x1, b.x + b.width + pad);
    y1 = Math.max(y1, b.y + b.height + pad);
  }
  const side = (a: number, b: number, max: number) => {
    const from = Math.max(0, Math.floor(a));
    const to = Math.min(max, Math.ceil(b));
    const len = Math.min(max, Math.max(to - from, min));
    return [Math.min(max - len, from), len] as const;
  };
  const [x, width] = side(x0, x1, viewport.width);
  const [y, height] = side(y0, y1, viewport.height);
  return { x, y, width, height };
}

const round = Math.round;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A mark moved by (dx, dy) CSS pixels, held inside the viewport as a whole: it stops at the edge instead of shrinking. */
export function moveMark(m: Mark, dx: number, dy: number, viewport: Size): Mark {
  const b = markBox(m);
  const mx = clamp(round(dx), -b.x, viewport.width - (b.x + b.width));
  const my = clamp(round(dy), -b.y, viewport.height - (b.y + b.height));
  // A text mark whose estimated box is wider than the viewport still keeps its start inside.
  const sx = m.type === 'text' ? clamp(mx, -m.x, viewport.width - 1 - m.x) : mx;
  const sy = m.type === 'text' ? clamp(my, -m.y, viewport.height - 1 - m.y) : my;
  switch (m.type) {
    case 'pen':
      return { ...m, points: m.points.map(([x, y]) => [x + sx, y + sy] as [number, number]) };
    case 'rect':
    case 'ellipse':
    case 'text':
      return { ...m, x: m.x + sx, y: m.y + sy };
    case 'arrow':
    case 'line':
      return { ...m, x0: m.x0 + sx, y0: m.y0 + sy, x1: m.x1 + sx, y1: m.y1 + sy };
  }
}

const dist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return (px - qx) ** 2 + (py - qy) ** 2;
};

/** Whether a point is on the mark, within `slop` CSS pixels of its line. An open shape is hit on its outline, text anywhere in its box. */
export function hitsMark(m: Mark, px: number, py: number, slop: number): boolean {
  const reach = slop + m.stroke / 2;
  switch (m.type) {
    case 'pen':
      for (let i = 1; i < m.points.length; i++) {
        const [ax, ay] = m.points[i - 1];
        const [bx, by] = m.points[i];
        if (dist2(px, py, ax, ay, bx, by) <= reach * reach) return true;
      }
      return false;
    case 'arrow':
    case 'line':
      return dist2(px, py, m.x0, m.y0, m.x1, m.y1) <= reach * reach;
    case 'rect': {
      const { x, y, width: w, height: h } = m;
      const inside = px >= x - reach && px <= x + w + reach && py >= y - reach && py <= y + h + reach;
      const core = px > x + reach && px < x + w - reach && py > y + reach && py < y + h - reach;
      return inside && !core;
    }
    case 'ellipse': {
      const a = m.width / 2;
      const b = m.height / 2;
      const r = Math.hypot((px - (m.x + a)) / Math.max(a, 1), (py - (m.y + b)) / Math.max(b, 1));
      return Math.abs(r - 1) * Math.min(a, b) <= reach;
    }
    case 'text': {
      const b = markBox(m);
      return px >= b.x - slop && px <= b.x + b.width + slop && py >= b.y - slop && py <= b.y + b.height + slop;
    }
  }
}

/** The index of the topmost mark at a point, or -1. */
export function markAt(marks: readonly Mark[], px: number, py: number, slop: number): number {
  for (let i = marks.length - 1; i >= 0; i--) if (hitsMark(marks[i], px, py, slop)) return i;
  return -1;
}

/** The two barbs of an arrow's head, at its end: the same on every client. */
export function arrowBarbs(m: Pick<LineMark, 'x0' | 'y0' | 'x1' | 'y1' | 'stroke'>): [[number, number], [number, number]] {
  const angle = Math.atan2(m.y1 - m.y0, m.x1 - m.x0);
  const len = Math.min(8 + 3 * m.stroke, Math.max(MARK_MIN, Math.hypot(m.x1 - m.x0, m.y1 - m.y0) * 0.6));
  const barb = (a: number): [number, number] => [m.x1 - len * Math.cos(angle + a), m.y1 - len * Math.sin(angle + a)];
  const spread = (28 * Math.PI) / 180;
  return [barb(spread), barb(-spread)];
}

/**
 * A freehand stroke with fewer points: Ramer-Douglas-Peucker at `tolerance` CSS pixels, then thinned evenly until it
 * fits PEN_POINTS_MAX. Whole pixels, and the ends stay where they were.
 */
export function simplifyStroke(points: readonly (readonly [number, number])[], tolerance = 1.5): [number, number][] {
  const pts = points.map(([x, y]) => [round(x), round(y)] as [number, number]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (pts.length < 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let at = 0;
    for (let i = a + 1; i < b; i++) {
      const d = dist2(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
      if (d > far) [far, at] = [d, i];
    }
    if (far > tol2) {
      keep[at] = true;
      stack.push([a, at], [at, b]);
    }
  }
  let out = pts.filter((_, i) => keep[i]);
  if (out.length > PEN_POINTS_MAX) {
    const step = (out.length - 1) / (PEN_POINTS_MAX - 1);
    out = Array.from({ length: PEN_POINTS_MAX }, (_, i) => out[Math.round(i * step)]);
  }
  return out;
}

/** What Ben drags with a shape tool, in the shown image's own pixels: corner to corner. */
export interface ShownDrag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MarkStyle {
  color: MarkColor;
  stroke: number;
}

/** A shown point as a whole CSS pixel inside the viewport. */
export function toPage(x: number, y: number, shown: Size, viewport: Size): [number, number] {
  return [clamp(round((x * viewport.width) / shown.width), 0, viewport.width), clamp(round((y * viewport.height) / shown.height), 0, viewport.height)];
}

/**
 * The mark a drag draws with a shape tool, or why not. A drag shorter than MARK_MIN either way in a box, or in all for a
 * line, was a click and makes nothing.
 */
export function dragToMark(shape: MarkShape, drag: ShownDrag, shown: Size, viewport: Size, style: MarkStyle): Parsed<Mark> {
  if (!(shown.width > 0 && shown.height > 0 && viewport.width > 0 && viewport.height > 0)) return { ok: false, error: 'There is no screenshot to draw on.' };
  const [x0, y0] = toPage(drag.x0, drag.y0, shown, viewport);
  const [x1, y1] = toPage(drag.x1, drag.y1, shown, viewport);
  if (shape === 'arrow' || shape === 'line') {
    if (Math.hypot(x1 - x0, y1 - y0) < MARK_MIN) return { ok: false, error: 'Drag a little further.' };
    return { ok: true, value: { type: shape, ...style, x0, y0, x1, y1 } };
  }
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  if (width < MARK_MIN || height < MARK_MIN) return { ok: false, error: 'Drag a little further.' };
  return { ok: true, value: { type: shape, ...style, x, y, width, height } };
}

/** The mark a pen stroke makes, from the shown points it passed through. */
export function strokeToMark(path: readonly (readonly [number, number])[], shown: Size, viewport: Size, style: MarkStyle): Parsed<Mark> {
  if (!(shown.width > 0 && shown.height > 0)) return { ok: false, error: 'There is no screenshot to draw on.' };
  const points = simplifyStroke(path.map(([x, y]) => toPage(x, y, shown, viewport)));
  if (points.length < 2) {
    // A tap with the pen is a dot: two points a hair apart, so it has a length to draw.
    const [x, y] = points[0] ?? [0, 0];
    return { ok: true, value: { type: 'pen', ...style, points: [[x, y], [Math.min(viewport.width, x + 1), y]] } };
  }
  return { ok: true, value: { type: 'pen', ...style, points } };
}

/** The text mark for words typed at a shown point, or why not. */
export function textToMark(text: string, at: { x: number; y: number }, shown: Size, viewport: Size, style: MarkStyle): Parsed<Mark> {
  const words = text.replace(/\s+/g, ' ').trim();
  if (!words) return { ok: false, error: 'Type some text first.' };
  const [x, y] = toPage(at.x, at.y, shown, viewport);
  return markOf({ type: 'text', ...style, x: Math.min(x, viewport.width - 1), y: Math.min(y, viewport.height - 1), text: [...words].slice(0, MARK_TEXT_MAX).join('') }, 'text', viewport);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const marksLabel = (n: number) => plural(n, 'mark');

/** One mark as a sentence for the agent: what it is, its color, where. Text is Ben's own words, quoted. */
export function describeMark(m: Mark): string {
  const color = colorName(m.color);
  switch (m.type) {
    case 'pen': {
      const b = markBox(m);
      return `${color} freehand stroke of ${plural(m.points.length, 'point')}, covering x ${b.x}, y ${b.y}, ${b.width}×${b.height}`;
    }
    case 'rect':
      return `${color} rectangle at x ${m.x}, y ${m.y}, ${m.width}×${m.height}`;
    case 'ellipse':
      return `${color} ellipse in the box at x ${m.x}, y ${m.y}, ${m.width}×${m.height}`;
    case 'arrow':
      return `${color} arrow from x ${m.x0}, y ${m.y0} to x ${m.x1}, y ${m.y1} (the head is at the end)`;
    case 'line':
      return `${color} line from x ${m.x0}, y ${m.y0} to x ${m.x1}, y ${m.y1}`;
    case 'text':
      return `${color} text at x ${m.x}, y ${m.y}: ${JSON.stringify(m.text)}`;
  }
}
