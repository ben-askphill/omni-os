import React from 'react';

/* Animated checklist row (Bencho "chk"): the box fills, the tick draws, the label is struck through. */
export function CheckItem({ state = 'pending', children, onClick }) {
  return (
    <div data-state={state} className="om-chk" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <span className="om-chk-box">
        <span className="om-chk-fill" />
        <svg viewBox="0 0 24 24" className="om-chk-tick" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        {state === 'in_progress' && <span className="om-chk-live" />}
      </span>
      <span className="om-chk-text"><span className="om-chk-say">{children}</span></span>
    </div>
  );
}

/* Usage as a row of ticks (Bencho "tick"). value is 0..1. */
export function Ticks({ value = 0, count = 24, height = 14, tone, label, className = '', style }) {
  const v = Math.max(0, Math.min(1, value));
  const on = v > 0 ? Math.max(1, Math.round(v * count)) : 0;
  const s = { '--ticks-h': height + 'px', '--tick-on': tone === 'needs' || tone === 'bad' ? 'var(--needs)' : tone === 'live' ? 'var(--live)' : 'var(--fg)', ...style };
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className={'om-ticks ' + className} style={s}>
      {Array.from({ length: count }, (_, i) => <i key={i} data-on={i < on || undefined} />)}
    </div>
  );
}
