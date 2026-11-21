import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agentFace, type CharacterFace } from '../agent-avatar.ts';
import { AGENT_PALETTE, contrast } from '../avatar-color.ts';
import { crewShapesSource, OUT as CREW_SHAPES_FILE, SPEC_FILE } from '../scripts/build-crew-shapes.ts';
import { CREW_CLEARED_SIZES, CREW_FITTED, PILL_DIAGONAL_LEVEL_STOPS } from '../crew-shapes.ts';
import { crewClearance } from '../crew-size.ts';

// Seam A (ADR 0021, D27): the agent face, checked against the committed spec JSON.

interface SpecEye { k: string; p: [number, number][]; d: number }
interface SpecStop { G: number; dpath: string; fill: string; eye: string; sw: number; sat: [number, number, number] | null; lay: Record<string, SpecEye>; base: number; line: number }
interface Spec { palette: Record<string, string>; strokeStops_px: [number, number][]; shapes: Record<string, { colour: string; charter: string | null; sizes: Record<string, SpecStop> }> }

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
  if (f.kind !== 'character') throw new Error(`no character for ${shape}`);
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
function room(f: CharacterFace, eye: CharacterFace['pair'][number]) {
  const line = corners(f.outline);
  const pad = (eye.line ?? 0) / 2 + f.stroke / 2;
  const points = glyphPoints(eye.path);
  if (!points.every((p) => inside(p, line))) return -Infinity;
  return px(f, Math.min(...points.map((p) => distance(p, line) - pad)));
}

