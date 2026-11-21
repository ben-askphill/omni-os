import { avatarInk } from './avatar-color.ts';
import { hasOwnLook } from './channel-icon.ts';
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
  type EyePair,
  type EyePose,
  type EyeState,
  type SizeStop,
} from './crew-shapes.ts';
import { crewEye, crewEyeLine, crewGrid, crewLean, crewStop, crewStroke } from './crew-size.ts';
import { eyesFor, type EyeSource } from './crew-eyes.ts';
import {
  BODY_LOOPS,
  CREW_HOP,
  CREW_POP,
  CREW_STILL,
  crewOpen,
  crewSqueeze,
  crewWideOpen,
  EYE_LOOPS,
  type CrewChange,
  type CrewMotion,
  type EyeFrame,
  type EyeMotion,
  type EyeTimeline,
} from './crew-motion.ts';

/** FNV-1a over the id: an agent gets the same spare shape and color on every client, and a rename keeps them. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
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
   * thread works (D7). Otherwise the drawing is the same wherever the avatar sits. It decides the motion (D10): loops
   * in focus, a live change in focus and in a row, nothing still. An avatar placed nowhere is still.
   */
  placement?: FacePlacement;
  /** The system's reduced motion: nothing moves (D18, D28). */
  reducedMotion?: boolean;
  /** The eyes it showed until now, on a live change: the motion then holds the change into these eyes. */
  from?: EyeState;
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
  /** What plays on it (crew-motion.ts). */
  motion: CrewMotion;
}

/** An uploaded photo, drawn round. `image` is the path the crew file names. */
export interface ImageFace {
  kind: 'image';
  size: number;
  image: string;
}

/** A shared icon, an emoji or an SVG icon (`avatar.icon`, as channel-icon.ts reads it) on the agent's color. */
export interface IconFace {
  kind: 'icon';
  size: number;
  icon: string;
  bg: string;
  ink: string;
}

export type AgentFace = ImageFace | IconFace | CharacterFace;

const isCrewShape = (shape: unknown): shape is CrewShapeId => (CREW_SHAPE_IDS as readonly unknown[]).includes(shape);

/**
 * The shape each built-in agent takes when its crew file names none (D2), Store ops and Hermes included although
 * neither ships as a crew file. Kept in code: an overlay replaces a crew file's whole avatar map.
 */
export const BUILT_IN_SHAPES: Readonly<Record<string, CrewShapeId>> = {
  conductor: 'circle',
  researcher: 'droplet',
  builder: 'squircle',
  reviewer: 'pill-wide',
  writer: 'arch',
  inbox: 'tray',
  'store-ops': 'triangle',
  'usage-scan': 'pill-tall',
  hermes: 'pebble',
};

/** The shapes no built-in agent takes, in the spec's order: any other agent gets one of them (D2). */
export const SPARE_SHAPES: readonly CrewShapeId[] = ['diamond', 'bubble', 'cloud', 'pill-diagonal', 'fan', 'shield', 'bucket'];

/**
 * The shape an agent's character takes: the one its avatar names, else its built-in one, else a spare from the hash of
 * its id, so it looks the same on every machine and client and keeps its face when it is renamed.
 */
export function agentShape(agent: FaceAgent): CrewShapeId {
  const shape = agent.avatar?.shape;
  if (isCrewShape(shape)) return shape;
  return Object.hasOwn(BUILT_IN_SHAPES, agent.id) ? BUILT_IN_SHAPES[agent.id] : SPARE_SHAPES[hash(agent.id) % SPARE_SHAPES.length];
}

/** An agent's one color (D4): its avatar's, else the one its shape is paired with (D13). */
export function agentColor(agent: FaceAgent): string {
  return agent.avatar?.bg || CREW_SHAPES[agentShape(agent)].color;
}

/** What an agent's avatar draws (D1): its uploaded photo, else its icon or emoji on its color, else its crew character. */
export function agentFace(agent: FaceAgent, opts: FaceOptions): AgentFace {
  const { image, icon } = agent.avatar ?? {};
  if (image) return { kind: 'image', size: opts.size, image };
  if (icon) {
    const bg = agentColor(agent);
    return { kind: 'icon', size: opts.size, icon, bg, ink: avatarInk(bg) };
  }
  const shape = agentShape(agent);
  return crewCharacter(shape, agentColor(agent), opts.size, eyesFor(opts.shows, opts.placement === 'focus'), opts);
}

