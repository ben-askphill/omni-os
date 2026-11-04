import React, { useEffect, useRef, useState } from 'react';

/* The Omni mark: a ring that behaves like a liquid body. SVG + goo (blur → alpha threshold).
   Units: ring centerline R=40, stroke W=20 — the o of the wordmark. The whole mark leans with the wordmark:
   markTransform skews it 10° (scaled/offset to fit the -64..64 viewBox); physics run in the unskewed space. */
let UID = 0;
const R = 40, W = 20, N = 104, TAU = Math.PI * 2;
const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const c01 = (x) => Math.max(0, Math.min(1, x));
const KEYS = ['breath', 'sat', 'ripple', 'drops', 'report', 'tension'];
const TARGETS = {
  idle: { breath: 1, sat: 1 },
  hover: { breath: 1, sat: 1 },
  thinking: { breath: 0.4, ripple: 1 },
  delegating: { breath: 0.4, drops: 1 },
  report: { breath: 0.4, report: 1 },
  attention: { tension: 1, sat: 1 }
};
const SAT_A = -Math.PI / 4;
export const markTransform = 'translate(-4 3) scale(.92) skewX(-10)';

export function markFrame(t, w, leanK, leanPhi, n) {
  const drops = [], bumps = [];
  let after = 0;
  const cx = Math.cos(leanPhi) * 3 * leanK, cy = Math.sin(leanPhi) * 3 * leanK;
  if (w.sat > 0.001) {
    const bob = 1.6 * Math.sin((TAU * t) / 4.8);
    const dist = (70 + bob) * (1 - w.tension) + 58.5 * w.tension - 11 * leanK;
    const a = SAT_A + angDiff(leanPhi, SAT_A) * 0.4 * leanK;
    drops.push({ x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist, r: 12 * w.sat });
  }
  if (w.drops > 0.001) {
    const T = 7.2, tc = t % T;
    for (let i = 0; i < n; i++) {
      const s = 0.4 + i * 1.15, a0 = -0.9 + i * (TAU / Math.max(n, 1)) * 0.92;
      if (tc < s) continue;
      const p = c01((tc - s) / 1.4), e = ease(p);
      const a = a0 + e * 0.15 + Math.max(0, tc - s - 1.4) * 0.2;
      const rad = R + e * (68 - R) + (p >= 1 ? 2 * Math.sin(t * 1.3 + i) : 0);
      const r = (11 - 2.5 * e) * c01((T - 0.4 - tc) / 0.7) * w.drops;
      drops.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, r });
      if (p < 1) bumps.push({ a: a0 + e * 0.15, amp: 7 * Math.sin(Math.PI * p) * w.drops, s: 0.32 });
    }
  }
  if (w.report > 0.001) {
    const T = 3.8, tc = t % T, a = -0.75;
    const p = c01(tc / 1.5), e = p * p;
    const rad = 92 - e * (92 - R);
    let r = 9.5; if (p > 0.8) r *= 1 - ((p - 0.8) / 0.2) * 0.7; if (p >= 1) r = 0;
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
    if (leanK > 0.001) { const dd = angDiff(th, leanPhi); r += leanK * (9 * gauss(dd, 0.55) - 2.2 * gauss(Math.abs(dd) - Math.PI, 0.9)); }
    if (w.tension > 0.001) r += w.tension * (3.6 * Math.cos(2 * (th - 0.4)) - 5 * gauss(angDiff(th, 2.5), 0.24) + 2.4 * gauss(angDiff(th, SAT_A), 0.28));
    for (const b of bumps) r += b.amp * gauss(angDiff(th, b.a), b.s);
    if (after) r += after * Math.sin(5 * th - 6 * t);
    d += (j ? 'L' : 'M') + (cx + Math.cos(th) * r).toFixed(2) + ' ' + (cy + Math.sin(th) * r).toFixed(2);
  }
  return { d: d + 'Z', drops };
}

function useReducedMotion() {
  const [rm, setRm] = useState(() => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setRm(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
  }, []);
  return rm;
}

export function StaticMark({ size = 32, color, title = 'Omni', ring = false, className = '', style }) {
  return (
    <svg className={'om-mark ' + className} width={size} height={size} viewBox="-64 -64 128 128" role="img" aria-label={title} style={{ color, ...style }}>
      <g transform={markTransform}>
        <circle cx="0" cy="0" r={R} fill="none" stroke="currentColor" strokeWidth={W} />
        {!ring && <circle cx="49.5" cy="-49.5" r="12" fill="currentColor" />}
      </g>
    </svg>
  );
}

