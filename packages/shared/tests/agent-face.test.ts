import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agentFace, conductorChannelLook, type CharacterFace, type FaceOptions } from '../agent-avatar.ts';
import type { BodyMotion, EyeMotion } from '../crew-motion.ts';
import { AGENT_PALETTE, contrast } from '../avatar-color.ts';
import { crewShapesSource, OUT as CREW_SHAPES_FILE, SPEC_FILE } from '../scripts/build-crew-shapes.ts';
import { CREW_CLEARED_SIZES, CREW_FITTED, EYE_STATES, PILL_DIAGONAL_LEVEL_STOPS } from '../crew-shapes.ts';
import { crewClearance } from '../crew-size.ts';
import type { MemberState } from '../members.ts';
import { MARK, threadMark, turnPhase, type Mark } from '../status.ts';

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
    expect(agentFace({ id: 'designer', avatar: { image, icon: '🎨', bg: '#52cdfe', shape: 'cloud' } }, { size: 24 })).toEqual({ kind: 'image', size: 24, image, ring: null });
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

describe("the Conductor answers in its channel's look until its agent has a photo or icon (D9)", () => {
  const channel = { name: 'Conductor', icon: '🎼', avatar_bg: '#ffc943' };
  it('draws the Conductor agent’s own photo or icon over its channel’s saved look', () => {
    expect(conductorChannelLook({ id: 'conductor', avatar: { image: '/api/crew/conductor/avatar?v=1' } }, channel)).toBeNull();
    expect(conductorChannelLook({ id: 'conductor', avatar: { icon: 'icon:zap' } }, channel)).toBeNull();
  });

  it('draws the channel’s saved icon or background over the crew character, a new color or shape of the agent’s included', () => {
    expect(conductorChannelLook({ id: 'conductor' }, channel)).toBe(channel);
    expect(conductorChannelLook({ id: 'conductor', avatar: { bg: '#52cdfe', shape: 'cloud' } }, { name: 'Conductor', avatar_bg: '#ffc943' })).toEqual({ name: 'Conductor', avatar_bg: '#ffc943' });
  });

  it('draws the crew character when the channel has no look of its own, and every other agent its own avatar', () => {
    expect(conductorChannelLook({ id: 'conductor' }, { name: 'Conductor', icon: null, avatar_bg: null })).toBeNull();
    expect(conductorChannelLook({ id: 'conductor' }, null)).toBeNull();
    expect(conductorChannelLook({ id: 'builder' }, channel)).toBeNull();
    expect(conductorChannelLook(null, channel)).toBeNull();
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

describe('agentFace shows a thread\'s state in the eyes (D6, D7, D11)', () => {
  const eyesOf = (shows: Parameters<typeof agentFace>[1]['shows'], placement?: 'focus' | 'row' | 'still') => {
    const f = agentFace({ id: 'someone', avatar: { shape: 'circle' } }, { size: 24, shows, placement });
    return f.kind === 'character' ? f.eyes : null;
  };

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

describe('agentFace moves a character as the Motion board does (D10, D17, D18, D25)', () => {
  /** A circle at 32px showing `eyes`, in focus unless `opts` says otherwise, and its motion. */
  const face32 = (eyes: State, opts: Partial<FaceOptions> = {}) => {
    const f = agentFace({ id: 'someone', avatar: { shape: 'circle' } }, { size: 32, shows: { eyes }, placement: 'focus', ...opts });
    if (f.kind !== 'character') throw new Error('no character');
    return f;
  };
  const motionOf = (eyes: State, opts: Partial<FaceOptions> = {}) => face32(eyes, opts).motion;
  /** Nothing plays. */
  const STILL = { body: null, eyes: null, change: null, pop: null };
  /** A body animation's frames as [at, lift, turn, width, height]. */
  const bodyFrames = (m: BodyMotion | null) => m?.frames.map((f) => [f.at, f.y, f.rotate, f.sx, f.sy]);

  it('breathes an idle agent in focus: 4.8s on the fluid curve, scale 1.025 × .975 and back, looping', () => {
    const body = motionOf('idle').body;
    expect(body).toMatchObject({ ms: 4800, loop: true });
    expect(bodyFrames(body)).toEqual([[0, 0, 0, 1, 1], [0.5, 0, 0, 1.025, 0.975], [1, 0, 0, 1, 1]]);
    expect(body!.frames.every((f) => f.ease === 'fluid')).toBe(true);
  });

  it('sways a thinking agent ±2.5° about 50% 70% every 2.4s, and starts the swing from upright', () => {
    const body = motionOf('thinking').body!;
    expect(body).toMatchObject({ ms: 2400, loop: true, origin: [0.5, 0.7] });
    expect(bodyFrames(body)).toEqual([[0, 0, -2.5, 1, 1], [0.5, 0, 2.5, 1, 1], [1, 0, -2.5, 1, 1]]);
    // A quarter in, the fluid curve is halfway from -2.5° to 2.5°: upright.
    expect(body.phase).toBe(0.25);
    expect(body.frames.every((f) => f.ease === 'fluid')).toBe(true);
  });

  it('bounces a working agent every .84s with the spec keyframes, lifting by shares of its size', () => {
    const body = motionOf('working').body!;
    expect(body).toMatchObject({ ms: 840, loop: true, origin: [0.5, 1] });
    // 50% names only the lift; its squash runs straight between 28% and 74%.
    expect(bodyFrames(body)).toEqual([[0, 0, 0, 1.06, 0.94], [0.28, -0.07, 0, 0.96, 1.05], [0.5, -0.1, 0, 0.97, 1.036], [0.74, -0.03, 0, 0.98, 1.02], [1, 0, 0, 1.06, 0.94]]);
    expect(body.frames.every((f) => f.ease === 'fluid')).toBe(true);
  });

  it('breathes a waiting agent slowly: 3.2s, scale 1.04 × .955', () => {
    const body = motionOf('waiting').body!;
    expect(body).toMatchObject({ ms: 3200, loop: true, origin: [0.5, 1] });
    expect(bodyFrames(body)).toEqual([[0, 0, 0, 1, 1], [0.5, 0, 0, 1.04, 0.955], [1, 0, 0, 1, 1]]);
  });

  /** The poses an eye loop passes through, holds folded. */
  const poses = (m: EyeMotion | null) => m?.frames[0].map((f) => f.pose).filter((p, i, all) => i === 0 || p !== all[i - 1]);
  /** Where an eye frame puts each eye, in grid units. */
  const centres = (f: CharacterFace, m: EyeMotion, i: number) => f.pair.map((e, k) => [e.cx + m.frames[k][i].dx, e.cy + m.frames[k][i].dy]);
  /** The spec's centres for a pose of the circle at 32px. */
  const at32 = (pose: string) => SPEC.shapes.circle.sizes['32'].lay[pose].p;
  const closeTo = (got: number[][], want: number[][]) => got.forEach((p, k) => p.forEach((v, j) => expect(v).toBeCloseTo(want[k][j], 6)));

  it('blinks an idle agent\'s eyes twice, then glances, every 7.0s, through the spec\'s poses', () => {
    const f = face32('idle');
    const eyes = f.motion.eyes!;
    expect(eyes).toMatchObject({ ms: 7000, loop: true });
    expect(poses(eyes)).toEqual(['idle', 'blink', 'idle', 'blink', 'idle', 'think_r', 'idle']);
    eyes.frames[0].forEach((frame, i) => {
      // Each frame puts the eyes on its pose's centres; a blink closes them to the lid's height on the blink's own.
      closeTo(centres(f, eyes, i), at32(frame.pose));
      const lid = SPEC.shapes.circle.sizes['32'].line / SPEC.shapes.circle.sizes['32'].lay.blink.d;
      expect([frame.sx, frame.sy], frame.pose).toEqual(frame.pose === 'blink' ? [1, expect.closeTo(lid, 2)] : [1, 1]);
    });
    // Both blinks are quick: shut and open again within a fifth of a second.
    const at = (i: number) => eyes.frames[0][i].at * eyes.ms;
    const blinks = eyes.frames[0].flatMap((frame, i) => (frame.pose === 'blink' ? [at(i + 1) - at(i - 1)] : []));
    expect(blinks).toHaveLength(2);
    for (const ms of blinks) expect(ms).toBeLessThanOrEqual(220);
  });

  it('looks a thinking agent\'s eyes centre, left, centre, blink, right every 4.3s, blinking where they look', () => {
    const f = face32('thinking');
    const eyes = f.motion.eyes!;
    expect(eyes).toMatchObject({ ms: 4300, loop: true });
    expect(poses(eyes)).toEqual(['think_c', 'think_l', 'think_c', 'blink', 'think_c', 'think_r', 'think_c']);
    const drop = at32('blink').map((p, k) => [p[0] - at32('idle')[k][0], p[1] - at32('idle')[k][1]]);
    eyes.frames[0].forEach((frame, i) => {
      const want = frame.pose === 'blink' ? at32('think_c').map((p, k) => [p[0] + drop[k][0], p[1] + drop[k][1]]) : at32(frame.pose);
      closeTo(centres(f, eyes, i), want);
    });
  });

  it('scans a working agent\'s eyes left and right, 0.4s each', () => {
    const f = face32('working');
    const eyes = f.motion.eyes!;
    expect(eyes).toMatchObject({ ms: 800, loop: true });
    expect(poses(eyes)).toEqual(['work_c', 'work_l', 'work_r', 'work_c']);
    const at = (pose: string) => eyes.frames[0].find((frame) => frame.pose === pose)!.at * eyes.ms;
    expect(at('work_r') - at('work_l')).toBe(400);
    expect(eyes.ms - (at('work_r') - at('work_l'))).toBe(400);
    eyes.frames[0].forEach((frame, i) => closeTo(centres(f, eyes, i), at32(frame.pose)));
  });

  it('breathes a waiting agent\'s squares with its body, over the same 3.2s, in place', () => {
    const eyes = motionOf('waiting').eyes!;
    expect(eyes).toMatchObject({ ms: 3200, loop: true });
    for (const side of eyes.frames) {
      expect(side.every((frame) => frame.pose === 'waiting' && frame.dx === 0 && frame.dy === 0 && frame.sx === frame.sy)).toBe(true);
      expect(Math.min(...side.map((frame) => frame.sx))).toBeLessThan(1);
    }
  });

  it('loops in focus, and in a row only while it works: a still avatar or one placed nowhere has no loop', () => {
    for (const eyes of Object.keys(STATES) as State[])
      for (const placement of ['row', 'still', undefined] as const) {
        if (placement === 'row' && eyes === 'working') continue;
        expect(motionOf(eyes, { placement }), `${eyes} ${placement}`).toMatchObject({ body: null, eyes: null });
      }
  });

  it('plays the working loop on a row or card avatar, the same loop as in focus, without the agent-switch pop', () => {
    const row = motionOf('working', { placement: 'row' });
    const focus = motionOf('working', { placement: 'focus' });
    expect(row.body).not.toBeNull();
    expect(row.eyes).not.toBeNull();
    expect(row.body).toEqual(focus.body);
    expect(row.eyes).toEqual(focus.eyes);
    expect(row.pop).toBeNull();
    expect(motionOf('working', { placement: 'row', reducedMotion: true })).toEqual(STILL);
  });

  it('plays nothing at all under reduced motion, wherever it sits, and rests each state on its own eyes', () => {
    for (const eyes of Object.keys(STATES) as State[])
      for (const placement of ['focus', 'row', 'still'] as const) {
        const f = face32(eyes, { placement, reducedMotion: true, from: eyes === 'idle' ? 'done' : 'idle' });
        expect(f.motion, `${eyes} ${placement}`).toEqual(STILL);
        expect(face32(eyes, { placement: 'still', from: eyes === 'idle' ? 'done' : 'idle' }).motion, `${eyes} still`).toEqual(STILL);
        expect(f.pair.map((e) => e.glyph), `${eyes} ${placement}`).toEqual([SPEC.shapes.circle.sizes['32'].lay[STATES[eyes]].k, SPEC.shapes.circle.sizes['32'].lay[STATES[eyes]].k]);
      }
  });

  /** An eye animation's frames of one eye as [at, dx, dy, width, height]. */
  const eyeFrames = (m: EyeMotion, k = 0) => m.frames[k].map((f) => [f.at, f.dx, f.dy, f.sx, f.sy]);

  it('plays no change on first render, nor when the eyes stay what they were', () => {
    for (const eyes of Object.keys(STATES) as State[])
      for (const placement of ['focus', 'row'] as const) {
        expect(motionOf(eyes, { placement }).change, `${eyes} ${placement}`).toBeNull();
        expect(motionOf(eyes, { placement, from: eyes }).change, `${eyes} ${placement} from itself`).toBeNull();
      }
  });

  it('squeezes the eyes shut into needs you and springs them open on the diamonds, then nothing moves', () => {
    const m = motionOf('needs', { from: 'working' });
    const { squeeze, open, body } = m.change!;
    // The squeeze plays on the eyes drawn until now, where they are: 1.15 × .06 in 110ms on the stretch curve.
    expect(squeeze).toMatchObject({ ms: 110, loop: false });
    for (const k of [0, 1] as const) expect(eyeFrames(squeeze, k)).toEqual([[0, 0, 0, 1, 1], [1, 0, 0, 1.15, 0.06]]);
    expect(squeeze.frames[0][0].ease).toBe('stretch');
    // The new eyes spring open from there, on their own centres.
    expect(open).toMatchObject({ loop: false });
    for (const k of [0, 1] as const) expect(eyeFrames(open, k)).toEqual([[0, 0, 0, 1.15, 0.06], [1, 0, 0, 1, 1]]);
    expect(open.frames[0][0]).toMatchObject({ pose: 'needs', ease: 'spring' });
    expect(body).toBeNull();
    expect(m).toMatchObject({ body: null, eyes: null });
  });

  it('plays a change in a list row too, with no loop after it', () => {
    const m = motionOf('waiting', { placement: 'row', from: 'working' });
    expect(m.change?.squeeze.ms).toBe(110);
    expect(m).toMatchObject({ body: null, eyes: null });
    // In focus the new state's loops follow the change.
    expect(motionOf('waiting', { from: 'working' })).toMatchObject({ body: { ms: 3200 }, eyes: { ms: 3200 }, change: { squeeze: { ms: 110 } } });
  });

  it('adds a beat of wide eyes from idle to thinking: 1.22 on the wide pose in 260ms on the spring, held .3s, then to rest', () => {
    const f = face32('thinking', { from: 'idle' });
    const { open } = f.motion.change!;
    expect(open.ms).toBe(260 + 300 + 260);
    expect(open.frames[0].map((frame) => [frame.at * open.ms, frame.pose, frame.sx, frame.sy, frame.ease])).toEqual([
      [0, 'wide', 1.15, 0.06, 'spring'],
      [260, 'wide', 1.22, 1.22, 'fluid'],
      [560, 'wide', 1.22, 1.22, 'settle'],
      [820, 'think_c', 1, 1, 'settle'],
    ]);
    // The beat sits on the spec's wide centres; the rest is thinking's own.
    for (const i of [0, 1, 2]) closeTo(centres(f, open, i), at32('wide'));
    closeTo(centres(f, open, 3), at32('think_c'));
    // Any other change into thinking just opens.
    expect(face32('thinking', { from: 'working' }).motion.change!.open.ms).toBe(260);
  });

  it('hops once on a live change to done: .95s on the settle curve with the spec keyframes, in focus and in a row', () => {
    for (const placement of ['focus', 'row'] as const) {
      const { change, body } = motionOf('done', { placement, from: 'working' });
      expect(body, placement).toBeNull();
      expect(change!.body, placement).toMatchObject({ ms: 950, loop: false, origin: [0.5, 1] });
      expect(bodyFrames(change!.body)).toEqual([[0, 0, 0, 1, 1], [0.16, 0, 0, 1.1, 0.88], [0.42, -0.16, 0, 0.93, 1.09], [0.66, 0, 0, 1.08, 0.92], [0.82, 0, 0, 0.98, 1.03], [1, 0, 0, 1, 1]]);
      expect(change!.body!.frames.every((frame) => frame.ease === 'settle')).toBe(true);
    }
    // No other change hops.
    for (const eyes of ['idle', 'thinking', 'working', 'waiting', 'needs'] as const) expect(motionOf(eyes, { from: 'done' }).change!.body, eyes).toBeNull();
  });

  it('pops the body when the agent in focus changes: .6s on the spring from .7, about its centre, once', () => {
    for (const eyes of Object.keys(STATES) as State[]) {
      const pop = motionOf(eyes).pop;
      expect(pop, eyes).toMatchObject({ ms: 600, loop: false, origin: [0.5, 0.5] });
      expect(bodyFrames(pop)).toEqual([[0, 0, 0, 0.7, 0.7], [1, 0, 0, 1, 1]]);
      expect(pop!.frames[0].ease).toBe('spring');
      expect(motionOf(eyes, { placement: 'row' }).pop, `${eyes} in a row`).toBeNull();
    }
  });

  it('holds needs you and done still: no loop of the body or the eyes', () => {
    for (const eyes of ['needs', 'done'] as const) expect(motionOf(eyes), eyes).toMatchObject({ body: null, eyes: null });
  });
});
