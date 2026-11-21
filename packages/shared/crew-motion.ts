// The crew characters' motion (ADR 0021, Motion): every keyframe and timing the Motion board draws, once, for the Web UI
// (Web Animations API) and the iOS app (Reanimated). The agent face (agent-avatar.ts) picks what plays for a state, a
// placement and reduced motion, and the clients only play it. Static data, no platform types.
import type { EyePose, EyeState } from './crew-shapes.ts';

/** The four curves, by name, not value: the web reads their cubic-bezier values from index.css (`--ease-*`), and the iOS app plays the same curves. */
export type CrewEase = 'fluid' | 'spring' | 'settle' | 'stretch';

/** A frame of the whole avatar: its lift as a share of its size (up is negative), its turn in degrees and its squash. */
export interface BodyFrame {
  /** How far through the animation, 0 to 1. */
  at: number;
  y: number;
  rotate: number;
  sx: number;
  sy: number;
  /** The curve from this frame to the next. */
  ease: CrewEase;
}

/** A body animation: a loop while its state lasts, or a one-shot. */
export interface BodyMotion {
  ms: number;
  loop: boolean;
  /** The point it turns and squashes about, as shares of the avatar's width and height. */
  origin: readonly [number, number];
  /** How far into its cycle a loop starts, 0 to 1, so it leaves the rest pose smoothly. */
  phase: number;
  frames: readonly BodyFrame[];
}

const frame = (at: number, sx: number, sy: number, ease: CrewEase, y = 0, rotate = 0): BodyFrame => ({ at, y, rotate, sx, sy, ease });

const FEET = [0.5, 1] as const;

/**
 * The body loops of the states that move, all on the fluid curve. Breathe and wait squash about the feet; the sway turns
 * about 50% 70%. 4.8s is the live Omni mark's breath (`--dur-breathe`) and 2.4s the design system's tick (`--dur-tick`).
 */
export const BODY_LOOPS = {
  idle: { ms: 4800, loop: true, origin: FEET, phase: 0, frames: [frame(0, 1, 1, 'fluid'), frame(0.5, 1.025, 0.975, 'fluid'), frame(1, 1, 1, 'fluid')] },
  // A quarter in, the fluid curve is halfway through its first swing: upright, so the loop starts where the body rests.
  thinking: {
    ms: 2400,
    loop: true,
    origin: [0.5, 0.7],
    phase: 0.25,
    frames: [frame(0, 1, 1, 'fluid', 0, -2.5), frame(0.5, 1, 1, 'fluid', 0, 2.5), frame(1, 1, 1, 'fluid', 0, -2.5)],
  },
  // 50% names only the lift: its squash is the straight line between 28% and 74%.
  working: {
    ms: 840,
    loop: true,
    origin: FEET,
    phase: 0,
    frames: [frame(0, 1.06, 0.94, 'fluid'), frame(0.28, 0.96, 1.05, 'fluid', -0.07), frame(0.5, 0.97, 1.036, 'fluid', -0.1), frame(0.74, 0.98, 1.02, 'fluid', -0.03), frame(1, 1.06, 0.94, 'fluid')],
  },
  waiting: { ms: 3200, loop: true, origin: FEET, phase: 0, frames: [frame(0, 1, 1, 'fluid'), frame(0.5, 1.04, 0.955, 'fluid'), frame(1, 1, 1, 'fluid')] },
} as const satisfies Partial<Record<EyeState, BodyMotion>>;

/** A beat of the eyes: the pose both take `at` through the animation, and their squash. A blink shuts them where they look. */
export interface EyeBeat {
  at: number;
  pose: EyePose;
  sx: number;
  sy: number;
  /** The curve from this beat to the next. */
  ease: CrewEase;
}

export interface EyeTimeline {
  ms: number;
  beats: readonly EyeBeat[];
}

type Beat = readonly [ms: number, pose: EyePose, ease: CrewEase, sx?: number, sy?: number];

/** Beats written in ms into the animation, kept as shares of it. A beat with one scale scales both ways. */
const timeline = (ms: number, beats: readonly Beat[]): EyeTimeline => ({
  ms,
  beats: beats.map(([t, pose, ease, sx = 1, sy = sx]) => ({ at: t / ms, pose, sx, sy, ease })),
});

/**
 * The eye loops, in the same places as the body loops. A move between poses darts on the settle curve, a blink shuts
 * on stretch and opens on spring, and a hold stays put. Idle double-blinks, then glances right; thinking looks centre,
 * left, centre, blinks, then right; working scans left and right, 0.4s each; waiting breathes its squares slowly.
 * The board names the cycles (7.0s, 4.3s) and the scan; the beats inside them are the build's.
 */