/**
 * The Conductor's face, one rule for every surface (D9): its agent's own photo or icon, else the icon and background
 * saved for the Conductor channel, else its crew character. Returns that channel's look when it wins, null when the
 * agent's own avatar (agentFace) draws. Every other agent always draws its own.
 */
export function conductorChannelLook<C extends { icon?: string | null; avatar_bg?: string | null }>(agent: FaceAgent | null | undefined, channel: C | null | undefined): C | null {
  if (agent?.id !== 'conductor' || agent.avatar?.image || agent.avatar?.icon) return null;
  return channel && hasOwnLook(channel) ? channel : null;
}

function crewCharacter(shape: CrewShapeId, body: string, px: number, eyes: EyeState, opts: FaceOptions): CharacterFace {
  const grid = crewGrid(px);
  const stop = crewStop(px);
  const drawing = CREW_SHAPES[shape].sizes[stop];
  const glyphs = px >= 32 ? 'large' : 'small';
  const unit = grid / px;
  const pose = EYE_STATE_POSE[eyes];
  const centres = CREW_LAYOUTS[CREW_SHAPES[shape].layout][stop];
  const [a, b] = centres[pose];
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
    motion: crewMotion({ centres, pose, lid: crewEyeLine(px) / crewEye(px) }, eyes, opts),
  };
}

/** What the eye motion reads of a drawing: every pose's centres at its stop, the pose it rests on, and a shut eye's height as a share of an open one. */
interface EyeRig {
  centres: Record<EyePose, EyePair>;
  pose: EyePose;
  lid: number;
}

const hasLoop = (eyes: EyeState): eyes is keyof typeof BODY_LOOPS => Object.hasOwn(BODY_LOOPS, eyes);

/**
 * What plays on a character (ADR 0021, Motion). Under reduced motion, or still, nothing (D18). The body and eye loops
 * run only where one agent is in focus (D10); a live change plays wherever it moves at all, a list row included.
 */
function crewMotion(rig: EyeRig, eyes: EyeState, { placement = 'still', reducedMotion = false, from }: FaceOptions): CrewMotion {
  if (reducedMotion || placement === 'still') return CREW_STILL;
  const loops = placement === 'focus' && hasLoop(eyes);
  return {
    body: loops ? BODY_LOOPS[eyes] : null,
    eyes: loops ? eyeMotion(rig, rig.pose, EYE_LOOPS[eyes], true) : null,
    change: from !== undefined && from !== eyes ? crewChange(rig, from, eyes) : null,
    pop: placement === 'focus' ? CREW_POP : null,
  };
}

/** The squeeze on the eyes of `from`, the swap behind it and the open into `eyes`: through the wide beat from idle to thinking, with the hop into done. */
function crewChange(rig: EyeRig, from: EyeState, eyes: EyeState): CrewChange {
  const was = EYE_STATE_POSE[from];
  const open = from === 'idle' && eyes === 'thinking' ? crewWideOpen(rig.pose) : crewOpen(rig.pose);
  return { squeeze: eyeMotion(rig, was, crewSqueeze(was), false), open: eyeMotion(rig, rig.pose, open, false), body: eyes === 'done' ? CREW_HOP : null };
}

/**
 * A timeline for this drawing, on eyes that rest on `rest`: each beat moves an eye from its rest centre to its pose's,
 * and a blink shuts it to the lid's height where it looks, dropped as far as the spec's blink sits from its idle eyes.
 */
function eyeMotion(rig: EyeRig, rest: EyePose, line: EyeTimeline, loop: boolean): EyeMotion {
  const { centres, lid } = rig;
  const side = (k: 0 | 1): EyeFrame[] => {
    let looking = rest;
    return line.beats.map(({ at, pose, sx, sy, ease }) => {
      const shut = pose === 'blink';
      if (!shut) looking = pose;
      const [x, y] = centres[looking][k];
      const [bx, by] = shut ? [centres.blink[k][0] - centres.idle[k][0], centres.blink[k][1] - centres.idle[k][1]] : [0, 0];
      return { at, pose, dx: x + bx - centres[rest][k][0], dy: y + by - centres[rest][k][1], sx, sy: shut ? lid : sy, ease };
    });
  };
  return { ms: line.ms, loop, frames: [side(0), side(1)] };
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
