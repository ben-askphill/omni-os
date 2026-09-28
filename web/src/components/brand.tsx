import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// ---------- the Omni mark ----------

/* A ring that behaves like a liquid body: SVG plus a goo filter (blur, then an alpha threshold).
   Units: ring centerline R=40, stroke W=20, the o of the wordmark. The mark leans 10° with the wordmark;
   physics run unskewed and MARK_TRANSFORM fits the lean into the -64..64 viewBox. */
const R = 40;
const W = 20;
export const MARK_TRANSFORM = 'translate(-4 3) scale(.92) skewX(-10)';
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

/** The mark without motion: ring plus satellite (or ring alone). Used for reduced motion and favicons. */
export function StaticMark({ size = 32, title = 'Omni', ring = false, className = '', style }: { size?: number; title?: string; ring?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`mark ${className}`} width={size} height={size} viewBox="-64 -64 128 128" role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true} style={style}>
      <g transform={MARK_TRANSFORM}>
        <circle cx="0" cy="0" r={R} fill="none" stroke="currentColor" strokeWidth={W} />
        {!ring && <circle cx="49.5" cy="-49.5" r="12" fill="currentColor" />}
      </g>
    </svg>
  );
}

/**
 * The live mark. `thinking` ripples, `delegating` sheds droplets, `report` catches one coming back,
 * `attention` pulls the satellite in and turns vermilion. It leans toward the pointer when `interactive`.
 */
export function OmniMark({
  state = 'idle',
  size = 48,
  droplets = 3,
  interactive = true,
  title = 'Omni',
  className = '',
  style,
}: {
  state?: MarkState;
  size?: number;
  droplets?: number;
  interactive?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const id = `goo${useId().replace(/:/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dropRefs = useRef<(SVGCircleElement | null)[]>([]);
  const live = useRef({ w: { breath: 1, sat: 1, ripple: 0, drops: 0, report: 0, tension: 0 } as Weights, k: 0, phi: -2.4, pk: 0, pphi: -2.4, state, n: droplets });
  live.current.state = state;
  live.current.n = droplets;
  const maxDrops = 2 + Math.max(droplets, 1);

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
    if (interactive) {
      window.addEventListener('pointermove', onMove);
      document.addEventListener('pointerleave', onLeave);
    }
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
  }, [reduced, interactive, maxDrops]);

  const cls = `mark ${state === 'attention' ? 'mark-needs' : ''} ${className}`;
  const label = title ? title + (state !== 'idle' && state !== 'hover' ? `, ${state}` : '') : undefined;
  if (reduced) return <StaticMark size={size} title={label ?? ''} className={cls} style={style} />;
  return (
    <svg ref={svgRef} className={cls} width={size} height={size} viewBox="-64 -64 128 128" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={style}>
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

/** `wordmark` is the line "omni"; `mark` is the fluid mark alone; `live` puts the moving mark beside the word. */
export function OmniLogo({ variant = 'wordmark', height = 32, live = false, markState = 'idle', title = 'omni' }: { variant?: 'wordmark' | 'mark'; height?: number; live?: boolean; markState?: MarkState; title?: string }) {
  if (variant === 'mark') return <OmniMark size={height} state={markState} title={title} />;
  const word = (
    <svg width={VB.w * (height / VB.h)} height={height} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} role="img" aria-label={title} className="block shrink-0 text-fg">
      <path transform="skewX(-10)" d={LINE} fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (!live) return word;
  return (
    <span className="inline-flex items-center text-fg" style={{ gap: height * 0.28 }}>
      <OmniMark size={height * 1.2} state={markState} title="" />
      {word}
    </span>
  );
}

// ---------- loader ----------

/** A bead of the ring's own liquid travels around it: a bulge, not a spinner. */
export function Loader({ size = 14, label, className = '' }: { size?: number; label?: ReactNode; className?: string }) {
  const id = `lgoo${useId().replace(/:/g, '')}`;
  const reduced = useReducedMotion();
  const svg = (
    <svg width={size} height={size} viewBox="-64 -64 128 128" className={`block shrink-0 overflow-visible ${label ? '' : className}`} role={label ? undefined : 'status'} aria-label={label ? undefined : 'Loading'} aria-hidden={label ? true : undefined}>
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
  if (!label) return svg;
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-[12.5px] text-fg-3 ${className}`}>
      {svg}
      <span>{label}</span>
    </span>
  );
}

