// The running turn's label shimmer: a vermilion highlight sweeps across muted text. The web draws it in CSS
// (`.shimmer-text` in apps/web/src/index.css, which tests/shimmer-css.test.ts in apps/web holds to this spec) and the
// iOS app in react-native-svg (apps/ios/src/ui/ShimmerText.tsx). Pure.

/** One sweep. */
export const SHIMMER_MS = 1750;
/** The web's --ease-fluid, as cubic-bezier control points. */
export const SHIMMER_EASING = [0.37, 0, 0.63, 1] as const;
/** The gradient is this many times as wide as the label (CSS background-size 480%). */
export const SHIMMER_SIZE = 4.8;
/** The gradient's background-position x at the start and end of a sweep, as fractions (CSS 115% to -15%). */
export const SHIMMER_FROM = 1.15;
export const SHIMMER_TO = -0.15;

/** The colours the gradient mixes: the label's muted text (fg-3, fg-4) and the needs-you vermilion. Hex, #rrggbb. */
export interface ShimmerInk {
  fg3: string;
  fg4: string;
  vermilion: string;
}

/**
 * A stop: where along the gradient (0 to 1) and what it mixes. `mix` is CSS `color-mix(in srgb, <mix.of> <mix.pct>%,
 * var(--vermilion))`; without one the stop is `of` itself.
 */
export interface ShimmerStop {
  offset: number;
  of: 'fg4' | 'vermilion';
  mix?: { of: 'fg3' | 'fg4'; pct: number };
}

export const SHIMMER_STOPS: readonly ShimmerStop[] = [
  { offset: 0, of: 'fg4' },
  { offset: 0.14, of: 'fg4' },
  { offset: 0.26, of: 'vermilion', mix: { of: 'fg4', pct: 30 } },
  { offset: 0.38, of: 'vermilion', mix: { of: 'fg3', pct: 10 } },
  { offset: 0.5, of: 'vermilion' },
  { offset: 0.62, of: 'vermilion', mix: { of: 'fg3', pct: 10 } },
  { offset: 0.74, of: 'vermilion', mix: { of: 'fg4', pct: 30 } },
  { offset: 0.86, of: 'fg4' },
  { offset: 1, of: 'fg4' },
];

const channels = (hex: string): [number, number, number] => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};

/** CSS `color-mix(in srgb, a pct%, b)`: each sRGB channel weighted, rounded to a byte. */
export function mixSrgb(a: string, pct: number, b: string): string {
  const [x, y] = [channels(a), channels(b)];
  const w = pct / 100;
  return `#${x.map((c, i) => Math.round(c * w + y[i] * (1 - w)).toString(16).padStart(2, '0')).join('')}`;
}

/** The gradient's stops in one scheme's colours. */
export function shimmerStops(ink: ShimmerInk): { offset: number; color: string }[] {
  return SHIMMER_STOPS.map((s) => ({ offset: s.offset, color: s.mix ? mixSrgb(ink[s.mix.of], s.mix.pct, ink.vermilion) : ink[s.of] }));
}

/**
 * Where the gradient's left edge sits, in points from the label's left edge, for a label `width` wide at eased progress
 * `p` (0 to 1) through a sweep. CSS places a background `size` wide at `(width - size) * position` and repeats it,
 * so a drawing needs a tile on either side of this one to cover the label at the ends of a sweep.
 */
export function shimmerX(p: number, width: number): number {
  'worklet';
  const position = SHIMMER_FROM + (SHIMMER_TO - SHIMMER_FROM) * p;
  return (width - SHIMMER_SIZE * width) * position;
}
