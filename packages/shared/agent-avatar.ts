import { AVATAR_SWATCHES, avatarInk } from './avatar-color.ts';
import {
  CREW_LAYOUTS,
  CREW_SHAPE_IDS,
  CREW_SHAPES,
  EYE_GLYPHS,
  EYE_POSE_SCALE,
  EYE_STATE_POSE,
  type CrewGrid,
  type CrewShapeId,
  type EyeGlyphKind,
  type EyeState,
  type SizeStop,
} from './crew-shapes.ts';
import { crewEye, crewEyeLine, crewGrid, crewLean, crewStop, crewStroke } from './crew-size.ts';
import { eyesFor, type EyeSource } from './crew-eyes.ts';
import { monogram } from './monogram.ts';

// An agent's face where it has no image or icon of its own: a colored disc with two letters (ADR 0019, How it looks).
// The web, the phone layout and the iOS app draw it. Pure.

const letters = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();

/**
 * Two letters per agent, unique across the agents given (Ben, 2026-11-20, Q48). An agent keeps its monogram while no
 * other agent's matches it. Agents whose monograms match each keep their first letter and take the first one where
 * their names part: Researcher RS and Reviewer RV, never both RE. One still taken after that takes the next letter of
 * its name that frees it, else a digit. The same set gives the same letters whatever order it comes in.
 */
export function agentInitials(agents: readonly { id: string; name: string }[]): Map<string, string> {
  const list = [...agents].sort((a, b) => a.id.localeCompare(b.id));
  const base = new Map(list.map((a) => [a.id, monogram(a.name)]));
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const a of list) {
    const own = letters(a.name);
    const rivals = list.filter((b) => b.id !== a.id && base.get(b.id) === base.get(a.id)).map((b) => letters(b.name));
    const parts = rivals.length ? [...own].findIndex((c, i) => i > 0 && rivals.every((r) => r[i] !== c)) : -1;
    let m = parts > 0 ? own[0] + own[parts] : base.get(a.id)!;
    if (taken.has(m)) m = [...own.slice(1), '2', '3', '4', '5', '6', '7', '8', '9'].map((c) => m[0] + c).find((c) => !taken.has(c)) ?? m;
    taken.add(m);
    out.set(a.id, m);
  }
  return out;
}

/** Below this size two letters do not read, so the disc shows its color only (Ben, 2026-11-20, Q49). */
export const INITIALS_MIN_PX = 18;

/** The pale swatches: an initials disc stays quiet beside an uploaded image. */
const DISC_SWATCHES = AVATAR_SWATCHES.slice(0, 6);

/** FNV-1a over the id: the same agent gets the same color on every client, and a rename keeps it. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** An initials disc at `size` px: its color from the agent's id, its ink, and the letters, null below INITIALS_MIN_PX. */
export function agentDisc(id: string, initials: string, size: number): { bg: string; ink: string; letters: string | null } {
  const bg = DISC_SWATCHES[hash(id) % DISC_SWATCHES.length];
  return { bg, ink: avatarInk(bg), letters: size < INITIALS_MIN_PX ? null : initials };
}

/** The images an agent avatar upload takes (Q3, builder default). */
export const AVATAR_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AvatarImageType = (typeof AVATAR_IMAGE_TYPES)[number];
/** The most a picked file may weigh: Settings refuses a bigger one before it reads it. */
export const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/** The side of the square Settings scales an upload to, and the most the server stores. */
export const AVATAR_PX = 256;

// The agent face (ADR 0021): what an avatar draws, decided once here for the Web UI and the iOS app, which only draw
// it. Seam A of its tests (packages/shared/tests/agent-face.test.ts).

/** What the face reads of an agent: its id and the avatar fields of its crew file. */
export interface FaceAgent {
  id: string;
  avatar?: { image?: string | null; icon?: string | null; bg?: string | null; shape?: string | null } | null;
}

/** What the avatar shows (crew-eyes.ts). Nothing shows idle eyes. */
export type FaceShows = EyeSource;

/** Where the avatar sits: where one agent is in focus, in a list row, or still (a past reply, a picker). */
export type FacePlacement = 'focus' | 'row' | 'still';

export interface FaceOptions {
  /** The avatar's size in px. */
  size: number;
  shows?: FaceShows;
  /**
   * In focus a status mark is the open thread's, whose rows tell thinking from a tool call; in a row or still a running
   * thread works (D7). Otherwise the drawing is the same wherever the avatar sits.
   */
  placement?: FacePlacement;
  reducedMotion?: boolean;
}

/** One eye, upright, in grid units. */
export interface CrewEye {
  glyph: EyeGlyphKind;
  cx: number;
  cy: number;
  /** The glyph fits inside the circle of this diameter about its centre. */
  d: number;
  /** The glyph's path: filled with the eye ink, or, when `line` is set, stroked that wide with round caps and joins. */
  path: string;
  line: number | null;
}

/** A crew character: everything a client needs to draw it, in its viewBox's units. */
export interface CharacterFace {
  kind: 'character';
  shape: CrewShapeId;
  size: number;
  grid: CrewGrid;
  /** The size stop whose outline and eye centres it draws. */
  stop: SizeStop;
  viewBox: string;
  /** One group transform around the body, the satellite and the eyes. */
  lean: string;
  /** The upright closed outline, filled with `body` and stroked `stroke` wide in `ring`, with round joins. */
  outline: string;
  stroke: number;
  body: string;
  /** The theme color the outline and the satellite take: the foreground (#17181a light, #eceae5 dark). */
  ring: 'fg';
  ink: string;
  satellite: { cx: number; cy: number; r: number } | null;
  /** Circles, rounded squares, diamonds and arcs at 32px and up; dots, plain squares, tall bars and chevrons below. */
  glyphs: 'large' | 'small';
  eyes: EyeState;
  pair: readonly [CrewEye, CrewEye];
}

