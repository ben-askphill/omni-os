import { MARK_TRANSFORM, HARNESS_LOGOS as LOGO, HARNESS, CREW } from '@omni/shared/brand.ts';
import { angDiff, c01, easeWeights, MARK_DROPLETS, MARK_R, MARK_START, MARK_TARGETS, MARK_W, markFrame, type MarkDrop, type MarkState } from '@omni/shared/mark.ts';
import { useEffect, useId, useRef, useState } from 'react';
import type { HarnessId } from '../api.ts';

// ---------- the Omni mark ----------

/* The ring's physics live in @omni/shared/mark.ts, shared with the iOS thinking line. Here: SVG plus a goo filter
   (blur, then an alpha threshold) and the pointer lean. */
const R = MARK_R;
const W = MARK_W;
const DROPLETS = MARK_DROPLETS;
export { MARK_TRANSFORM } from '@omni/shared/brand.ts';
export type { MarkState } from '@omni/shared/mark.ts';

export function useReducedMotion() {
  const [rm, setRm] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setRm(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return rm;
}

/** The mark without motion: ring plus satellite. Used for reduced motion and favicons. */
export function StaticMark({ size = 32, title = 'Omni', className = '' }: { size?: number; title?: string; className?: string }) {
  return (
    <svg className={`mark ${className}`} width={size} height={size} viewBox="-64 -64 128 128" role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true}>
      <g transform={MARK_TRANSFORM}>
        <circle cx="0" cy="0" r={R} fill="none" stroke="currentColor" strokeWidth={W} />
        <circle cx="49.5" cy="-49.5" r="12" fill="currentColor" />
      </g>
    </svg>
  );
}

/**
 * The live mark. `thinking` ripples, `delegating` sheds droplets, `report` catches one coming back,
 * `attention` pulls the satellite in and turns vermilion. It leans toward the pointer.
 */
