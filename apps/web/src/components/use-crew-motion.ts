import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { movingFace, type AgentFace, type FaceAgent, type FaceOptions } from '@omni/shared/agent-avatar.ts';
import { crewStep, type BodyMotion, type CrewChange, type CrewEase, type EyeMotion } from '@omni/shared/crew-motion.ts';
import { useReducedMotion } from '../motion.ts';

// A crew character's motion (ADR 0021, Motion, D25): the shared player's steps (crewStep, crew-motion.ts), played from
// code through the Web Animations API. Body loops play on the avatar's own box, eye loops on each eye group, and a state
// change squeezes the eyes shut, swaps the glyphs once that squeeze finishes, then springs the new eyes open (the wide
// beat and the hop with it) before the new state's loops start. The agent-switch pop plays on a group of its own. No
// CSS keyframes: CSS holds only the eyes' transform box and origin.

/** The four curves, read from index.css (`--ease-*`), their one web copy. */
const curves = new Map<CrewEase, string>();
function curve(ease: CrewEase) {
  let value = curves.get(ease);
  if (!value) {
    value = getComputedStyle(document.documentElement).getPropertyValue(`--ease-${ease}`).trim();
    if (value) curves.set(ease, value);
  }
  return value || 'ease';
}

const pct = (share: number) => `${Math.round(share * 100000) / 1000}%`;

/** A body animation as keyframes on the separate translate, rotate and scale properties, so it stays on the compositor. */
function bodyKeyframes(m: BodyMotion): Keyframe[] {
  const transformOrigin = `${pct(m.origin[0])} ${pct(m.origin[1])}`;
  return m.frames.map((f) => ({ offset: f.at, translate: `0 ${pct(f.y)}`, rotate: `${f.rotate}deg`, scale: `${f.sx} ${f.sy}`, transformOrigin, easing: curve(f.ease) }));
}

/** One eye's frames. Its moves are in grid units, which an SVG element's px are; it squashes about its own centre (CSS). */
function eyeKeyframes(m: EyeMotion, k: 0 | 1): Keyframe[] {
  return m.frames[k].map((f) => ({ offset: f.at, translate: `${f.dx}px ${f.dy}px`, scale: `${f.sx} ${f.sy}`, easing: curve(f.ease) }));
}

const timing = (m: { ms: number; loop: boolean; phase?: number }): KeyframeAnimationOptions => ({ duration: m.ms, iterations: m.loop ? Infinity : 1, iterationStart: m.phase ?? 0 });

/** Where the browser has no Web Animations (a test DOM), the avatar draws still, as under reduced motion. */
const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

/** Starts an animation whose cancel is expected: a DOM that rejects `finished` at once must not report it. */
function animate(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  const a = el.animate(keyframes, options);
  a.finished.catch(() => {});
  return a;
}

/**
 * The face an AgentAvatar draws, and the refs its motion plays on: `body` on the character's svg, `pop` on the group
 * inside it the agent-switch pop plays on, apart from the loops, and `eyes` on its two eye groups. What plays is the
 * shared player's (movingFace, crewStep): this only plays it. Reduced motion, read through matchMedia and followed
 * live, stops all of it (D18): the face then moves nothing and a state change swaps the eyes at once. A change and the
 * pop play only once they happen live, never on first render.
 */
export function useCrewMotion(
  agent: FaceAgent,
  opts: Omit<FaceOptions, 'reducedMotion' | 'from'>,
): { face: AgentFace; body: RefObject<SVGSVGElement | null>; pop: RefObject<SVGGElement | null>; eyes: readonly [RefObject<SVGGElement | null>, RefObject<SVGGElement | null>] } {
  const all = { ...opts, reducedMotion: useReducedMotion() || !canAnimate };
  // The eyes on screen: they follow the face's once a change has squeezed them shut.
  const [drawn, setDrawn] = useState(() => movingFace(agent, all, null).eyes);
  const plan = movingFace(agent, all, drawn);
  const body = useRef<SVGSVGElement | null>(null);
  const pop = useRef<SVGGElement | null>(null);
  const eyes = [useRef<SVGGElement | null>(null), useRef<SVGGElement | null>(null)] as const;
  // The change whose squeeze has ended, and that squeeze, holding the eyes shut until the open replaces it.
  const handover = useRef<CrewChange | null>(null);
  const held = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const step = crewStep(plan.eyes, drawn, plan.motion, handover.current);
    handover.current = null;
    const release = () => {
      for (const a of held.current) a.cancel();
      held.current = [];
    };
    if (step.kind === 'swap') {
      release();
      setDrawn(step.eyes);
      return;
    }
    const svg = body.current;
    const [left, right] = [eyes[0].current, eyes[1].current];
    if (!svg || !left || !right) return;
    const playing: Animation[] = [];
    let live = true;
    const play = (el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const a = animate(el, keyframes, options);
      playing.push(a);
      return a;
    };
    const both = (m: EyeMotion, options: KeyframeAnimationOptions) => [play(left, eyeKeyframes(m, 0), options), play(right, eyeKeyframes(m, 1), options)];
    const stop = () => {
      live = false;
      for (const a of playing) a.cancel();
    };

    if (step.kind === 'squeeze') {
      release();
      const squeezes = both(step.squeeze, { ...timing(step.squeeze), fill: 'forwards' });
      squeezes[0].finished.then(
        () => {
          if (!live) return;
          // Shut, and kept shut past this run, until the new eyes are drawn and spring open from here.
          handover.current = step.change;
          held.current = squeezes;
          playing.length = 0;
          setDrawn(step.eyes);
        },
        // A new state, an unmount or reduced motion cancelled it: the next run starts again from the face.
        () => {},
      );
      return stop;
    }

    const loops = () => {
      if (!live) return;
      if (step.body) play(svg, bodyKeyframes(step.body), timing(step.body));
      if (step.eyes) both(step.eyes, timing(step.eyes));
    };
    const { open } = step;
    if (!open) {
      release();
      loops();
      return stop;
    }
    const [opened] = both(open.eyes, timing(open.eyes));
    const hop = open.body && play(svg, bodyKeyframes(open.body), timing(open.body));
    release();
    (open.last === 'body' && hop ? hop : opened).finished.then(loops, () => {});
    return stop;
    // The plan's motion is the same for the same key, eyes and drawn eyes: a new color or name restarts nothing.
  }, [plan.key, plan.eyes, drawn]);

  // The agent-switch pop (D17): another agent, shape or color drawn in the same place. In focus only: elsewhere the face has none.
  const lastLook = useRef(plan.look);
  useLayoutEffect(() => {
    if (lastLook.current === plan.look) return;
    lastLook.current = plan.look;
    const el = pop.current;
    const m = plan.motion.pop;
    if (!el || !m) return;
    const a = animate(el, bodyKeyframes(m), timing(m));
    return () => a.cancel();
  }, [plan.look]);

  return { face: plan.face, body, pop, eyes };
}
