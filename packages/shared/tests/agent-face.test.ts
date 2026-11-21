import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agentFace } from '../agent-avatar.ts';
import { crewShapesSource, OUT as CREW_SHAPES_FILE, SPEC_FILE } from '../scripts/build-crew-shapes.ts';
import { CREW_CLEARED_SIZES, CREW_FITTED, EYE_STATES, PILL_DIAGONAL_LEVEL_STOPS } from '../crew-shapes.ts';
import { crewClearance } from '../crew-size.ts';
import type { MemberState } from '../members.ts';
import { MARK, threadMark, turnPhase, type Mark } from '../status.ts';

// Seam A (ADR 0021, D27): the agent face, checked against the committed spec JSON.

interface SpecEye { k: string; p: [number, number][]; d: number }
interface SpecStop { G: number; dpath: string; fill: string; sw: number; sat: [number, number, number] | null; lay: Record<string, SpecEye>; base: number; line: number }
interface Spec { palette: Record<string, string>; strokeStops_px: [number, number][]; shapes: Record<string, { colour: string; sizes: Record<string, SpecStop> }> }

const SPEC: Spec = JSON.parse(readFileSync(SPEC_FILE, 'utf8'));
const SHAPES = Object.keys(SPEC.shapes);
const STOPS = [16, 18, 24, 32, 48, 64] as const;
/** The eye states, and the spec pose each rests on: thinking and working are the centred ones of their glance. */
const STATES = { idle: 'idle', thinking: 'think_c', working: 'work_c', waiting: 'waiting', needs: 'needs', done: 'done' } as const;
type State = keyof typeof STATES;
/** The spec has no 16px entry: 16px draws the 18px drawing. */
const specStop = (shape: string, stop: number) => SPEC.shapes[shape].sizes[stop === 16 ? '18' : String(stop)];

const face = (shape: string, size: number, eyes: State = 'idle') => {
  const f = agentFace({ id: 'someone', avatar: { shape } }, { size, shows: { eyes } });
  if (!f) throw new Error(`no face for ${shape}`);
  return f;
};

/** The pill-diagonal pair tilted -38° about its midpoint (D21). */
function tilted([a, b]: [number, number][]): [number, number][] {
  const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const t = (-38 * Math.PI) / 180;
  return [a, b].map(([x, y]) => [mx + (x - mx) * Math.cos(t) - (y - my) * Math.sin(t), my + (x - mx) * Math.sin(t) + (y - my) * Math.cos(t)]);
}

/** The pair the spec draws for a shape, stop and state, tilted where D21 tilts it. */
function specPair(shape: string, stop: (typeof STOPS)[number], state: State) {
  const p = specStop(shape, stop).lay[STATES[state]].p;
  return shape === 'pill-diagonal' && !PILL_DIAGONAL_LEVEL_STOPS.includes(stop) ? tilted(p) : p;
}
const fitted = (shape: string, stop: number, state: State) => (CREW_FITTED as Record<string, Record<number, readonly string[]> | undefined>)[shape]?.[stop]?.includes(STATES[state]) ?? false;

describe('the crew shapes come from the spec', () => {
  it('keeps the spec export byte for byte', () => {
    expect(createHash('sha256').update(readFileSync(SPEC_FILE)).digest('hex')).toBe('72d04eea75c9fb10d211b6de18500d90ec6d229514ee730d6ae638cff013fdcd');
  });

  it('checks in what the generator writes from it', { timeout: 60_000 }, () => {
    expect(readFileSync(CREW_SHAPES_FILE, 'utf8'), 'Run npm run build:crew-shapes -w @omni/shared').toBe(crewShapesSource());
  });
});