export type AgentFace = CharacterFace;

const isCrewShape = (shape: unknown): shape is CrewShapeId => (CREW_SHAPE_IDS as readonly unknown[]).includes(shape);

/** What an agent's avatar draws: the crew character its avatar names, null when it names none. */
export function agentFace(agent: FaceAgent, opts: FaceOptions): AgentFace | null {
  const shape = agent.avatar?.shape;
  if (!isCrewShape(shape)) return null;
  return crewCharacter(shape, agent.avatar?.bg || CREW_SHAPES[shape].color, opts.size, eyesFor(opts.shows, opts.placement === 'focus'));
}

function crewCharacter(shape: CrewShapeId, body: string, px: number, eyes: EyeState): CharacterFace {
  const grid = crewGrid(px);
  const stop = crewStop(px);
  const drawing = CREW_SHAPES[shape].sizes[stop];
  const glyphs = px >= 32 ? 'large' : 'small';
  const unit = grid / px;
  const pose = EYE_STATE_POSE[eyes];
  const [a, b] = CREW_LAYOUTS[CREW_SHAPES[shape].layout][stop][pose];
  const eye = (cx: number, cy: number) => crewEyeGlyph(EYE_GLYPHS[glyphs][pose], cx, cy, crewEye(px) * EYE_POSE_SCALE[pose] * unit, crewEyeLine(px) * unit);
  return {
    kind: 'character',
    shape,
    size: px,
    grid,
    stop,
    viewBox: `0 0 ${grid} ${grid}`,
    lean: crewLean(grid),
    outline: drawing.d,
    stroke: crewStroke(px) * unit,
    body,
    ring: 'fg',
    ink: avatarInk(body),
    satellite: drawing.satellite ?? null,
    glyphs,
    eyes,
    pair: [eye(a[0], a[1]), eye(b[0], b[1])],
  };
}

/** Paths are written to a thousandth of a grid unit. */
const q = (v: number) => Math.round(v * 1000) / 1000;
const n = (v: number) => String(q(v));

/**
 * An eye glyph at its centre, inside the circle of diameter `d`, so one clearance covers every glyph. The spec names
 * each pose's glyph, centre, diameter and line; the shapes inside that circle follow the status marks' vocabulary.
 */
function crewEyeGlyph(glyph: EyeGlyphKind, cx: number, cy: number, d: number, line: number): CrewEye {
  const r = d / 2;
  const inner = Math.max(0, r - line / 2);
  const box = (w: number, h: number) => `M${n(cx - w / 2)} ${n(cy - h / 2)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  const fill = (path: string): CrewEye => ({ glyph, cx, cy, d, path, line: null });
  const stroke = (path: string): CrewEye => ({ glyph, cx, cy, d, path, line });
  switch (glyph) {
    case 'dot': {
      // Each half's chord is exactly twice its rounded radius: a radius rounded past half the chord moves the centre.
      const k = q(r);
      return fill(`M${n(cx - k)} ${n(cy)}a${k} ${k} 0 1 0 ${n(2 * k)} 0a${k} ${k} 0 1 0 ${n(-2 * k)} 0Z`);
    }
    case 'lid':
      return stroke(`M${n(cx - inner)} ${n(cy)}H${n(cx + inner)}`);
    case 'block':
      return fill(box(d / Math.SQRT2, d / Math.SQRT2));
    case 'bar':
      return fill(box(0.43 * d, 0.9 * d));
    case 'square': {
      // The largest square with corners of 30% its side inside the circle of `d`.
      const s = 0.85 * d;
      const k = 0.3 * s;
      const [x0, y0, x1, y1] = [cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2];
      const arc = (x: number, y: number) => `A${n(k)} ${n(k)} 0 0 1 ${n(x)} ${n(y)}`;
      return fill(`M${n(x0 + k)} ${n(y0)}H${n(x1 - k)}${arc(x1, y0 + k)}V${n(y1 - k)}${arc(x1 - k, y1)}H${n(x0 + k)}${arc(x0, y1 - k)}V${n(y0 + k)}${arc(x0 + k, y0)}Z`);
    }
    case 'diamond':
      return fill(`M${n(cx)} ${n(cy - r)}L${n(cx + r)} ${n(cy)}L${n(cx)} ${n(cy + r)}L${n(cx - r)} ${n(cy)}Z`);
    case 'chevron': {
      // Arms at a 0.6 slope, their ends as far out as the circle of `d` allows.
      const x = inner / Math.sqrt(1 + 0.36);
      const y = 0.6 * x;
      return stroke(`M${n(cx - x)} ${n(cy + y)}L${n(cx)} ${n(cy - y)}L${n(cx + x)} ${n(cy + y)}`);
    }
    case 'arc': {
      // Half a circle over the centre, its ends as far out as the circle of `d` allows.
      const k = q(inner / Math.sqrt(1.25));
      return stroke(`M${n(cx - k)} ${n(cy + k / 2)}a${k} ${k} 0 0 1 ${n(2 * k)} 0`);
    }
  }
}
