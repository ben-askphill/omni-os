import { movingFace, type FaceAgent, type FacePlacement, type FaceShows } from '@omni/shared/agent-avatar.ts';
import { crewStep, type BodyMotion, type CrewChange, type CrewEase, type EyeMotion } from '@omni/shared/crew-motion.ts';
import { useLayoutEffect, useRef, useState } from 'react';
import { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ease } from '../theme';

// A crew character's motion (ADR 0021, Motion): the shared player's steps (crewStep, crew-motion.ts), played on the UI
// thread with Reanimated, as the Web UI plays them with Web Animations (apps/web/src/components/use-crew-motion.ts).
// Body loops play on a view around the character, eye loops on a group around each eye, and a state change squeezes the
// eyes shut, swaps the glyphs once that squeeze finishes, then springs the new eyes open (the wide beat and the hop with
// it) before the new state's loops start. Every number comes from the face, the curves from theme.ts. The helpers below
// that run on the UI thread carry 'worklet'.

/** The four curves, built once on the JS thread and read in the worklets. */
const CURVES: Record<CrewEase, (x: number) => number> = {
  fluid: Easing.bezierFn(...ease.fluid),
  spring: Easing.bezierFn(...ease.spring),
  settle: Easing.bezierFn(...ease.settle),
  stretch: Easing.bezierFn(...ease.stretch),
};

/** What the group around an eye takes: react-native-svg's native transform, which G sets only from a transform of its own. */
export interface EyeProps {
  matrix: number[];
}

type Keyed<K extends string> = { at: number; ease: CrewEase } & Record<K, number>;

/** `key` `t` of the way through `frames`, each frame easing into the next on its own curve, as Web Animations keyframes do. */
function sample<K extends string>(frames: readonly Keyed<K>[], t: number, key: K): number {
  'worklet';
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].at <= t) i++;
  const a = frames[i];
  const b = frames[i + 1] ?? a;
  const span = b.at - a.at;
  const k = span > 0 ? CURVES[a.ease](Math.min(1, Math.max(0, (t - a.at) / span))) : 1;
  return a[key] + (b[key] - a[key]) * k;
}

/** How far through its frames a motion is once `p` of one run has played: a loop wraps, starting `phase` in. */
function along(m: { loop: boolean; phase?: number }, p: number) {
  'worklet';
  return m.loop ? (p + (m.phase ?? 0)) % 1 : p;
}

/** A body motion's frame as a view transform about its origin, for an avatar `size` across. With none, the rest pose. */
function bodyTransform(m: BodyMotion | null, p: number, size: number) {
  'worklet';
  const t = m ? along(m, p) : 0;
  const ox = m ? (m.origin[0] - 0.5) * size : 0;
  const oy = m ? (m.origin[1] - 0.5) * size : 0;
  return [
    { translateX: ox },
    { translateY: oy + (m ? sample(m.frames, t, 'y') * size : 0) },
    { rotate: `${m ? sample(m.frames, t, 'rotate') : 0}deg` },
    { scaleX: m ? sample(m.frames, t, 'sx') : 1 },
    { scaleY: m ? sample(m.frames, t, 'sy') : 1 },
    { translateX: -ox },
    { translateY: -oy },
  ];
}

/** One eye's frame as the matrix of the group on its centre: its move from rest, in grid units, and its squash. */
function eyeMatrix(m: EyeMotion | null, k: 0 | 1, p: number): number[] {
  'worklet';
  if (!m) return [1, 0, 0, 1, 0, 0];
  const t = along(m, p);
  const f = m.frames[k];
  return [sample(f, t, 'sx'), 0, 0, sample(f, t, 'sy'), sample(f, t, 'dx'), sample(f, t, 'dy')];
}

/** Plays `m` from its start: `motion` holds what plays and `p` how much of one run has. `done` ends a one-shot, or its cut. */
function play<M extends { ms: number; loop: boolean }>(motion: SharedValue<M | null>, p: SharedValue<number>, m: M, done?: (finished?: boolean) => void) {
  cancelAnimation(p);
  p.set(0);
  motion.set(m);
  const run = withTiming(1, { duration: m.ms, easing: Easing.linear }, done);
  p.set(m.loop ? withRepeat(run, -1) : run);
}

/** Stops what plays and goes back to the rest pose. */
function rest<M>(motion: SharedValue<M | null>, p: SharedValue<number>) {
  cancelAnimation(p);
  motion.set(null);
}

