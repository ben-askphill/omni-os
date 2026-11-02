import { describe, expect, it } from 'vitest';

import { clampSlide, slideReached } from '../src/ui/slide';

describe('slide to confirm', () => {
  it('confirms at 85% of the track and past it', () => {
    expect(slideReached(84, 100)).toBe(false);
    expect(slideReached(85, 100)).toBe(true);
    expect(slideReached(400, 100)).toBe(true);
  });

  it('does not confirm on a drag to the left or on a track with no room', () => {
    expect(slideReached(-50, 100)).toBe(false);
    expect(slideReached(10, 0)).toBe(false);
  });

  it('keeps the thumb on the track', () => {
    expect(clampSlide(-10, 100)).toBe(0);
    expect(clampSlide(140, 100)).toBe(100);
    expect(clampSlide(40, 100)).toBe(40);
  });
});
