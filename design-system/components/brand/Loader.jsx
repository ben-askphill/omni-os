import React, { useRef } from 'react';
import { markTransform } from './OmniMark.jsx';

let LID = 0;
/* Loader: a bead of the ring's own liquid travels around it — a bulge, not a spinner. */
export function Loader({ size = 20, label, color }) {
  const id = useRef('om-lgoo-' + ++LID).current;
  const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <span className="om-loader" role="status" aria-label={label || 'Loading'} style={{ color }}>
      <svg width={size} height={size} viewBox="-64 -64 128 128" style={{ display: 'block', overflow: 'visible', color: color || 'var(--text-1)' }} aria-hidden="true">
        <defs>
          <filter id={id} x="-120" y="-120" width="240" height="240" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="5" />
            <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
          </filter>
        </defs>
        <g filter={'url(#' + id + ')'}><g transform={markTransform}>
          <circle r="40" fill="none" stroke="currentColor" strokeWidth="20" />
          <g>
            <circle cx="0" cy="-55" r="12" fill="currentColor" />
            {!reduced && <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="1.6s" repeatCount="indefinite" />}
          </g>
        </g></g>
      </svg>
      {label && <span>{label}</span>}
    </span>
  );
}