describe('agentFace draws the crew character an agent names', () => {
  it('draws the circle on the 18 grid at 18px, from the spec outline, in Ink', () => {
    const face = agentFace({ id: 'conductor', avatar: { shape: 'circle' } }, { size: 18 });
    const stop = SPEC.shapes.circle.sizes['18'];
    expect(face).toMatchObject({ kind: 'character', shape: 'circle', grid: 18, viewBox: '0 0 18 18', outline: stop.dpath, body: SPEC.palette.Ink });
  });

  it('draws every shape at every stop and eye state as the spec does: outline, grid, color, glyph and eye centres', () => {
    for (const shape of SHAPES)
      for (const stop of STOPS)
        for (const state of Object.keys(STATES) as State[]) {
          const f = face(shape, stop, state);
          const spec = specStop(shape, stop);
          const what = `${shape} at ${stop}px, ${state}`;
          expect(f.outline, what).toBe(spec.dpath);
          expect(f.grid, what).toBe(spec.G);
          expect(f.body, what).toBe(SPEC.palette[SPEC.shapes[shape].colour]);
          expect(f.pair.map((e) => e.glyph), what).toEqual([spec.lay[STATES[state]].k, spec.lay[STATES[state]].k]);
          const want = specPair(shape, stop, state);
          // A fitted pair moved inward until it cleared the outline (below); it stays within half a pixel of the spec's.
          const near = fitted(shape, stop, state) ? (0.5 * spec.G) / stop : 0.008;
          f.pair.forEach((e, i) => expect(Math.hypot(e.cx - want[i][0], e.cy - want[i][1]), what).toBeLessThanOrEqual(near));
          if (stop !== 16) f.pair.forEach((e) => expect(e.d, what).toBeCloseTo(spec.lay[STATES[state]].d, 2));
        }
  });

  it('gives the Conductor its satellite at every stop, and no other shape one', () => {
    for (const shape of SHAPES)
      for (const stop of STOPS) {
        const sat = specStop(shape, stop).sat;
        expect(face(shape, stop).satellite, `${shape} at ${stop}px`).toEqual(sat && { cx: sat[0], cy: sat[1], r: sat[2] });
      }
    expect(SHAPES.filter((shape) => specStop(shape, 24).sat)).toEqual(['circle']);
  });
});

/** A length the face gives in its grid's units, in px. */
const px = (f: { size: number; grid: number }, units: number) => (units * f.size) / f.grid;
const near = (got: number, want: number, within = 0.006) => Math.abs(got - want) <= within;

describe('agentFace draws each size with its own stroke and eyes', () => {
  it('draws the size table at each stop', () => {
    // px: stroke, eye, clearance (the spec's size table; 64px is 15/128 and 13.05/128 of the size).
    const table = { 16: [1.4, 2.44, 0.75], 18: [1.5, 2.25, 0.75], 24: [2, 2.8, 0.75], 32: [2.75, 3.16, 0.96], 48: [4.5, 4.41, 1.57], 64: [7.5, 6.525, 2.625] };
    for (const shape of SHAPES)
      for (const [size, [stroke, eye, clearance]] of Object.entries(table)) {
        const f = face(shape, Number(size));
        expect(near(px(f, f.stroke), stroke), `${shape} stroke at ${size}px`).toBe(true);
        expect(near(px(f, f.pair[0].d), eye), `${shape} eye at ${size}px`).toBe(true);
        expect(near(crewClearance(Number(size)), clearance), `clearance at ${size}px`).toBe(true);
      }
  });

  it('runs stroke and eye straight between the stops, and as a share of the size from 64px', () => {
    const stops = [[16, 1.4, 2.44], [18, 1.5, 2.25], [24, 2, 2.8], [32, 2.75, 3.1625], [48, 4.5, 4.41], [64, 7.5, 6.525]];
    for (let i = 1; i < stops.length; i++) {
      const [a, sa, ea] = stops[i - 1];
      const [b, sb, eb] = stops[i];
      for (const t of [0.25, 0.5, 0.75]) {
        const f = face('droplet', a + (b - a) * t);
        expect(px(f, f.stroke), `stroke at ${f.size}px`).toBeCloseTo(sa + (sb - sa) * t, 6);
        expect(px(f, f.pair[0].d), `eye at ${f.size}px`).toBeCloseTo(ea + (eb - ea) * t, 6);
      }
    }
    for (const size of [64, 72, 88, 128]) {
      const f = face('droplet', size);
      expect(px(f, f.stroke)).toBeCloseTo((15 / 128) * size, 6);
      expect(px(f, f.pair[0].d)).toBeCloseTo((13.05 / 128) * size, 6);
    }
  });

  it('never draws an eye under 2px', () => {
    for (let size = 8; size <= 128; size += 0.5) {
      const f = face('cloud', size);
      expect(px(f, f.pair[0].d), `${size}px`).toBeGreaterThanOrEqual(2);
    }
  });

  it('switches grids at 18/19 and 31/32px, and draws the large eyes only from 32px', () => {
    expect([16, 18, 19, 24, 31, 32, 88].map((size) => face('arch', size).grid)).toEqual([18, 18, 24, 24, 24, 128, 128]);
    for (let size = 16; size <= 128; size++) {
      const f = face('arch', size, 'waiting');
      expect([f.glyphs, f.pair[0].glyph], `${size}px`).toEqual(size >= 32 ? ['large', 'square'] : ['small', 'block']);
    }
    expect(Object.keys(STATES).map((state) => face('arch', 31, state as State).pair[0].glyph)).toEqual(['dot', 'dot', 'dot', 'block', 'bar', 'chevron']);
    expect(Object.keys(STATES).map((state) => face('arch', 32, state as State).pair[0].glyph)).toEqual(['dot', 'dot', 'dot', 'square', 'diamond', 'arc']);
  });
});

