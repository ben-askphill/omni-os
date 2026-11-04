import React from 'react';
import { Ticks } from '../forms/CheckItem.jsx';
import { HarnessLogo, harnessFor } from '../icons/HarnessMark.jsx';

/* Usage meter built on Bencho ticks: ink until the threshold, vermilion past it. */
export function UsageMeter({ label, harness, used, limit, unit = '%', sub, ticks = 24, warnAt = 0.9, compact = false }) {
  const ratio = Math.max(0, Math.min(1, used / limit));
  const hot = ratio >= warnAt;
  const hx = harness === null ? null : harness || harnessFor(label);
  const val = unit === '%' ? Math.round(ratio * 100) + '%' : `${used}${unit} / ${limit}${unit}`;
  return (
    <div className="om-usage" aria-label={label}>
      <div className="om-usage__top" style={compact ? { fontSize: 12 } : null}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>{hx && <HarnessLogo harness={hx} size={compact ? 12 : 14} />}{label}</span><span className="om-usage__val">{val}</span></div>
      <Ticks value={ratio} count={ticks} height={compact ? 10 : 14} tone={hot ? 'needs' : undefined} label={label + ' usage'} />
      {sub && <div className="om-usage__sub">{sub}</div>}
    </div>
  );
}
