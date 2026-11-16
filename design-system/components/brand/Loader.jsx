import React from 'react';

/* Loader: something loads that is not a thread at work (a button's request, a list being read). It is the running
   status dot in the text's own colour, half its box, with the same halo: no spinner, no travelling bead (PR #755). */
const h = React.createElement;
export function Loader({ size = 14, label, color }) {
  return h('span', { className: 'om-loader', role: 'status', 'aria-label': label || 'Loading', style: color ? { color } : undefined },
    h('span', { className: 'om-glyph', 'data-mark': 'loading', style: { width: size, height: size } },
      h('i', { className: 'om-glyph__ping' }),
      h('svg', { viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' }, h('circle', { cx: 8, cy: 8, r: 4 }))),
    label ? h('span', null, label) : null);
}
