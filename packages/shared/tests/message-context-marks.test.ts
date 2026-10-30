import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  MARK_COLORS,
  MARKS_MAX,
  PEN_POINTS_MAX,
  arrowBarbs,
  describeMark,
  dragToMark,
  hitsMark,
  markAt,
  markBox,
  marksOf,
  marksRect,
  moveMark,
  simplifyStroke,
  strokeToMark,
  textSize,
  textToMark,
  type Mark,
  type MarkShape,
  type MarkStyle,
} from '../message-context-marks.ts';
import { browserAnnotation, annotate, type BrowserCapture } from '../message-context-browser.ts';

// The same corpus runs in apps/mac/OmniKit/Tests/OmniKitTests/BrowserMarksTests.swift, so the Swift geometry cannot drift from this.
type Case = { name: string; op: string; expect: unknown } & Record<string, unknown>;
const corpus = JSON.parse(readFileSync(fixture('message-context.json'), 'utf8')) as { marks: Case[] };
const vp = { width: 1280, height: 713 };

describe('the marks corpus', () => {
  for (const c of corpus.marks) {
    it(c.name, () => {
      const v = c.viewport as { width: number; height: number };
      const got = (() => {
        switch (c.op) {
          case 'rect':
            return marksRect(c.marks as Mark[], v, 8);
          case 'move':
            return moveMark(c.mark as Mark, c.dx as number, c.dy as number, v);
          case 'hit':
            return hitsMark(c.mark as Mark, c.x as number, c.y as number, c.slop as number);
          case 'simplify':
            return simplifyStroke(c.points as [number, number][]);
          case 'drag':
            return dragToMark(c.shape as MarkShape, c.drag as never, c.shown as never, v, c.style as MarkStyle);
          case 'stroke':
            return strokeToMark(c.path as [number, number][], c.shown as never, v, c.style as MarkStyle);
          case 'text':
            return textToMark(c.text as string, c.at as { x: number; y: number }, c.shown as never, v, c.style as MarkStyle);
          case 'barbs':
            return arrowBarbs(c.mark as never).map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
          default:
            throw new Error(`unknown op ${c.op}`);
        }
      })();
      expect(got).toEqual(c.expect);
    });
  }
});

const arrow: Mark = { type: 'arrow', color: '#ff4420', stroke: 4, x0: 200, y0: 300, x1: 420, y1: 180 };
const rect: Mark = { type: 'rect', color: '#3b82f6', stroke: 2, x: 320, y: 96, width: 480, height: 160 };
const pen: Mark = { type: 'pen', color: '#ffd23f', stroke: 4, points: [[100, 600], [140, 640], [180, 600]] };
const text: Mark = { type: 'text', color: '#a855f7', stroke: 4, x: 700, y: 120, text: 'Total is wrong' };

describe('marks as the record holds them', () => {
  it('reads what it writes, whatever the order of keys', () => {
    for (const m of [arrow, rect, pen, text]) {
      const scrambled = Object.fromEntries(Object.entries(m).reverse());
      const r = marksOf([scrambled], vp);
      expect(r.ok && JSON.stringify(r.value[0])).toBe(JSON.stringify(m));
    }
  });

  it('takes a list of at most MARKS_MAX and none as none', () => {
    expect(marksOf(undefined, vp)).toEqual({ ok: true, value: [] });
    expect(marksOf(null, vp)).toEqual({ ok: true, value: [] });
    expect(marksOf([], vp)).toEqual({ ok: true, value: [] });
    expect(marksOf(Array.from({ length: MARKS_MAX }, () => arrow), vp).ok).toBe(true);
    expect(marksOf(Array.from({ length: MARKS_MAX + 1 }, () => arrow), vp).ok).toBe(false);
    expect(marksOf('x', vp).ok).toBe(false);
  });

  it('refuses a pen stroke of more than PEN_POINTS_MAX points', () => {
    const points = Array.from({ length: PEN_POINTS_MAX + 1 }, (_, i) => [i, 0]);
    expect(marksOf([{ ...pen, points }], vp).ok).toBe(false);
  });

  it('offers eight colors and every one is valid', () => {
    expect(MARK_COLORS).toHaveLength(8);
    for (const c of MARK_COLORS) expect(marksOf([{ ...arrow, color: c.hex }], vp).ok).toBe(true);
  });

  it('sizes text from the line width', () => {
    expect([2, 4, 8].map(textSize)).toEqual([18, 24, 36]);
  });

  it('finds the topmost mark at a point', () => {
    const marks: Mark[] = [rect, { ...rect, color: '#111111' }];
    expect(markAt(marks, 320, 150, 6)).toBe(1);
    expect(markAt(marks, 10, 700, 6)).toBe(-1);
  });

  it('keeps a mark whole inside the viewport and covers it with its box', () => {
    for (const m of [arrow, rect, pen, text]) {
      const moved = moveMark(m, 99999, 99999, vp);
      const b = markBox(moved);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
      expect(marksOf([moved], vp).ok).toBe(true);
    }
  });
});

describe('describing marks to the agent', () => {
  it('names the color, the shape and where, in CSS pixels', () => {
    expect(describeMark(arrow)).toBe('red arrow from x 200, y 300 to x 420, y 180 (the head is at the end)');
    expect(describeMark(rect)).toBe('blue rectangle at x 320, y 96, 480×160');
    expect(describeMark(pen)).toBe('yellow freehand stroke of 3 points, covering x 100, y 600, 80×40');
    expect(describeMark(text)).toBe('purple text at x 700, y 120: "Total is wrong"');
  });
});

describe('a browser_annotation with marks', () => {
  const capture: BrowserCapture = {
    thread: 't1',
    url: 'https://shop.example.com/cart',
    title: 'Cart',
    viewport: { ...vp, scale: 2 },
    scroll: { x: 0, y: 0 },
    captured_at: '2026-10-26T09:30:15.250Z',
    image: { name: 'annotation-3f9a1c7e5b2d4a60.png', mime: 'image/png', width: 2560, height: 1426, bytes: 1000 },
  };
  const area = marksRect([arrow, rect], vp, 8)!;

  it('is labelled with how many marks, and is valid with the rectangle round them', () => {
    const r = annotate(capture, area, undefined, { marks: [arrow, rect] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(browserAnnotation.label(r.value)).toBe('Browser, 2 marks on shop.example.com/cart');
    const one = annotate(capture, area, undefined, { marks: [arrow] });
    if (one.ok) expect(browserAnnotation.label(one.value)).toBe('Browser, 1 mark on shop.example.com/cart');
  });

  it('keeps a marked image and refuses one that is not a marked file', () => {
    const marked = { name: 'annotation-3f9a1c7e5b2d4a60-marked.png', mime: 'image/png' as const, width: 2560, height: 1426, bytes: 2000 };
    expect(annotate(capture, area, undefined, { marks: [arrow], marked }).ok).toBe(true);
    expect(annotate(capture, area, undefined, { marks: [arrow], marked: { ...marked, name: 'annotation-3f9a1c7e5b2d4a60.png' } }).ok).toBe(false);
  });

  it('is the same record as before when nothing was drawn', () => {
    const r = annotate(capture, area, undefined, { marks: [] });
    expect(r.ok && 'marks' in r.value).toBe(false);
  });
});
