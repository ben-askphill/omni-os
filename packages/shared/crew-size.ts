import { EYE_LINE, EYE_STOPS, LARGE_EYE, LARGE_STROKE, STROKE_STOPS, type CrewGrid, type SizeStop } from './crew-shapes.ts';

// The crew characters' size math (ADR 0021): which drawing a pixel size uses, and the stroke, eye and clearance it
// draws with. Stroke and eyes are set per size, not scaled with the drawing. Sizes in px; pure, so the iOS app runs it.

/** The grid an avatar draws on: 128 at 32px and up, 24 from 19 to 31px, 18 at 18px and down. */
export const crewGrid = (px: number): CrewGrid => (px >= 32 ? 128 : px >= 19 ? 24 : 18);

const GRID_STOPS: Record<CrewGrid, readonly SizeStop[]> = { 18: [16, 18], 24: [24], 128: [32, 48, 64] };

/** The size stop whose outline and eye centres an avatar draws: the nearest one on its grid, the smaller on a tie. */
export function crewStop(px: number): SizeStop {
  let best = GRID_STOPS[crewGrid(px)][0];
  for (const stop of GRID_STOPS[crewGrid(px)]) if (Math.abs(stop - px) < Math.abs(best - px)) best = stop;
  return best;
}

/** Linear between the stops, held at the first one below it. */
function between(stops: readonly (readonly [number, number])[], px: number) {
  if (px <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [a, va] = stops[i - 1];
    const [b, vb] = stops[i];
    if (px <= b) return va + ((vb - va) * (px - a)) / (b - a);
  }
  return stops[stops.length - 1][1];
}

/** The outline's stroke: 1.4, 1.5, 2, 2.75, 4.5 and 7.5px at the stops, 15/128 of the size from 64px. */
export const crewStroke = (px: number) => (px >= 64 ? LARGE_STROKE * px : between(STROKE_STOPS, px));

/** The eye's diameter: the size table's per stop (D24), 13.05/128 of the size from 64px, never under 2px. */
export const crewEye = (px: number) => Math.max(2, px >= 64 ? LARGE_EYE * px : between(EYE_STOPS, px));

/** How far each eye stays inside the outline's stroke: 0.75px, or 35% of the stroke once that is more. */
export const crewClearance = (px: number) => Math.max(0.75, 0.35 * crewStroke(px));

/** The stroke of the line glyphs (the blink's lid, chevrons and arcs). */
export const crewEyeLine = (px: number) => Math.max(EYE_LINE.min, EYE_LINE.ratio * crewEye(px));

/** The 10° lean, a skew about the drawing's centre, around the body, the satellite and the eyes. */
export const crewLean = (grid: number) => `translate(${grid / 2} ${grid / 2}) skewX(-10) translate(${-grid / 2} ${-grid / 2})`;