/**
 * The face an AgentAvatar draws where it can move (in focus or in a row), and the animated props its motion plays on:
 * `body` on a view around the character, `pop` on one around that (the agent-switch pop, apart from any loop), and
 * `eyes` on a group around each eye. What plays is the shared player's (movingFace, crewStep): this only plays it.
 * Reduce Motion stops all of it: the face then moves nothing and a state change swaps the eyes at once. A change and
 * the pop play only once they happen live, never on first render.
 */
export function useCrewMotion(agent: FaceAgent, size: number, shows: FaceShows | undefined, placement: FacePlacement) {
  const opts = { size, shows, placement, reducedMotion: useReducedMotion() };
  // The eyes on screen: they follow the face's once a change has squeezed them shut.
  const [drawn, setDrawn] = useState(() => movingFace(agent, opts, null).eyes);
  const plan = movingFace(agent, opts, drawn);

  const bodyMotion = useSharedValue<BodyMotion | null>(null);
  const bodyP = useSharedValue(0);
  const eyeMotion = useSharedValue<EyeMotion | null>(null);
  const eyeP = useSharedValue(0);
  const popMotion = useSharedValue<BodyMotion | null>(null);
  const popP = useSharedValue(0);
  // The change whose squeeze has finished, waiting for the new eyes to be drawn and open. Its shut eyes stay on the
  // eye motion until the open replaces them.
  const handover = useRef<CrewChange | null>(null);

  useLayoutEffect(() => {
    const step = crewStep(plan.eyes, drawn, plan.motion, handover.current);
    handover.current = null;
    if (step.kind === 'swap') {
      rest(eyeMotion, eyeP);
      setDrawn(step.eyes);
      return;
    }
    let live = true;
    // Once a squeeze hands over, its shut eyes stay for the new ones to open from.
    let handed = false;
    const stop = () => {
      live = false;
      rest(bodyMotion, bodyP);
      if (!handed) rest(eyeMotion, eyeP);
    };

    if (step.kind === 'squeeze') {
      const squeezed = () => {
        if (!live) return;
        handed = true;
        handover.current = step.change;
        setDrawn(step.eyes);
      };
      play(eyeMotion, eyeP, step.squeeze, (finished) => {
        'worklet';
        // A new state, an unmount or a new face cut it off: the next run starts again from the face.
        if (finished) scheduleOnRN(squeezed);
      });
      return stop;
    }

    const loops = () => {
      if (!live) return;
      if (step.body) play(bodyMotion, bodyP, step.body);
      // A state with no eye loop lets go of eyes a squeeze held shut, as the Web UI cancels them.
      if (step.eyes) play(eyeMotion, eyeP, step.eyes);
      else rest(eyeMotion, eyeP);
    };
    const { open } = step;
    if (!open) {
      loops();
      return stop;
    }
    // The new eyes open from shut, the hop with them; the loops start once the one that ends last does.
    const ready = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(loops);
    };
    play(eyeMotion, eyeP, open.eyes, open.last === 'eyes' ? ready : undefined);
    if (open.body) play(bodyMotion, bodyP, open.body, open.last === 'body' ? ready : undefined);
    return stop;
    // The plan's motion is the same for the same key, eyes and drawn eyes: a new color or name restarts nothing.
  }, [plan.key, plan.eyes, drawn]);

  // The agent-switch pop (D17): another agent, shape or color drawn in the same place. In focus only: elsewhere the face has none.
  const lastLook = useRef(plan.look);
  useLayoutEffect(() => {
    if (lastLook.current === plan.look) return;
    lastLook.current = plan.look;
    const pop = plan.motion.pop;
    if (!pop) return;
    play(popMotion, popP, pop);
    return () => rest(popMotion, popP);
  }, [plan.look]);

  const body = useAnimatedStyle(() => ({ transform: bodyTransform(bodyMotion.value, bodyP.value, size) }));
  const pop = useAnimatedStyle(() => ({ transform: bodyTransform(popMotion.value, popP.value, size) }));
  const left = useAnimatedProps<EyeProps>(() => ({ matrix: eyeMatrix(eyeMotion.value, 0, eyeP.value) }));
  const right = useAnimatedProps<EyeProps>(() => ({ matrix: eyeMatrix(eyeMotion.value, 1, eyeP.value) }));
  return { face: plan.face, body, pop, eyes: [left, right] as const };
}
