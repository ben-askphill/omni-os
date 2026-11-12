import { describe, expect, it } from 'vitest';
import { compact, pct, usd } from '../src/components/dashboard/numbers.ts';

describe('dashboard numbers', () => {
  it('keeps whole hundreds and drops only trailing decimal zeros', () => {
    expect([compact(500e6), compact(1.5e9), compact(2e9), compact(12_340), compact(100_000), compact(999)]).toEqual(['500M', '1.5B', '2B', '12.3K', '100K', '999']);
  });
  it('says "<1%" for a sliver and "–" with nothing to share', () => {
    expect([pct(1, 1000), pct(1, 3), pct(1, 0)]).toEqual(['<1%', '33%', '–']);
  });
  it('writes dollars to the cent below $1,000', () => {
    expect([usd(0.004), usd(13.75), usd(1592.4)]).toEqual(['<$0.01', '$13.75', '$1,592']);
  });
});