export function OmniMark({ state = 'idle', size = 48, title = 'Omni' }: { state?: MarkState; size?: number; title?: string }) {
  const reduced = useReducedMotion();
  const id = `goo${useId().replace(/:/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dropRefs = useRef<(SVGCircleElement | null)[]>([]);
  const live = useRef({ w: { ...MARK_START }, k: 0, phi: -2.4, pk: 0, pphi: -2.4, state, n: DROPLETS });
  live.current.state = state;
  const maxDrops = 2 + DROPLETS;

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    const paint = (f: { d: string; drops: MarkDrop[] }) => {
      pathRef.current?.setAttribute('d', f.d);
      for (let i = 0; i < maxDrops; i++) {
        const el = dropRefs.current[i];
        if (!el) continue;
        const dr = f.drops[i];
        if (dr && dr.r > 0.2) {
          el.setAttribute('cx', dr.x.toFixed(2));
          el.setAttribute('cy', dr.y.toFixed(2));
          el.setAttribute('r', dr.r.toFixed(2));
        } else el.setAttribute('r', '0');
      }
    };
    const onMove = (e: PointerEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const b = svg.getBoundingClientRect();
      const dx = e.clientX - (b.left + b.width / 2);
      const dy = e.clientY - (b.top + b.height / 2);
      const s = b.width;
      live.current.pk = c01(1 - (Math.hypot(dx, dy) - s * 0.3) / (s * 1.4));
      live.current.pphi = Math.atan2(dy, dx);
    };
    const onLeave = () => {
      live.current.pk = 0;
    };
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);
    const loop = (now: number) => {
      const L = live.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      easeWeights(L.w, MARK_TARGETS[L.state] ?? MARK_TARGETS.idle, dt);
      const wantK = L.state === 'attention' ? 0 : L.state === 'hover' ? Math.max(0.85, L.pk) : L.pk * (L.state === 'idle' ? 1 : 0.5);
      L.k += (wantK - L.k) * c01(dt * 7);
      if (L.pk > 0.01 || L.state === 'hover') L.phi += angDiff(L.state === 'hover' && L.pk < 0.01 ? -2.4 : L.pphi, L.phi) * c01(dt * 8);
      paint(markFrame((now - t0) / 1000, L.w, L.k, L.phi, L.n));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [reduced, maxDrops]);

  const cls = `mark ${state === 'attention' ? 'mark-needs' : ''}`;
  const label = title ? title + (state !== 'idle' && state !== 'hover' ? `, ${state}` : '') : undefined;
  if (reduced) return <StaticMark size={size} title={label ?? ''} className={cls} />;
  return (
    <svg ref={svgRef} className={cls} width={size} height={size} viewBox="-64 -64 128 128" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <filter id={id} x="-140" y="-140" width="280" height="280" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
        <g transform={MARK_TRANSFORM}>
        <path ref={pathRef} d={`M${R} 0A${R} ${R} 0 1 1 ${-R} 0A${R} ${R} 0 1 1 ${R} 0Z`} fill="none" stroke="currentColor" strokeWidth={W} strokeLinejoin="round" />
        {Array.from({ length: maxDrops }, (_, i) => (
          <circle
            key={i}
            ref={(el) => {
              dropRefs.current[i] = el;
            }}
            cx={i === 0 ? 49.5 : 0}
            cy={i === 0 ? -49.5 : 0}
            r={i === 0 ? 12 : 0}
            fill="currentColor"
          />
        ))}
        </g>
      </g>
    </svg>
  );
}

// ---------- wordmark ----------

/* "omni" as one continuous 20u line, leaning 10°. Centerline on an integer grid: o r40, m arches r24,
   n arch r28, baseline turns r16, o to m join r26. The o is the mark's ring. The name is just "omni". */
const VB = { x: -15, y: -1, w: 391, h: 102 };
const LINE =
  'M46 90A40 40 0 0 0 86 50A40 40 0 0 0 46 10A40 40 0 0 0 6 50A40 40 0 0 0 46 90L92 90A26 26 0 0 0 118 64L118 34A24 24 0 0 1 166 34L166 74A16 16 0 0 0 198 74L198 34A24 24 0 0 1 246 34L246 74A16 16 0 0 0 278 74L278 38A28 28 0 0 1 334 38L334 74A16 16 0 0 0 366 74L366 10';

/** The line "omni". */
export function OmniWordmark({ height = 32 }: { height?: number }) {
  return (
    <svg width={VB.w * (height / VB.h)} height={height} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} role="img" aria-label="omni" className="block shrink-0 text-fg">
      <path className="wordmark-line" transform="skewX(-10)" d={LINE} pathLength={1} fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------- loader ----------

/** A bead of the ring's own liquid travels around it: a bulge, not a spinner. */
export function Loader({ size = 14, className = '' }: { size?: number; className?: string }) {
  const id = `lgoo${useId().replace(/:/g, '')}`;
  const reduced = useReducedMotion();
  return (
    <svg width={size} height={size} viewBox="-64 -64 128 128" className={`block shrink-0 overflow-visible ${className}`} role="status" aria-label="Loading">
      <defs>
        <filter id={id} x="-120" y="-120" width="240" height="240" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="5" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>
        <circle r="40" fill="none" stroke="currentColor" strokeWidth="20" />
        <g>
          <circle cx="0" cy="-54" r="13" fill="currentColor" />
          {!reduced && <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="1.6s" repeatCount="indefinite" />}
        </g>
      </g>
    </svg>
  );
}

// ---------- harness marks ----------

/* The vendors' own logos, verbatim from Simple Icons (simpleicons.org). Monochrome, currentColor,
   24 grid. Never redraw them or recolor them into a pop. */
export const harnessLabel = (harness: string) => HARNESS[harness]?.label ?? harness;

/** Each harness with the short name usage rows give it, in the order they list. */
export const HARNESS_ROWS: { id: HarnessId; name: string }[] = [
  { id: 'claude-code', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'hermes', name: 'Hermes' },
];

/** The harnesses the running-slots line counts: the usage rows, plus Cursor Cloud, which reports no usage of its own. */
export const SLOT_ROWS: { id: HarnessId; name: string }[] = [...HARNESS_ROWS, { id: 'cursor-cloud', name: 'Cursor Cloud' }];

/** The bare logo. Harnesses without one (Hermes) get their two-letter label. */
export function HarnessLogo({ harness, size = 14, title }: { harness: string; size?: number; title?: string }) {
  const h = HARNESS[harness];
  const label = title ?? h?.label ?? harness;
  if (!h?.logo)
    return (
      <span role="img" aria-label={label} className="inline-grid shrink-0 place-items-center font-medium" style={{ width: size, height: size, fontSize: Math.max(7, size * 0.62), lineHeight: 1 }}>
        {harness.slice(0, 2).toUpperCase()}
      </span>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={label} className="block shrink-0">
      <path d={LOGO[h.logo]} />
    </svg>
  );
}

/** The logo on a small surface disc, for rows and meta lines. */
export function HarnessMark({ harness, withLabel = false }: { harness: string; withLabel?: boolean }) {
  const label = harnessLabel(harness);
  const tag = (
    <span title={label} className="inline-grid shrink-0 place-items-center rounded-full bg-surface-2 text-fg" style={{ width: 20, height: 20 }}>
      <HarnessLogo harness={harness} size={13} title={label} />
    </span>
  );
  if (!withLabel) return tag;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
      {tag}
      {label}
    </span>
  );
}

// ---------- crew marks ----------

/* Five silhouettes derived from the ring. 24 grid, 1.75 stroke, round joins to sit with the icon set. */
export type CrewRole = keyof typeof CREW;
export const isCrewRole = (r: string | null | undefined): r is CrewRole => !!r && r in CREW;

export function CrewMark({ role, size = 16, className = '', title }: { role: CrewRole; size?: number; className?: string; title?: string }) {
  const c = CREW[role];
  return (
    <svg className={`block shrink-0 ${className}`} width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title ?? c.label}>
      {c.shapes.map(({ kind, ...props }, i) => {
        const Shape = kind;
        return <Shape key={i} {...props} />;
      })}
    </svg>
  );
}
