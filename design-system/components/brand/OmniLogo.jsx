import React from 'react';
import { OmniMark } from './OmniMark.jsx';

/* Wordmark: "omni" as one continuous 20u line, leaning 10°. Centerline on an integer grid:
   o r40 · m arches r24 · n arch r28 · baseline turns r16 · o→m join r26 · 12u wherever strokes meet.
   The o is the mark's ring (OmniMark uses the same r40 / 20u / 10° lean). */
const VB = { x: -15, y: -1, w: 391, h: 102 };
const LINE = 'M46 90A40 40 0 0 0 86 50A40 40 0 0 0 46 10A40 40 0 0 0 6 50A40 40 0 0 0 46 90L92 90A26 26 0 0 0 118 64L118 34A24 24 0 0 1 166 34L166 74A16 16 0 0 0 198 74L198 34A24 24 0 0 1 246 34L246 74A16 16 0 0 0 278 74L278 38A28 28 0 0 1 334 38L334 74A16 16 0 0 0 366 74L366 10';

export function OmniLogo({ variant = 'wordmark', height = 32, live = false, markState = 'idle', color, title = 'omni' }) {
  if (variant === 'mark') return <OmniMark size={height} state={markState} color={color} title={title} />;
  const wPx = VB.w * (height / VB.h);
  const word = (
    <svg width={wPx} height={height} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} role="img" aria-label={title} style={{ display: 'block', flex: 'none', color }}>
      <path transform="skewX(-10)" d={LINE} fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const withMark = live ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: height * 0.28, color }}>
      <OmniMark size={height * 1.2} state={markState} color={color} title="" interactive />
      {word}
    </span>
  ) : word;
  return withMark;
}