/** The same for a plain circle of the eye's diameter at another centre: what the spec's pair would draw. */
function roomAt(f: CharacterFace, centre: Point, d: number) {
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

/** The agent the spec draws each shape for, by the id its charter file carries; the spares have none. */
const SPEC_AGENTS = Object.fromEntries(SHAPES.flatMap((shape) => (SPEC.shapes[shape].charter ? [[SPEC.shapes[shape].charter!.replace(/^.*\//, '').replace(/\.md$/, ''), shape]] : [])));

describe('agentFace runs the chain: photo, then icon, then character', () => {
  it('draws an uploaded photo over an icon, and an icon or emoji on its color over the character', () => {
    const image = '/api/crew/designer/avatar?v=0123456789ab';
    expect(agentFace({ id: 'designer', avatar: { image, icon: '🎨', bg: '#52cdfe', shape: 'cloud' } }, { size: 24 })).toEqual({ kind: 'image', size: 24, image });
    expect(agentFace({ id: 'designer', avatar: { icon: '🎨', bg: '#52cdfe', shape: 'cloud' } }, { size: 24 })).toMatchObject({ kind: 'icon', size: 24, icon: '🎨', bg: '#52cdfe' });
    expect(agentFace({ id: 'designer', avatar: { bg: '#52cdfe', shape: 'cloud' } }, { size: 24 })).toMatchObject({ kind: 'character', shape: 'cloud', body: '#52cdfe' });
  });

  it("sits an icon with no color of its own on the agent's color, and treats empty fields as none", () => {
    expect(agentFace({ id: 'builder', avatar: { icon: 'icon:tool' } }, { size: 24 })).toMatchObject({ kind: 'icon', icon: 'icon:tool', bg: SPEC.palette.Amber });
    expect(agentFace({ id: 'builder', avatar: { icon: 'icon:tool', shape: 'diamond' } }, { size: 24 })).toMatchObject({ kind: 'icon', bg: SPEC.palette.Magenta });
    expect(agentFace({ id: 'builder', avatar: { image: '', icon: '', bg: '' } }, { size: 24 })).toMatchObject({ kind: 'character', shape: 'squircle', body: SPEC.palette.Amber });
    expect(agentFace({ id: 'builder', avatar: { image: null, icon: null, bg: null, shape: null } }, { size: 24 })).toMatchObject({ kind: 'character', shape: 'squircle' });
  });
});

describe('agentFace picks a face for an agent with no avatar of its own', () => {
  it('gives the nine built-in agents the shape the spec draws for them, in its paired color', () => {
    expect(Object.keys(SPEC_AGENTS).sort()).toEqual(['builder', 'conductor', 'hermes', 'inbox', 'researcher', 'reviewer', 'store-ops', 'usage-scan', 'writer']);
    for (const [id, shape] of Object.entries(SPEC_AGENTS))
      expect(agentFace({ id }, { size: 32 }), id).toMatchObject({ kind: 'character', shape, body: SPEC.palette[SPEC.shapes[shape].colour] });
  });

  it('gives any other agent one of the seven spare shapes and its paired color, from its id', () => {
    const spares = SHAPES.filter((shape) => !SPEC.shapes[shape].charter);
    expect(spares).toEqual(['diamond', 'bubble', 'cloud', 'pill-diagonal', 'fan', 'shield', 'bucket']);
    const ids = Array.from({ length: 60 }, (_, i) => `agent-${i}`).concat(['designer', 'release-scout', 'fixture-agent', 'constructor', '']);
    const picked = new Set<string>();
    for (const id of ids) {
      const f = agentFace({ id }, { size: 24 });
      if (f.kind !== 'character') throw new Error(`no character for ${id}`);
      expect(spares, id).toContain(f.shape);
      expect(f.body, id).toBe(SPEC.palette[SPEC.shapes[f.shape].colour]);
      // The same agent gets the same pair on every call, at every size and in every state.
      expect(agentFace({ id }, { size: 88, shows: { eyes: 'done' } }), id).toMatchObject({ shape: f.shape, body: f.body });
      picked.add(f.shape);
    }
    expect([...picked].sort()).toEqual([...spares].sort());
    expect(agentFace({ id: 'designer' }, { size: 24 })).toMatchObject({ shape: 'bucket', body: SPEC.palette.Amber });
  });
});

describe('the agent palette', () => {
  it("holds the spec's 14 colors, in the order the shapes pair them", () => {
    const paired = [...new Set(SHAPES.map((shape) => SPEC.shapes[shape].colour))];
    expect(AGENT_PALETTE.map((c) => c.name)).toEqual(paired);
    expect(paired).toEqual(['Ink', 'Sky', 'Amber', 'Violet', 'Rose', 'Mint', 'Green', 'Sun', 'Lilac', 'Magenta', 'Azure', 'Aqua', 'Teal', 'Peach']);
    expect(Object.fromEntries(AGENT_PALETTE.map((c) => [c.name, c.hex]))).toEqual(SPEC.palette);
  });

  it('never gives an agent a status color', () => {
    // Ultramarine, Vermilion and Volt: running, needs you and done (--live, --needs, --done).
    const reserved = ['#2b3bff', '#ff4420', '#c6f52b'];
    for (const { hex } of AGENT_PALETTE) expect(reserved).not.toContain(hex);
    for (const shape of SHAPES) expect(reserved).not.toContain(face(shape, 24).body);
  });

  it('inks the eyes as the spec does, the dark ink or white, whichever reads, at 3:1 or more', () => {
    for (const shape of SHAPES)
      for (const stop of STOPS) {
        const f = face(shape, stop);
        expect(f.ink, `${shape} at ${stop}px`).toBe(specStop(shape, stop).eye);
        expect(contrast(f.ink, f.body), `${shape} at ${stop}px`).toBeGreaterThanOrEqual(3);
      }
    const inkOf = Object.fromEntries(SHAPES.map((shape) => [SPEC.shapes[shape].colour, specStop(shape, 24).eye]));
    for (const { name, hex } of AGENT_PALETTE) {
      expect(agentFace({ id: 'someone', avatar: { bg: hex, shape: 'cloud' } }, { size: 24 }), name).toMatchObject({ body: hex, ink: inkOf[name] });
      expect(agentFace({ id: 'someone', avatar: { bg: hex, icon: '🎨' } }, { size: 24 }), name).toMatchObject({ bg: hex, ink: inkOf[name] });
    }
  });
});
