import type { FacePlacement, FaceShows } from '@omni/shared/agent-avatar.ts';
import type { BodyMotion, CrewChange, CrewEase, EyeMotion } from '@omni/shared/crew-motion.ts';
import type { EyeState } from '@omni/shared/crew-shapes.ts';
import { useLayoutEffect, useRef, useState } from 'react';
import { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ease } from '../theme';
import { agentFace, type AgentFace, type AgentLook } from './agent-face';

// A crew character's motion (ADR 0021, Motion): what agentFace() returns, played on the UI thread with Reanimated, as
// the Web UI plays it with Web Animations (apps/web/src/components/use-crew-motion.ts). Body loops play on a view around
// the character, eye loops on a group around each eye, and a state change squeezes the eyes shut, swaps the glyphs once
// that squeeze finishes, then springs the new eyes open (the wide beat and the hop with it) before the new state's loops
// start. Every number comes from the face, the curves from theme.ts. The helpers below that run on the UI thread carry
// 'worklet'.

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
 * `eyes` on a group around each eye. Reduce Motion stops all of it: the face then moves nothing and a state change swaps
 * the eyes at once. A change plays only once it happens live, never on first render.
 */
export function useCrewMotion(agent: string, agents: readonly AgentLook[], size: number, shows: FaceShows | undefined, placement: FacePlacement) {
  const reducedMotion = useReducedMotion();
  const opts = { shows, placement, reducedMotion };
  const peek = agentFace(agent, agents, size, opts);
  const target = peek.kind === 'character' ? peek.eyes : null;
  // The eyes on screen: they follow the face's once a change has squeezed them shut.
  const [drawn, setDrawn] = useState<EyeState | null>(target);
  const changing = target !== null && drawn !== null && drawn !== target;
  // While a squeeze plays, the eyes drawn until now stay on screen; the face's motion holds the change into the new ones.
  const face: AgentFace = changing ? agentFace(agent, agents, size, { ...opts, shows: { eyes: drawn } }) : peek;
  const next = changing ? agentFace(agent, agents, size, { ...opts, from: drawn }) : peek;

  const bodyMotion = useSharedValue<BodyMotion | null>(null);
  const bodyP = useSharedValue(0);
  const eyeMotion = useSharedValue<EyeMotion | null>(null);
  const eyeP = useSharedValue(0);
  const popMotion = useSharedValue<BodyMotion | null>(null);
  const popP = useSharedValue(0);
  // The change whose squeeze has finished, waiting for the new eyes to be drawn and open.
  const handover = useRef<CrewChange | null>(null);
  const key = next.kind === 'character' ? `${next.shape} ${next.size} ${placement} ${reducedMotion}` : '';

  useLayoutEffect(() => {
    if (target === null || drawn === null) {
      if (drawn !== target) setDrawn(target);
      return;
    }
    if (next.kind !== 'character') return;
    let live = true;
    // Once a squeeze hands over, its shut eyes stay for the new ones to open from.
    let handed = false;
    const stop = () => {
      live = false;
      rest(bodyMotion, bodyP);
      if (!handed) rest(eyeMotion, eyeP);
    };

    if (drawn !== target) {
      const change = next.motion.change;
      handover.current = null;
      if (!change) {
        setDrawn(target);
        return;
      }
      const squeezed = () => {
        if (!live) return;
        handed = true;
        handover.current = change;
        setDrawn(target);
      };
      play(eyeMotion, eyeP, change.squeeze, (finished) => {
        'worklet';
        // A new state, an unmount or a new face cut it off: the next run starts again from the face.
        if (finished) scheduleOnRN(squeezed);
      });
      return stop;
    }

    const opening = handover.current;
    handover.current = null;
    const loops = next.motion;
    const start = () => {
      if (!live) return;
      if (loops.body) play(bodyMotion, bodyP, loops.body);
      if (loops.eyes) play(eyeMotion, eyeP, loops.eyes);
    };
    if (!opening) {
      start();
      return stop;
    }
    // The new eyes open from shut, the hop with them; the loops start once the longer of the two ends.
    const { open, body: hop } = opening;
    const ready = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(start);
    };
    const hopLast = hop !== null && hop.ms > open.ms;
    play(eyeMotion, eyeP, open, hopLast ? undefined : ready);
    if (hop) play(bodyMotion, bodyP, hop, hopLast ? ready : undefined);
    return stop;
    // `next` is the same motion for the same key, eyes and drawn eyes: a new color or name restarts nothing.
  }, [key, target, drawn]);

  // The agent-switch pop (D17), in focus only: another agent, shape or color drawn in the same place. Never on first render.
  const look = next.kind === 'character' ? `${agent} ${next.shape} ${next.body}` : '';
  const lastLook = useRef(look);
  useLayoutEffect(() => {
    if (lastLook.current === look) return;
    lastLook.current = look;
    const pop = next.kind === 'character' ? next.motion.pop : null;
    if (!pop) return;
    play(popMotion, popP, pop);
    return () => rest(popMotion, popP);
  }, [look]);

  const body = useAnimatedStyle(() => ({ transform: bodyTransform(bodyMotion.value, bodyP.value, size) }));
  const pop = useAnimatedStyle(() => ({ transform: bodyTransform(popMotion.value, popP.value, size) }));
  const left = useAnimatedProps<EyeProps>(() => ({ matrix: eyeMatrix(eyeMotion.value, 0, eyeP.value) }));
  const right = useAnimatedProps<EyeProps>(() => ({ matrix: eyeMatrix(eyeMotion.value, 1, eyeP.value) }));
  return { face, body, pop, eyes: [left, right] as const };
}
