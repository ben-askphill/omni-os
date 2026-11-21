// Writes packages/shared/crew-shapes.ts, the crew characters' drawings (ADR 0021): `npm run build:crew-shapes -w @omni/shared`.
// It reads the spec export committed beside it (crew-avatars-spec/omni-crew-avatars-spec.json) and nothing else: no
// code from the export runs (D12, D14). A geometry fix is a change to that JSON and a regenerate.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SPEC_FILE = fileURLToPath(new URL('./crew-avatars-spec/omni-crew-avatars-spec.json', import.meta.url));
export const OUT = fileURLToPath(new URL('../crew-shapes.ts', import.meta.url));

type Point = [number, number];
type Pair = [Point, Point];
interface SpecEye { k: string; p: Pair; d: number }
interface SpecStop { G: number; dpath: string; fill: string; sw: number; sat: [number, number, number] | null; lay: Record<string, SpecEye>; base: number; line: number }
interface SpecShape { colour: string; sizes: Record<string, SpecStop> }
export interface Spec { palette: Record<string, string>; strokeStops_px: Point[]; layouts: string[]; shapes: Record<string, SpecShape> }

export const readSpec = (): Spec => JSON.parse(readFileSync(SPEC_FILE, 'utf8'));

/** The size stops the spec names. The export has no 16 entry: 16px draws the 18 drawing (below). */
const STOPS = [16, 18, 24, 32, 48, 64] as const;
type Stop = (typeof STOPS)[number];
/** The export entry each stop draws. 36 and 128 are not stops: 33 to 40px draw 32, and 128 is the 64 drawing again. */
const SOURCE: Record<Stop, string> = { 16: '18', 18: '18', 24: '24', 32: '32', 48: '48', 64: '64' };
/** The size table's eye at 16px (D24): the table wins over the export's stated ratio, 1.55 × 1.4. */
const EYE_AT_16 = 2.44;
/** The pose each eye state rests on. Thinking and working are the centred ones of their glance. */
const STATE_POSE = { idle: 'idle', thinking: 'think_c', working: 'work_c', waiting: 'waiting', needs: 'needs', done: 'done' } as const;

/**
 * The sizes avatars draw at (ADR 0021, D22). At each one every eye of every pose stays the clearance inside the
 * outline's stroke. A new avatar size goes here, and the regenerate fits the eyes for it.
 */
const CLEARED_SIZES = [16, 18, 20, 22, 24, 28, 30, 32, 48, 64, 88] as const;
/** The pill-diagonal's eyes lie along the pill (D21), at every stop where the tilted pair clears. */
const PILL_DIAGONAL_TILT = -38;
/**
 * How close a fit pulls two eyes together, centre to centre, in eye diameters: as close as the spec's own pairs get.
 * Where even that does not clear (the wide-eyed beat in the narrow pill), the eyes may meet, never overlap.
 */
const FIT_GAP = 1.2;
/** Headroom, in grid units, for the eye glyphs' paths, which are written to a thousandth of a unit. */
const PATH_HEADROOM = 0.002;

const json = (v: unknown) => JSON.stringify(v);
const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;
const at2 = ([x, y]: Point): Point => [round(x, 2), round(y, 2)];