export function OmniMark({ state = 'idle', size = 48, droplets = 3, interactive = true, color, title = 'Omni', time, lean, leanAngle = -2.4, onAcknowledge, className = '', style }) {
  const reduced = useReducedMotion();
  const idRef = useRef(null); if (!idRef.current) idRef.current = 'om-goo-' + ++UID;
  const svgRef = useRef(null), pathRef = useRef(null), dropRefs = useRef([]);
  const live = useRef({ w: { breath: 1, sat: 1, ripple: 0, drops: 0, report: 0, tension: 0 }, k: 0, phi: -2.4, pk: 0, pphi: -2.4, state, n: droplets });
  live.current.state = state; live.current.n = droplets;
  const frozen = typeof time === 'number';
  const MAXD = 1 + Math.max(droplets, 1) + 1;

  const paint = (f) => {
    if (pathRef.current) pathRef.current.setAttribute('d', f.d);
    for (let i = 0; i < MAXD; i++) {
      const el = dropRefs.current[i]; if (!el) continue;
      const dr = f.drops[i];
      if (dr && dr.r > 0.2) { el.setAttribute('cx', dr.x.toFixed(2)); el.setAttribute('cy', dr.y.toFixed(2)); el.setAttribute('r', dr.r.toFixed(2)); }
      else el.setAttribute('r', '0');
    }
  };

  useEffect(() => {
    if (reduced) return;
    if (frozen) {
      const w = {}; KEYS.forEach((k) => (w[k] = (TARGETS[state] || TARGETS.idle)[k] || 0));
      paint(markFrame(time, w, state === 'hover' ? (lean ?? 0.8) : lean || 0, leanAngle, droplets));
      return;
    }
    let raf, last = performance.now(), t0 = last;
    const onMove = (e) => {
      const svg = svgRef.current; if (!svg) return;
      const b = svg.getBoundingClientRect();
      const dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
      const dist = Math.hypot(dx, dy), s = b.width;
      live.current.pk = c01(1 - (dist - s * 0.3) / (s * 1.4));
      live.current.pphi = Math.atan2(dy, dx);
    };
    const onLeave = () => { live.current.pk = 0; };
    if (interactive) { window.addEventListener('pointermove', onMove); document.addEventListener('pointerleave', onLeave); }
    const loop = (now) => {
      const L = live.current, dt = Math.min(0.05, (now - last) / 1000); last = now;
      const tgt = TARGETS[L.state] || TARGETS.idle, a = c01(dt * 5);
      KEYS.forEach((k) => (L.w[k] += ((tgt[k] || 0) - L.w[k]) * a));
      const wantK = L.state === 'attention' ? 0 : L.state === 'hover' ? Math.max(0.85, L.pk) : L.pk * (L.state === 'idle' ? 1 : 0.5);
      L.k += (wantK - L.k) * c01(dt * 7);
      if (L.pk > 0.01 || L.state === 'hover') L.phi += angDiff(L.state === 'hover' && L.pk < 0.01 ? -2.4 : L.pphi, L.phi) * c01(dt * 8);
      paint(markFrame((now - t0) / 1000, L.w, L.k, L.phi, L.n));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); document.removeEventListener('pointerleave', onLeave); };
  }, [reduced, frozen, time, state, interactive, droplets, lean, leanAngle]);

  const needs = state === 'attention';
  const cls = 'om-mark' + (needs ? ' om-mark--needs' : '') + (className ? ' ' + className : '');
  const ack = needs && onAcknowledge ? { onClick: onAcknowledge, style: { cursor: 'pointer', color, transition: 'color var(--dur-slow) var(--ease-out)', ...style } } : { style: { color, transition: 'color var(--dur-slow) var(--ease-out)', ...style } };
  if (reduced) return <StaticMark size={size} title={title} className={cls} color={color} style={ack.style} />;
  const id = idRef.current;
  return (
    <svg ref={svgRef} className={cls} width={size} height={size} viewBox="-64 -64 128 128" role="img" aria-label={title + (state !== 'idle' ? ' — ' + state : '')} {...ack}>
      <defs>
        <filter id={id} x="-140" y="-140" width="280" height="280" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
        </filter>
      </defs>
      <g filter={'url(#' + id + ')'}><g transform={markTransform}>
        <path ref={pathRef} d={'M' + R + ' 0A' + R + ' ' + R + ' 0 1 1 ' + -R + ' 0A' + R + ' ' + R + ' 0 1 1 ' + R + ' 0Z'} fill="none" stroke="currentColor" strokeWidth={W} strokeLinejoin="round" />
        {Array.from({ length: MAXD }).map((_, i) => (
          <circle key={i} ref={(el) => (dropRefs.current[i] = el)} cx={i === 0 ? 49.5 : 0} cy={i === 0 ? -49.5 : 0} r={i === 0 ? 12 : 0} fill="currentColor" />
        ))}
      </g></g>
    </svg>
  );
}
