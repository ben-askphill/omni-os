import { MARK_TRANSFORM, HARNESS_LOGOS as LOGO, HARNESS, CREW } from '@omni/shared/brand.ts';
import { useEffect, useId, useRef, useState } from 'react';
import type { HarnessId } from '../api.ts';

// ---------- the Omni mark ----------

/* A ring that behaves like a liquid body: SVG plus a goo filter (blur, then an alpha threshold).
   Units: ring centerline R=40, stroke W=20, the o of the wordmark. The mark leans 10° with the wordmark;
   physics run unskewed and MARK_TRANSFORM fits the lean into the -64..64 viewBox. */
const R = 40;
/** Droplets the live mark sheds when delegating. */
const DROPLETS = 3;
const W = 20;
export { MARK_TRANSFORM } from '@omni/shared/brand.ts';
const N = 104;
const TAU = Math.PI * 2;
const SAT_A = -Math.PI / 4;
const gauss = (x: number, s: number) => Math.exp(-(x * x) / (2 * s * s));
const angDiff = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const c01 = (x: number) => Math.max(0, Math.min(1, x));

export type MarkState = 'idle' | 'hover' | 'thinking' | 'delegating' | 'report' | 'attention';
type Weights = { breath: number; sat: number; ripple: number; drops: number; report: number; tension: number };
const KEYS = ['breath', 'sat', 'ripple', 'drops', 'report', 'tension'] as const;
const TARGETS: Record<MarkState, Partial<Weights>> = {
  idle: { breath: 1, sat: 1 },
  hover: { breath: 1, sat: 1 },
  thinking: { breath: 0.4, ripple: 1 },
  delegating: { breath: 0.4, drops: 1 },
  report: { breath: 0.4, report: 1 },
  attention: { tension: 1, sat: 1 },
};

interface Drop {
  x: number;
  y: number;
  r: number;
}

function markFrame(t: number, w: Weights, leanK: number, leanPhi: number, n: number) {
  const drops: Drop[] = [];
  const bumps: { a: number; amp: number; s: number }[] = [];
  let after = 0;
  const cx = Math.cos(leanPhi) * 3 * leanK;
  const cy = Math.sin(leanPhi) * 3 * leanK;
  if (w.sat > 0.001) {
    const bob = 1.6 * Math.sin((TAU * t) / 4.8);
    const dist = (70 + bob) * (1 - w.tension) + 58.5 * w.tension - 11 * leanK;
    const a = SAT_A + angDiff(leanPhi, SAT_A) * 0.4 * leanK;
    drops.push({ x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist, r: 12 * w.sat });
  }
  if (w.drops > 0.001) {
    const T = 7.2;
    const tc = t % T;
    for (let i = 0; i < n; i++) {
      const s = 0.4 + i * 1.15;
      const a0 = -0.9 + i * (TAU / Math.max(n, 1)) * 0.92;
      if (tc < s) continue;
      const p = c01((tc - s) / 1.4);
      const e = easeInOut(p);
      const a = a0 + e * 0.15 + Math.max(0, tc - s - 1.4) * 0.2;
      const rad = R + e * (68 - R) + (p >= 1 ? 2 * Math.sin(t * 1.3 + i) : 0);
      const r = (11 - 2.5 * e) * c01((T - 0.4 - tc) / 0.7) * w.drops;
      drops.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, r });
      if (p < 1) bumps.push({ a: a0 + e * 0.15, amp: 7 * Math.sin(Math.PI * p) * w.drops, s: 0.32 });
    }
  }
  if (w.report > 0.001) {
    const T = 3.8;
    const tc = t % T;
    const a = -0.75;
    const p = c01(tc / 1.5);
    const e = p * p;
    const rad = 92 - e * (92 - R);
    let r = 9.5;
    if (p > 0.8) r *= 1 - ((p - 0.8) / 0.2) * 0.7;
    if (p >= 1) r = 0;
    drops.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, r: r * w.report });
    bumps.push({ a, amp: Math.sin(Math.PI * c01((tc - 1.1) / 1.2)) * 8 * w.report, s: 0.4 });
    after = Math.sin(Math.PI * c01((tc - 1.6) / 1.6)) * 1.6 * w.report;
  }
  const br = Math.sin((TAU * t) / 4.8);
  let d = '';
  for (let j = 0; j < N; j++) {
    const th = (j / N) * TAU;
    let r = R + w.breath * (1.1 * br + 0.5 * Math.sin(2 * th + t * 0.7));
    if (w.ripple > 0.001) r += w.ripple * (1.9 * Math.sin(6 * th - 4.6 * t) + 1.0 * Math.sin(10 * th + 3.1 * t));
    if (leanK > 0.001) {
      const dd = angDiff(th, leanPhi);
      r += leanK * (9 * gauss(dd, 0.55) - 2.2 * gauss(Math.abs(dd) - Math.PI, 0.9));
    }
    if (w.tension > 0.001) r += w.tension * (3.6 * Math.cos(2 * (th - 0.4)) - 5 * gauss(angDiff(th, 2.5), 0.24) + 2.4 * gauss(angDiff(th, SAT_A), 0.28));
    for (const b of bumps) r += b.amp * gauss(angDiff(th, b.a), b.s);
    if (after) r += after * Math.sin(5 * th - 6 * t);
    d += (j ? 'L' : 'M') + (cx + Math.cos(th) * r).toFixed(2) + ' ' + (cy + Math.sin(th) * r).toFixed(2);
  }
  return { d: d + 'Z', drops };
}

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
  const live = useRef({ w: { breath: 1, sat: 1, ripple: 0, drops: 0, report: 0, tension: 0 } as Weights, k: 0, phi: -2.4, pk: 0, pphi: -2.4, state, n: DROPLETS });
  live.current.state = state;
  const maxDrops = 2 + DROPLETS;

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    const paint = (f: { d: string; drops: Drop[] }) => {
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
      const tgt = TARGETS[L.state] ?? TARGETS.idle;
      const a = c01(dt * 5);
      for (const k of KEYS) L.w[k] += ((tgt[k] ?? 0) - L.w[k]) * a;
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