type Point = [number, number];

/** The outline's corners: it is one closed polyline. */
const corners = (d: string): Point[] => [...d.matchAll(/[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

function distance(p: Point, line: Point[]) {
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const [a, b] = [line[i], line[(i + 1) % line.length]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

function inside(p: Point, line: Point[]) {
  let hit = false;
  for (let i = 0, j = line.length - 1; i < line.length; j = i++) {
    const [[xi, yi], [xj, yj]] = [line[i], line[j]];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Points along an eye glyph's path (M, L, H, V, A, their relative forms, Z), arcs and edges included. */
function glyphPoints(path: string): Point[] {
  const out: Point[] = [];
  let at: Point = [0, 0];
  let start: Point = [0, 0];
  const edge = (to: Point) => {
    for (let i = 1; i <= 8; i++) out.push([at[0] + ((to[0] - at[0]) * i) / 8, at[1] + ((to[1] - at[1]) * i) / 8]);
    at = to;
  };
  for (const [, cmd, args] of path.matchAll(/([MLHVAZmlhvaz])([^MLHVAZmlhvaz]*)/g)) {
    const v = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z';
    const to = (x: number, y: number): Point => (rel ? [at[0] + x, at[1] + y] : [x, y]);
    switch (cmd.toUpperCase()) {
      case 'M':
        at = start = to(v[0], v[1]);
        out.push(at);
        break;
      case 'L':
        edge(to(v[0], v[1]));
        break;
      case 'H':
        edge([rel ? at[0] + v[0] : v[0], at[1]]);
        break;
      case 'V':
        edge([at[0], rel ? at[1] + v[0] : v[0]]);
        break;
      case 'Z':
        edge(start);
        break;
      case 'A': {
        // Circular arcs only (rx = ry, no rotation), from endpoints to centre.
        const [r0, , , large, sweep] = v;
        const end = to(v[5], v[6]);
        const [hx, hy] = [(at[0] - end[0]) / 2, (at[1] - end[1]) / 2];
        const r = Math.max(r0, Math.hypot(hx, hy));
        const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (r * r - hx * hx - hy * hy) / (hx * hx + hy * hy)));
        const c: Point = [k * hy + (at[0] + end[0]) / 2, -k * hx + (at[1] + end[1]) / 2];
        const a0 = Math.atan2(at[1] - c[1], at[0] - c[0]);
        let sweepAngle = Math.atan2(end[1] - c[1], end[0] - c[0]) - a0;
        if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
        if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
        for (let i = 1; i <= 24; i++) out.push([c[0] + r * Math.cos(a0 + (sweepAngle * i) / 24), c[1] + r * Math.sin(a0 + (sweepAngle * i) / 24)]);
        at = end;
        break;
      }
    }
  }
  return out;
}

/** How far an eye's glyph stays inside the outline's stroke, in px; negative when it reaches the stroke or outside. */
function room(f: NonNullable<ReturnType<typeof agentFace>>, eye: (typeof f.pair)[number]) {
  const line = corners(f.outline);
  const pad = (eye.line ?? 0) / 2 + f.stroke / 2;
  const points = glyphPoints(eye.path);
  if (!points.every((p) => inside(p, line))) return -Infinity;
  return px(f, Math.min(...points.map((p) => distance(p, line) - pad)));
}

/** The same for a plain circle of the eye's diameter at another centre: what the spec's pair would draw. */
function roomAt(f: NonNullable<ReturnType<typeof agentFace>>, centre: Point, d: number) {
  const line = corners(f.outline);
  return inside(centre, line) ? px(f, distance(centre, line) - d / 2 - f.stroke / 2) : -Infinity;
}

describe('agentFace keeps the eyes off the outline', () => {
  it('clears the outline by the clearance with every eye, at every size in use and every state', () => {
    expect(CREW_CLEARED_SIZES).toEqual([16, 18, 20, 22, 24, 28, 30, 32, 48, 64, 88]);
    for (const size of CREW_CLEARED_SIZES) {
      // The spec's rule, in px: 0.75px, or 35% of the stroke once that is more.
      const clearance = Math.max(0.75, 0.35 * px(face('circle', size), face('circle', size).stroke));
      for (const shape of SHAPES)
        for (const state of Object.keys(STATES) as State[]) {
          const f = face(shape, size, state);
          for (const eye of f.pair) expect(room(f, eye), `${shape} at ${size}px, ${state}`).toBeGreaterThanOrEqual(clearance - 1e-9);
        }
    }
  });

  it('moves a pair from the spec\'s centres only where they would not clear at a size that draws them', () => {
    for (const shape of SHAPES)
      for (const stop of STOPS)
        for (const state of Object.keys(STATES) as State[]) {
          if (!fitted(shape, stop, state)) continue;
          const want = specPair(shape, stop, state);
          const short = CREW_CLEARED_SIZES.filter((size) => face(shape, size).stop === stop).some((size) => {
            const f = face(shape, size, state);
            // Glyph paths are written to a thousandth of a grid unit, so a pair needs 0.002 units more than the clearance.
            return want.some((p) => roomAt(f, p, f.pair[0].d) < crewClearance(size) + px(f, 0.002) - 1e-9);
          });
          expect(short, `${shape} at ${stop}px, ${state}`).toBe(true);
        }
  });

  it('tilts the pill-diagonal pair along the pill wherever it clears, and keeps it level elsewhere', () => {
    for (const stop of STOPS)
      for (const state of Object.keys(STATES) as State[]) {
        const [a, b] = face('pill-diagonal', stop, state).pair;
        const angle = (Math.atan2(b.cy - a.cy, b.cx - a.cx) * 180) / Math.PI;
        expect(Math.abs(angle - (PILL_DIAGONAL_LEVEL_STOPS.includes(stop) ? 0 : -38)), `${stop}px, ${state}`).toBeLessThan(0.6);
      }
    // A stop stays level only when the tilted pair would come too close to the outline there.
    for (const stop of PILL_DIAGONAL_LEVEL_STOPS) {
      const f = face('pill-diagonal', stop);
      expect(Object.keys(STATES).some((state) => tilted(specStop('pill-diagonal', stop).lay[STATES[state as State]].p).some((p) => roomAt(f, p as Point, f.pair[0].d) < crewClearance(stop)))).toBe(true);
    }
  });
});

describe('agentFace shows a thread\'s state in the eyes (D6, D7, D11)', () => {
  const eyesOf = (shows: Parameters<typeof agentFace>[1]['shows'], placement?: 'focus' | 'row' | 'still') =>
    agentFace({ id: 'someone', avatar: { shape: 'circle' } }, { size: 24, shows, placement })?.eyes;

  /** The decided eyes for each status mark in a list row (ADR 0021, Eyes for each state). */
  const IN_A_LIST: Record<Mark, string> = {
    idle: 'idle',
    stopped: 'idle',
    starting: 'working',
    working: 'working',
    tool: 'working',
    delegating: 'waiting',
    queued: 'waiting',
    limited: 'waiting',
    resuming: 'waiting',
    checking: 'waiting',
    question: 'needs',
    crew_question: 'needs',
    held: 'needs',
    signin: 'needs',
    review: 'needs',
    failed: 'needs',
    crew_failed: 'needs',
    setup_failed: 'needs',
    done: 'done',
  };

  it('gives every status mark in a list its eyes: circles while the agent has it, squares while it waits, diamonds for Ben, arcs once done', () => {
    for (const mark of Object.keys(MARK) as Mark[]) expect(eyesOf({ mark }, 'row'), mark).toBe(IN_A_LIST[mark]);
  });

  it('splits thinking from working in the open thread: starting or working thinks, a tool call works; every other mark as in a list', () => {
    const open: Partial<Record<Mark, string>> = { starting: 'thinking', working: 'thinking', tool: 'working' };
    for (const mark of Object.keys(MARK) as Mark[]) expect(eyesOf({ mark }, 'focus'), mark).toBe(open[mark] ?? IN_A_LIST[mark]);
  });

  it('gives every member state its eyes, a working member working even in focus', () => {
    const want: Record<MemberState, string> = { needs: 'needs', failed: 'needs', working: 'working', done: 'done', stopped: 'idle', idle: 'idle' };
    for (const placement of ['focus', 'row'] as const)
      for (const member of Object.keys(want) as MemberState[]) expect(eyesOf({ member }, placement), `${member} ${placement}`).toBe(want[member]);
  });

  it('shows a running thread working anywhere but in focus', () => {
    for (const placement of ['row', 'still', undefined] as const)
      for (const mark of ['starting', 'working', 'tool'] as const) expect(eyesOf({ mark }, placement), `${mark} ${placement}`).toBe('working');
  });

  it('splits the open thread by its rows, and shows the same thread working in a list', () => {
    const row = (kind: string, payload?: object) => ({ kind, payload: payload ? JSON.stringify(payload) : null });
    const running = { status: 'running' };
    const turns = {
      thinking: [row('user')],
      working: [row('user'), row('tool_use', { id: 'call-1' })],
      done: [row('user'), row('tool_use', { id: 'call-1' }), row('tool_result', { tool_use_id: 'call-1' })],
    };
    expect(eyesOf({ mark: threadMark(running, { turn: turnPhase([]) }) }, 'focus'), 'not picked up yet').toBe('thinking');
    expect(eyesOf({ mark: threadMark(running, { turn: turnPhase(turns.thinking) }) }, 'focus'), 'no call open').toBe('thinking');
    expect(eyesOf({ mark: threadMark(running, { turn: turnPhase(turns.working) }) }, 'focus'), 'a call open').toBe('working');
    expect(eyesOf({ mark: threadMark(running, { turn: turnPhase(turns.done) }) }, 'focus'), 'the call returned').toBe('thinking');
    expect(eyesOf({ mark: threadMark(running) }, 'row'), 'in a list').toBe('working');
    expect(eyesOf({ mark: threadMark({ status: 'running', setup: 'preparing' }) }, 'row'), 'its folder prepared, in a list').toBe('working');
  });

  it('never gives the needs you eyes for a mark that moves', () => {
    for (const placement of ['focus', 'row'] as const)
      for (const mark of Object.keys(MARK) as Mark[]) if (eyesOf({ mark }, placement) === 'needs') expect(MARK[mark].motion, mark).toBe('still');
  });

  it('shows idle eyes with nothing behind the avatar, wherever it sits (D11)', () => {
    for (const placement of ['focus', 'row', 'still', undefined] as const) expect(eyesOf(undefined, placement), String(placement)).toBe('idle');
  });

  it('shows eyes picked outright as they are, wherever it sits', () => {
    for (const placement of ['focus', 'row', 'still'] as const)
      for (const eyes of EYE_STATES) expect(eyesOf({ eyes }, placement), `${eyes} ${placement}`).toBe(eyes);
  });
});
