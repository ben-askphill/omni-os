import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { agentFace, type AgentFace, type FaceAgent, type FaceOptions } from '@omni/shared/agent-avatar.ts';
import type { BodyMotion, CrewChange, CrewEase, EyeMotion } from '@omni/shared/crew-motion.ts';
import type { EyeState } from '@omni/shared/crew-shapes.ts';
import { useReducedMotion } from '../motion.ts';

// A crew character's motion (ADR 0021, Motion, D25): what agentFace() returns, played from code through the Web
// Animations API. Body loops play on the avatar's own box, eye loops on each eye group, and a state change squeezes the
// eyes shut, swaps the glyphs once that squeeze finishes, then springs the new eyes open (the wide beat and the hop with
// it) before the new state's loops start. No CSS keyframes: CSS holds only the eyes' transform box and origin.

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

/** The squeeze that has finished and the change it began, waiting for the new eyes to be drawn. */
interface Handover {
  change: CrewChange;
  squeezes: Animation[];
}

/**
 * The face an AgentAvatar draws, and the refs its motion plays on: `body` on the character's svg, `eyes` on its two eye
 * groups. Reduced motion, read through matchMedia and followed live, stops all of it (D18): the face then moves nothing
 * and a state change swaps the eyes at once. A change plays only once it happens live, never on first render.
 */
export function useCrewMotion(
  agent: FaceAgent,
  opts: Omit<FaceOptions, 'reducedMotion' | 'from'>,
): { face: AgentFace; body: RefObject<SVGSVGElement | null>; eyes: readonly [RefObject<SVGGElement | null>, RefObject<SVGGElement | null>] } {
  const reducedMotion = useReducedMotion() || !canAnimate;
  const peek = agentFace(agent, { ...opts, reducedMotion });
  const target = peek.kind === 'character' ? peek.eyes : null;
  // The eyes on screen: they follow the face's once a change has squeezed them shut.
  const [drawn, setDrawn] = useState<EyeState | null>(target);
  const changing = target !== null && drawn !== null && drawn !== target;
  // While a squeeze plays, the eyes drawn until now stay on screen; the face's motion holds the change into the new ones.
  const face = changing ? agentFace(agent, { ...opts, reducedMotion, shows: { eyes: drawn } }) : peek;
  const next = changing ? agentFace(agent, { ...opts, reducedMotion, from: drawn }) : peek;
  const body = useRef<SVGSVGElement | null>(null);
  const eyes = [useRef<SVGGElement | null>(null), useRef<SVGGElement | null>(null)] as const;
  const handover = useRef<Handover | null>(null);
  const key = next.kind === 'character' ? `${next.shape} ${next.size} ${opts.placement ?? ''} ${reducedMotion}` : '';

  useLayoutEffect(() => {
    if (target === null || drawn === null) {
      if (drawn !== target) setDrawn(target);
      return;
    }
    if (next.kind !== 'character') return;
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

    if (drawn !== target) {
      const change = next.motion.change;
      handover.current?.squeezes.forEach((a) => a.cancel());
      handover.current = null;
      if (!change) {
        setDrawn(target);
        return;
      }
      // Shut, and stay shut until the new eyes are drawn and spring open from here.
      const squeezes = both(change.squeeze, { ...timing(change.squeeze), fill: 'forwards' });
      Promise.all(squeezes.map((a) => a.finished)).then(
        () => {
          if (!live) return;
          handover.current = { change, squeezes };
          playing.length = 0;
          setDrawn(target);
        },
        // A new state, an unmount or reduced motion cancelled it: the next run starts again from the face.
        () => {},
      );
      return stop;
    }

    const handed = handover.current;
    handover.current = null;
    let ready: Promise<unknown> = Promise.resolve();
    if (handed) {
      const opened = both(handed.change.open, timing(handed.change.open));
      if (handed.change.body) opened.push(play(svg, bodyKeyframes(handed.change.body), timing(handed.change.body)));
      for (const a of handed.squeezes) a.cancel();
      ready = Promise.all(opened.map((a) => a.finished));
    }
    const loops = next.motion;
    if (loops.body || loops.eyes)
      ready.then(
        () => {
          if (!live) return;
          if (loops.body) play(svg, bodyKeyframes(loops.body), timing(loops.body));
          if (loops.eyes) both(loops.eyes, timing(loops.eyes));
        },
        () => {},
      );
    return stop;
    // `next` is the same motion for the same key, eyes and drawn eyes: a new color or name restarts nothing.
  }, [key, target, drawn]);

  return { face, body, eyes };
}

/**
 * Plays the agent-switch pop (D17) on the element the returned ref names, apart from any loop inside it, whenever `key`
 * changes after the first render. `pop` is the face's: null under reduced motion, where nothing plays.
 */
export function useCrewPop<T extends Element>(key: string, pop: BodyMotion | null): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const last = useRef(key);
  useLayoutEffect(() => {
    if (last.current === key) return;
    last.current = key;
    const el = ref.current;
    if (!el || !pop || !canAnimate) return;
    const a = animate(el, bodyKeyframes(pop), timing(pop));
    return () => a.cancel();
  }, [key, pop]);
  return ref;
}