// ---------- harness marks ----------

/* The vendors' own logos, verbatim from Simple Icons (simpleicons.org). Monochrome, currentColor,
   24 grid. Never redraw them or recolor them into a pop. */
const LOGO = {
  claude:
    'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  openai:
    'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  cursor:
    'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23',
} as const;

const HARNESS: Record<string, { logo?: keyof typeof LOGO; label: string }> = {
  'claude-code': { logo: 'claude', label: 'Claude Code' },
  codex: { logo: 'openai', label: 'Codex' },
  cursor: { logo: 'cursor', label: 'Cursor' },
  hermes: { label: 'Hermes' },
};

export const harnessLabel = (harness: string) => HARNESS[harness]?.label ?? harness;

/** Resolve a harness id from free text ("Claude", "Codex", "Cursor", "Claude Code"). */
export function harnessFor(name: string | null | undefined): string | null {
  const n = String(name ?? '').toLowerCase();
  if (n.includes('claude')) return 'claude-code';
  if (n.includes('codex') || n.includes('chatgpt') || n.includes('openai')) return 'codex';
  if (n.includes('cursor')) return 'cursor';
  if (n.includes('hermes')) return 'hermes';
  return null;
}

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
export function HarnessMark({ harness, size = 'md', withLabel = false, className = '' }: { harness: string; size?: 'md' | 'lg'; withLabel?: boolean; className?: string }) {
  const label = harnessLabel(harness);
  const box = size === 'lg' ? 26 : 20;
  const tag = (
    <span title={label} className={`inline-grid shrink-0 place-items-center rounded-full bg-surface-2 text-fg ${withLabel ? '' : className}`} style={{ width: box, height: box }}>
      <HarnessLogo harness={harness} size={size === 'lg' ? 16 : 13} title={label} />
    </span>
  );
  if (!withLabel) return tag;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12.5px] text-fg-2 ${className}`}>
      {tag}
      {label}
    </span>
  );
}

// ---------- crew marks ----------

/* Five silhouettes derived from the ring. 24 grid, 1.75 stroke, round joins to sit with the icon set. */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const CREW = {
  conductor: { label: 'Conductor', el: <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="3.6" /> },
  researcher: {
    label: 'Researcher',
    el: (
      <g>
        <circle cx="12" cy="12" r="8.5" {...S} />
        <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      </g>
    ),
  },
  builder: {
    label: 'Builder',
    el: (
      <g>
        <rect x="4" y="4" width="16" height="16" rx="3.5" {...S} />
        <rect x="12" y="12" width="8" height="8" rx="2" fill="currentColor" />
      </g>
    ),
  },
  'store-ops': {
    label: 'Store ops',
    el: (
      <g>
        <path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5l8 8-9 9z" {...S} />
        <circle cx="8.5" cy="8.5" r="1.75" fill="currentColor" />
      </g>
    ),
  },
  inbox: { label: 'Inbox', el: <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" {...S} /> },
};

export type CrewRole = keyof typeof CREW;
export const isCrewRole = (r: string | null | undefined): r is CrewRole => !!r && r in CREW;

export function CrewMark({ role, size = 16, className = '', title }: { role: CrewRole; size?: number; className?: string; title?: string }) {
  const c = CREW[role];
  return (
    <svg className={`block shrink-0 ${className}`} width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title ?? c.label}>
      {c.el}
    </svg>
  );
}
