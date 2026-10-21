import { describe, expect, it } from 'vitest';
import { BOTTOM_SLACK, followAfterScroll } from '../src/pages/useTranscriptScroll.ts';

// The transcript's auto scroll, as ScrollPin.swift on the Mac: a scroll up leaves the bottom, however small.

describe('followAfterScroll', () => {
  it('stops following on a scroll up of a few pixels', () => {
    expect(followAfterScroll(true, 1500, 1460, 40)).toBe(false);
  });

  it('keeps following at the bottom, and when content shrinking clamps the position', () => {
    expect(followAfterScroll(true, 1500, 1500, 0)).toBe(true);
    expect(followAfterScroll(true, 1500, 1420, 0)).toBe(true);
    expect(followAfterScroll(true, 1500, 1497, BOTTOM_SLACK)).toBe(true);
  });

  it('follows again only once back at the bottom', () => {
    expect(followAfterScroll(false, 1000, 1400, 100)).toBe(false);
    expect(followAfterScroll(false, 1400, 1500, 0)).toBe(true);
  });

  it('keeps following while the jump scrolls down', () => {
    expect(followAfterScroll(true, 200, 600, 900)).toBe(true);
  });
});