// Size math, as crew-size.ts has it, from the stops the spec gives (that module reads the file this script writes).
interface Sizes { strokeStops: Point[]; eyeStops: Point[]; largeStroke: number; largeEye: number }
function between(stops: Point[], px: number) {
  if (px <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (px <= stops[i][0]) return stops[i - 1][1] + ((stops[i][1] - stops[i - 1][1]) * (px - stops[i - 1][0])) / (stops[i][0] - stops[i - 1][0]);
  return stops[stops.length - 1][1];
}
const strokeAt = (z: Sizes, px: number) => (px >= 64 ? z.largeStroke * px : between(z.strokeStops, px));
const eyeAt = (z: Sizes, px: number) => Math.max(2, px >= 64 ? z.largeEye * px : between(z.eyeStops, px));
const clearanceAt = (z: Sizes, px: number) => Math.max(0.75, 0.35 * strokeAt(z, px));
const gridAt = (px: number) => (px >= 32 ? 128 : px >= 19 ? 24 : 18);
function stopAt(px: number): Stop {
  const on = STOPS.filter((s) => gridAt(s) === gridAt(px));
  return on.reduce((best, s) => (Math.abs(s - px) < Math.abs(best - px) ? s : best));
}

// Outline geometry: the outline is one closed polyline, and an eye clears it when its centre is inside and its circle
// stays the clearance away from the stroke's inner edge.
const polyline = (d: string): Point[] => [...d.matchAll(/[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
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
const clears = (pair: Pair, line: Point[], reach: number) => pair.every((p) => inside(p, line) && distance(p, line) >= reach);

function tilt([a, b]: Pair, degrees: number): Pair {
  const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [c, s] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
  const turn = ([x, y]: Point): Point => at2([mx + (x - mx) * c - (y - my) * s, my + (x - mx) * s + (y - my) * c]);
  return [turn(a), turn(b)];
}

/**
 * The spec's pair moved inward the least that clears: pulled together about its midpoint (as the spec's own pairs are
 * in tight shapes), then shifted, keeping its slant. Least means the eye that moves furthest moves the least.
 */
function fit(pair: Pair, line: Point[], reach: number, eye: number, pose: number, grid: number, what: string): Pair {
  const best = fitWithin(pair, line, reach, FIT_GAP * eye, eye, grid) ?? fitWithin(pair, line, reach, pose, eye, grid);
  check(best !== null, `no fit clears the eyes of ${what}`);
  return best;
}

function fitWithin(pair: Pair, line: Point[], reach: number, closest: number, eye: number, grid: number): Pair | null {
  const [a, b] = pair;
  const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const half: Point = [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2];
  const spread = Math.hypot(half[0], half[1]) * 2;
  const step = grid / 1800;
  let best: { pair: Pair; cost: number } | null = null;
  for (let f = 1; f * spread >= Math.min(spread, closest) - 1e-9; f = round(f - 0.01, 2)) {
    if (best && (1 - f) * (spread / 2) >= best.cost) break;
    // A shift of r moves one of the two eyes at least r, so a ring past the best cost cannot beat it.
    for (let r = 0; r <= eye && !(best && r >= best.cost); r += step) {
      const turns = r === 0 ? 1 : 120;
      let found: { pair: Pair; cost: number } | null = null;
      for (let i = 0; i < turns; i++) {
        const [tx, ty] = [r * Math.cos((i * 2 * Math.PI) / turns), r * Math.sin((i * 2 * Math.PI) / turns)];
        const moved: Pair = [at2([mid[0] - f * half[0] + tx, mid[1] - f * half[1] + ty]), at2([mid[0] + f * half[0] + tx, mid[1] + f * half[1] + ty])];
        if (!clears(moved, line, reach)) continue;
        const cost = Math.max(Math.hypot(moved[0][0] - a[0], moved[0][1] - a[1]), Math.hypot(moved[1][0] - b[0], moved[1][1] - b[1]));
        if (!found || cost < found.cost) found = { pair: moved, cost };
      }
      if (found) {
        if (!best || found.cost < best.cost - 1e-9) best = found;
        break;
      }
    }
  }
  return best?.pair ?? null;
}

function check(ok: boolean, what: string): asserts ok {
  if (!ok) throw new Error(`crew avatars spec: ${what}`);
}

/** One value across every shape, or the spec disagrees with itself. */
function same<T>(values: T[], what: string): T {
  const first = JSON.stringify(values[0]);
  check(values.every((v) => JSON.stringify(v) === first), `${what} differs between shapes`);
  return values[0];
}

export function crewShapes(spec: Spec) {
  const ids = Object.keys(spec.shapes);
  check(ids.length === 16, `${ids.length} shapes, not 16`);
  const poses = spec.layouts;
  const stop = (id: string, s: Stop) => spec.shapes[id].sizes[SOURCE[s]];

  const shapes = Object.fromEntries(
    ids.map((id) => {
      const shape = spec.shapes[id];
      const color = spec.palette[shape.colour];
      check(/^#[0-9a-f]{6}$/.test(color ?? ''), `${id} has no palette colour`);
      check(json(shape.sizes['128'].dpath + json(shape.sizes['128'].lay)) === json(shape.sizes['64'].dpath + json(shape.sizes['64'].lay)), `${id}'s 128px drawing is not its 64px one`);
      const sizes = Object.fromEntries(
        STOPS.map((s) => {
          const e = stop(id, s);
          check(/^M[^MCQASTHV]*Z$/.test(e.dpath), `${id} at ${SOURCE[s]}px is not one closed polyline`);
          check(e.fill === color, `${id} at ${SOURCE[s]}px is not filled with its colour`);
          return [s, { grid: e.G, d: e.dpath, ...(e.sat && { satellite: { cx: e.sat[0], cy: e.sat[1], r: e.sat[2] } }) }];
        }),
      );
      return [id, { color, colorName: shape.colour, layout: id, sizes }];
    }),
  );

  const poseScale = Object.fromEntries(poses.map((pose) => [pose, same(ids.flatMap((id) => STOPS.map((s) => round(stop(id, s).lay[pose].d / stop(id, s).base, 2))), `the ${pose} eye's size`)]));
  const glyphs = (s: Stop) => Object.fromEntries(poses.map((pose) => [pose, same(ids.map((id) => stop(id, s).lay[pose].k), `the ${pose} glyph at ${s}px`)]));
  const small = same([glyphs(16), glyphs(18), glyphs(24)], 'the small glyph set');
  const large = same([glyphs(32), glyphs(48), glyphs(64)], 'the large glyph set');

  const strokeStops = spec.strokeStops_px;
  check(JSON.stringify(strokeStops.map(([px]) => px)) === JSON.stringify(STOPS), 'stroke stops are not the size stops');
  const eyeStops = STOPS.map((s): Point => [s, s === 16 ? EYE_AT_16 : round(same(ids.map((id) => stop(id, s).base), `the eye at ${s}px`) * (s / stop(ids[0], s).G))]);
  for (const s of STOPS.slice(1)) {
    const e = stop(ids[0], s);
    check(round((e.sw * s) / e.G) === strokeStops.find(([px]) => px === s)?.[1], `the ${s}px stroke disagrees with the stroke stops`);
  }
  const top = stop(ids[0], 64);
  // The line glyphs (lid, chevron, arc): a share of the eye, never under a floor in px. Every stop's `line` follows it.
  const lineRatio = round(top.line / top.base, 3);
  const lineMin = round((stop(ids[0], 18).line * 18) / stop(ids[0], 18).G, 3);
  for (const s of STOPS.slice(1)) {
    const e = stop(ids[0], s);
    check(Math.abs(Math.max(lineRatio * e.base, (lineMin * e.G) / s) - e.line) < 0.002, `the ${s}px eye line is not ${lineRatio} of the eye, at least ${lineMin}px`);
  }

  // Eye centres: the spec's, tilted for the pill-diagonal (D21), and fitted where they would not clear (CLEARED_SIZES).
  const z: Sizes = { strokeStops, eyeStops, largeStroke: top.sw / top.G, largeEye: top.base / top.G };
  const served = (s: Stop) => CLEARED_SIZES.filter((px) => stopAt(px) === s);
  const reach = (id: string, s: Stop, pose: string) => PATH_HEADROOM + Math.max(...served(s).map((px) => (((eyeAt(z, px) * poseScale[pose]) / 2 + strokeAt(z, px) / 2 + clearanceAt(z, px)) * stop(id, s).G) / px));
  const eyeSize = (id: string, s: Stop, scale = 1) => Math.max(...served(s).map((px) => (eyeAt(z, px) * scale * stop(id, s).G) / px));
  const level: Stop[] = [];
  const fitted: Record<string, Partial<Record<Stop, string[]>>> = {};
  const layouts = Object.fromEntries(
    ids.map((id) => {
      const byStop = STOPS.map((s) => {
        const line = polyline(stop(id, s).dpath);
        let pairs = Object.fromEntries(poses.map((pose) => [pose, stop(id, s).lay[pose].p]));
        if (id === 'pill-diagonal') {
          const turned = Object.fromEntries(poses.map((pose) => [pose, tilt(pairs[pose], PILL_DIAGONAL_TILT)]));
          if (poses.every((pose) => clears(turned[pose], line, reach(id, s, pose)))) pairs = turned;
          else level.push(s);
        }
        for (const pose of poses) {
          if (clears(pairs[pose], line, reach(id, s, pose))) continue;
          pairs[pose] = fit(pairs[pose], line, reach(id, s, pose), eyeSize(id, s), eyeSize(id, s, poseScale[pose]), stop(id, s).G, `${id} at ${s}px, ${pose}`);
          ((fitted[id] ??= {})[s] ??= []).push(pose);
        }
        return [s, pairs];
      });
      return [id, Object.fromEntries(byStop)];
    }),
  );

  return { ids, poses, shapes, layouts, level, fitted, poseScale, small, large, strokeStops, eyeStops, largeStroke: [top.sw, top.G], largeEye: [top.base, top.G], lineRatio, lineMin };
}

export function crewShapesSource(spec: Spec = readSpec()): string {
  const c = crewShapes(spec);
  const lit = (list: readonly (string | number)[]) => list.map((v) => json(v)).join(' | ');
  const shapeLines = c.ids.map((id) => {
    const s = c.shapes[id];
    const sizes = STOPS.map((stop) => `      ${stop}: ${json(s.sizes[stop])},`).join('\n');
    return `  ${json(id)}: {\n    color: ${json(s.color)},\n    colorName: ${json(s.colorName)},\n    layout: ${json(s.layout)},\n    sizes: {\n${sizes}\n    },\n  },`;
  });
  const layoutLines = c.ids.map((id) => {
    const stops = STOPS.map((stop) => `    ${stop}: ${json(c.layouts[id][stop])},`).join('\n');
    return `  ${json(id)}: {\n${stops}\n  },`;
  });
  return [
    '// Generated by packages/shared/scripts/build-crew-shapes.ts from scripts/crew-avatars-spec/omni-crew-avatars-spec.json.',
    '// Do not edit: change the spec JSON and run `npm run build:crew-shapes -w @omni/shared` (ADR 0021).',
    '// Outlines and eye centres are upright, in grid units; the avatar leans at draw time (crewLean).',
    '',
    `export const CREW_SHAPE_IDS = ${json(c.ids)} as const;`,
    'export type CrewShapeId = (typeof CREW_SHAPE_IDS)[number];',
    '',
    '/** What the eyes show. Idle, thinking and working differ only in where the pair sits. */',
    `export const EYE_STATES = ${json(Object.keys(STATE_POSE))} as const;`,
    'export type EyeState = (typeof EYE_STATES)[number];',
    '/** Every pose the eyes take: the six states rest on one each, and motion passes through the others. */',
    `export const EYE_POSES = ${json(c.poses)} as const;`,
    'export type EyePose = (typeof EYE_POSES)[number];',
    '/** The pose each eye state rests on, still. */',
    `export const EYE_STATE_POSE: Record<EyeState, EyePose> = ${json(STATE_POSE)};`,
    '',
    '/** The sizes with a drawing of their own. Every other size draws the nearest one on its grid (crewStop). */',
    `export const SIZE_STOPS = ${json(STOPS)} as const;`,
    'export type SizeStop = (typeof SIZE_STOPS)[number];',
    'export type CrewGrid = 18 | 24 | 128;',
    `export type EyeGlyphKind = ${lit([...new Set([...Object.values(c.small), ...Object.values(c.large)])])};`,
    '',
    'export interface CrewStopDrawing {',
    '  grid: CrewGrid;',
    '  /** The closed outline: one polyline, filled with the agent color and stroked in the theme foreground. */',
    '  d: string;',
    '  /** The Conductor\'s satellite droplet, in the outline\'s color. */',
    '  satellite?: { cx: number; cy: number; r: number };',
    '}',
    'export interface CrewShape {',
    '  /** The palette color the design pairs with the shape (D13). */',
    '  color: string;',
    '  colorName: string;',
    '  /** Key into CREW_LAYOUTS. */',
    '  layout: string;',
    '  sizes: Record<SizeStop, CrewStopDrawing>;',
    '}',
    '',
    'export const CREW_SHAPES: Record<CrewShapeId, CrewShape> = {',
    ...shapeLines,
    '};',
    '',
    'export type EyePair = readonly [readonly [number, number], readonly [number, number]];',
    '/** The two eye centres per layout, size stop and pose. */',
    'export const CREW_LAYOUTS: Record<string, Record<SizeStop, Record<EyePose, EyePair>>> = {',
    ...layoutLines,
    '};',
    '',
    '/** Each pose\'s eye diameter, as a share of the size\'s eye (crewEye). */',
    `export const EYE_POSE_SCALE: Record<EyePose, number> = ${json(c.poseScale)};`,
    '/** The glyph each pose draws: the large set at 32px and up, the small set at 31px and down (D16). */',
    `export const EYE_GLYPHS: { large: Record<EyePose, EyeGlyphKind>; small: Record<EyePose, EyeGlyphKind> } = ${json({ large: c.large, small: c.small })};`,
    '',
    '/** The outline\'s stroke in px at each stop; linear between them. */',
    `export const STROKE_STOPS = ${json(c.strokeStops)} as const;`,
    '/** The eye\'s diameter in px at each stop; linear between them. 16px is the size table\'s (D24). */',
    `export const EYE_STOPS = ${json(c.eyeStops)} as const;`,
    '/** From 64px up the stroke and the eye are a share of the size. */',
    `export const LARGE_STROKE = ${c.largeStroke[0]} / ${c.largeStroke[1]};`,
    `export const LARGE_EYE = ${c.largeEye[0]} / ${c.largeEye[1]};`,
    '/** The line glyphs\' stroke (lid, chevron, arc): a share of the eye, at least `min` px. */',
    `export const EYE_LINE = ${json({ ratio: c.lineRatio, min: c.lineMin })};`,
    '',
    '/** The sizes at which every eye of every pose stays the clearance inside the outline\'s stroke (crewClearance). */',
    `export const CREW_CLEARED_SIZES = ${json(CLEARED_SIZES)} as const;`,
    `/** The stops where the pill-diagonal's eyes stay level: everywhere else they tilt ${PILL_DIAGONAL_TILT}° about their midpoint, along the pill (D21). */`,
    `export const PILL_DIAGONAL_LEVEL_STOPS: readonly SizeStop[] = ${json(c.level)};`,
    '/**',
    ' * The pairs moved from the spec\'s centres because they would come closer to the outline than the clearance at a size',
    ' * in CREW_CLEARED_SIZES: pulled together and shifted inward, the least that clears. The spec has no 16px centres, and',
    ' * its 18px ones are fitted for the 16px eye there.',
    ' */',
    `export const CREW_FITTED: Partial<Record<CrewShapeId, Partial<Record<SizeStop, readonly EyePose[]>>>> = ${json(c.fitted)};`,
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, crewShapesSource());
  console.log(`wrote ${OUT}`);
}
