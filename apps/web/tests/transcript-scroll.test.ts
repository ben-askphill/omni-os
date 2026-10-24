import { describe, expect, it } from 'vitest';
import { firstBelow } from '../src/pages/useScrollAnchor.ts';
import { BOTTOM_SLACK, followAfterScroll, onContent } from '../src/pages/useTranscriptScroll.ts';

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

describe('onContent', () => {
  it('keeps to the bottom on open and while following', () => {
    expect(onContent(true, false, true)).toBe('bottom');
    expect(onContent(false, true, false)).toBe('bottom');
  });

  it('shows New activity only for rows newer than the tail, never for older rows loading above', () => {
    expect(onContent(false, false, true)).toBe('pill');
    expect(onContent(false, false, false)).toBe('stay');
  });
});

describe('firstBelow', () => {
  const bottoms = [40, 90, 150, 300];
  it('finds the first row still showing under the top edge', () => {
    expect(firstBelow(bottoms.length, (i) => bottoms[i], 0)).toBe(0);
    expect(firstBelow(bottoms.length, (i) => bottoms[i], 90)).toBe(2);
    expect(firstBelow(bottoms.length, (i) => bottoms[i], 120)).toBe(2);
    expect(firstBelow(bottoms.length, (i) => bottoms[i], 300)).toBe(4);
    expect(firstBelow(0, () => 0, 0)).toBe(0);
  });
});
