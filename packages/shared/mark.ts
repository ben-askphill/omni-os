// The live Omni mark's physics, one frame at a time: the web's OmniMark (apps/web/src/components/brand.tsx) and the iOS
// thinking line's mark (apps/ios/src/ui/ThinkingMark.tsx) both draw these frames. Pure.
//
// Every function carries a 'worklet' directive so the iOS app can run it on the UI thread with Reanimated. Elsewhere
// the directive is an unused string.

/* A ring that behaves like a liquid body. Units: ring centerline R=40, stroke W=20, the o of the wordmark. The mark
   leans 10° with the wordmark; physics run unskewed and MARK_TRANSFORM fits the lean into the -64..64 viewBox. */
export const MARK_R = 40;
export const MARK_W = 20;
/** Droplets the live mark sheds when delegating. */
export const MARK_DROPLETS = 3;
const N = 104;
const TAU = Math.PI * 2;
const SAT_A = -Math.PI / 4;

function gauss(x: number, s: number) {
  'worklet';
  return Math.exp(-(x * x) / (2 * s * s));
}
export function angDiff(a: number, b: number) {
  'worklet';
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
function easeInOut(p: number) {
  'worklet';
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
}
export function c01(x: number) {
  'worklet';
  return Math.max(0, Math.min(1, x));
}

export type MarkState = 'idle' | 'hover' | 'thinking' | 'delegating' | 'report' | 'attention';
export type MarkWeights = { breath: number; sat: number; ripple: number; drops: number; report: number; tension: number };
/** Where each state's weights settle. A mark starts at `MARK_START` and eases toward its state's targets. */
export const MARK_TARGETS: Record<MarkState, Partial<MarkWeights>> = {
  idle: { breath: 1, sat: 1 },
  hover: { breath: 1, sat: 1 },
  thinking: { breath: 0.4, ripple: 1 },
  delegating: { breath: 0.4, drops: 1 },
  report: { breath: 0.4, report: 1 },
  attention: { tension: 1, sat: 1 },
};
export const MARK_START: MarkWeights = { breath: 1, sat: 1, ripple: 0, drops: 0, report: 0, tension: 0 };

/** Moves each weight toward `target` for a frame `dt` seconds long, in place. */
export function easeWeights(w: MarkWeights, target: Partial<MarkWeights>, dt: number) {
  'worklet';
  const a = c01(dt * 5);
  w.breath += ((target.breath ?? 0) - w.breath) * a;
  w.sat += ((target.sat ?? 0) - w.sat) * a;
  w.ripple += ((target.ripple ?? 0) - w.ripple) * a;
  w.drops += ((target.drops ?? 0) - w.drops) * a;
  w.report += ((target.report ?? 0) - w.report) * a;
  w.tension += ((target.tension ?? 0) - w.tension) * a;
}

export interface MarkDrop {
  x: number;
  y: number;
  r: number;
}

/** The ring's outline as an SVG path and the drops around it, `t` seconds in, leaning `leanK` (0 to 1) toward `leanPhi`. */
export function markFrame(t: number, w: MarkWeights, leanK: number, leanPhi: number, n: number) {
  'worklet';
  const R = MARK_R;
  const drops: MarkDrop[] = [];
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
