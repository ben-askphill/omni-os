import React from 'react';

/* Liquid toggle (Bencho): the knob stretches while pressed, then springs across. */
export function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled} onClick={() => onChange && onChange(!checked)} className="om-tgl">
      <span className="om-tgl-knob" />
    </button>
  );
}