export const EYE_LOOPS = {
  idle: timeline(7000, [
    [0, 'idle', 'fluid'],
    [2100, 'idle', 'stretch'],
    [2190, 'blink', 'spring'],
    [2300, 'idle', 'fluid'],
    [2500, 'idle', 'stretch'],
    [2590, 'blink', 'spring'],
    [2700, 'idle', 'fluid'],
    [4300, 'idle', 'settle'],
    [4580, 'think_r', 'fluid'],
    [5400, 'think_r', 'settle'],
    [5680, 'idle', 'fluid'],
    [7000, 'idle', 'fluid'],
  ]),
  thinking: timeline(4300, [
    [0, 'think_c', 'fluid'],
    [700, 'think_c', 'settle'],
    [950, 'think_l', 'fluid'],
    [1700, 'think_l', 'settle'],
    [1950, 'think_c', 'fluid'],
    [2600, 'think_c', 'stretch'],
    [2690, 'blink', 'spring'],
    [2800, 'think_c', 'fluid'],
    [3000, 'think_c', 'settle'],
    [3250, 'think_r', 'fluid'],
    [4050, 'think_r', 'settle'],
    [4300, 'think_c', 'fluid'],
  ]),
  working: timeline(800, [
    [0, 'work_c', 'settle'],
    [200, 'work_l', 'settle'],
    [600, 'work_r', 'settle'],
    [800, 'work_c', 'settle'],
  ]),
  waiting: timeline(3200, [
    [0, 'waiting', 'fluid'],
    [1600, 'waiting', 'fluid', 0.9],
    [3200, 'waiting', 'fluid'],
  ]),
} as const satisfies Partial<Record<EyeState, EyeTimeline>>;

/**
 * A state change: the eyes squeeze shut to 1.15 × .06 in 110ms on the stretch curve, the glyphs swap behind it (Safari
 * has no CSS `d` to morph them), and the new eyes spring open. The open takes the wide beat's 260ms spring: the board
 * gives no time of its own for it.
 */
const SHUT = [1.15, 0.06] as const;
export const crewSqueeze = (pose: EyePose): EyeTimeline => timeline(110, [[0, pose, 'stretch'], [110, pose, 'stretch', ...SHUT]]);
export const crewOpen = (pose: EyePose): EyeTimeline => timeline(260, [[0, pose, 'spring', ...SHUT], [260, pose, 'spring']]);
/** Idle to thinking opens into a beat of wide eyes on the spec's wide pose, 1.22 in 260ms on the spring, held .3s, then settles on `pose`. */
export const crewWideOpen = (pose: EyePose): EyeTimeline =>
  timeline(820, [[0, 'wide', 'spring', ...SHUT], [260, 'wide', 'fluid', 1.22], [560, 'wide', 'settle', 1.22], [820, pose, 'settle']]);

/** One eye's frame, as the face works it out for a shape and size: its pose, how far it sits from where it rests in grid units, and its squash about its own centre. */
export interface EyeFrame {
  at: number;
  pose: EyePose;
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  ease: CrewEase;
}

/** An eye animation, the frames of the left eye and of the right. */
export interface EyeMotion {
  ms: number;
  loop: boolean;
  frames: readonly [readonly EyeFrame[], readonly EyeFrame[]];
}

/** Done hops once on a live change, on the settle curve, squashing about the feet. */
export const CREW_HOP = {
  ms: 950,
  loop: false,
  origin: FEET,
  phase: 0,
  frames: [frame(0, 1, 1, 'settle'), frame(0.16, 1.1, 0.88, 'settle'), frame(0.42, 0.93, 1.09, 'settle', -0.16), frame(0.66, 1.08, 0.92, 'settle'), frame(0.82, 0.98, 1.03, 'settle'), frame(1, 1, 1, 'settle')],
} as const satisfies BodyMotion;

/** A new agent in the same place pops the body from .7 on the spring, about its centre. */
export const CREW_POP = { ms: 600, loop: false, origin: [0.5, 0.5], phase: 0, frames: [frame(0, 0.7, 0.7, 'spring'), frame(1, 1, 1, 'spring')] } as const satisfies BodyMotion;

/** What a live change of state plays, in order. */
export interface CrewChange {
  /** On the eyes drawn until now, where they are. The new eyes take their place once it ends. */
  squeeze: EyeMotion;
  /** On the new eyes, from the squeezed frame. */
  open: EyeMotion;
  /** On the avatar as a whole, with the open. */
  body: BodyMotion | null;
}

/** What plays on a character. Every part is null where nothing plays. */
export interface CrewMotion {
  /** The body loop, on the avatar as a whole, while the state lasts. */
  body: BodyMotion | null;
  /** The eye loop, on each eye, while the state lasts. */
  eyes: EyeMotion | null;
  /** On a live change from the eyes it showed before (`from` in the face's options), never on first render. */
  change: CrewChange | null;
  /** On the avatar's own wrapper, apart from the loops, when the agent it shows changes in place (in focus only). */
  pop: BodyMotion | null;
}

/** Nothing plays: under reduced motion, and on a still avatar. */
export const CREW_STILL: CrewMotion = { body: null, eyes: null, change: null, pop: null };
