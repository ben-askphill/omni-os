import { describe, expect, it } from 'vitest';
import { mixSrgb, SHIMMER_SIZE, shimmerStops, shimmerX } from '../shimmer.ts';

// The thinking line's shimmer, in the colours each scheme mixes (apps/web/src/index.css --fg-3, --fg-4, --vermilion).
const light = { fg3: '#62615c', fg4: '#9d9c96', vermilion: '#ff4420' };
const dark = { fg3: '#a09f99', fg4: '#83827c', vermilion: '#ff4420' };

describe('mixSrgb', () => {
  it('weights each sRGB channel as CSS color-mix does', () => {
    expect(mixSrgb('#000000', 50, '#ffffff')).toBe('#808080');
    expect(mixSrgb('#9d9c96', 30, '#ff4420')).toBe('#e25e43');
    expect(mixSrgb('#a09f99', 100, '#ff4420')).toBe('#a09f99');
  });
});

describe('shimmerStops', () => {
  it('runs muted, through vermilion at the middle, and back, symmetric', () => {
    for (const ink of [light, dark]) {
      const stops = shimmerStops(ink);
      expect(stops.map((s) => s.offset)).toEqual([0, 0.14, 0.26, 0.38, 0.5, 0.62, 0.74, 0.86, 1]);
      expect(stops[4].color).toBe('#ff4420');
      expect(stops[0].color).toBe(ink.fg4);
      expect(stops.map((s) => s.color)).toEqual([...stops].reverse().map((s) => s.color));
    }
  });

  it('mixes each scheme in its own colours', () => {
    expect(shimmerStops(light).slice(2, 4).map((s) => s.color)).toEqual(['#e25e43', '#ef4726']);
    expect(shimmerStops(dark).slice(2, 4).map((s) => s.color)).toEqual(['#da573c', '#f64d2c']);
  });
});

describe('shimmerX', () => {
  it('sweeps the highlight from left of the label to past its right edge, as background-position 115% to -15%', () => {
    const w = 100;
    const centre = (p: number) => shimmerX(p, w) + (SHIMMER_SIZE * w) / 2;
    expect(shimmerX(0, w)).toBeCloseTo(-437);
    expect(shimmerX(1, w)).toBeCloseTo(57);
    expect(centre(0)).toBeLessThan(0);
    expect(centre(1)).toBeGreaterThan(w);
  });

  it('covers the whole label at every point of a sweep with a tile either side, as CSS repeats the background', () => {
    const w = 100;
    const tile = SHIMMER_SIZE * w;
    for (let p = 0; p <= 1; p += 0.01) {
      const x = shimmerX(p, w);
      expect(x - tile).toBeLessThanOrEqual(0);
      expect(x + 2 * tile).toBeGreaterThanOrEqual(w);
    }
    // One tile alone leaves the label bare at the start of a sweep.
    expect(shimmerX(0, w) + tile).toBeLessThan(w);
  });
});
