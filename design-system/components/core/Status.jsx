import React from 'react';

export const STATUS_LABEL = { running: 'Running', needs: 'Needs you', done: 'Done', settled: 'Done', idle: 'Idle', queued: 'Queued', failed: 'Failed', stopped: 'Stopped' };
const norm = (s) => (s === 'failed' ? 'needs' : s === 'stopped' ? 'settled' : s || 'settled');

/* StatusDot (web/src ui.tsx) with the Omni pops: running pings in ultramarine, needs is a still vermilion diamond,
   done is a volt disc with an ink edge on white. */
export function StatusGlyph({ state = 'settled', size = 8, className = '' }) {
  const s = norm(state);
  return (
    <span className={'om-dot om-dot--' + s + (className ? ' ' + className : '')} style={{ width: size, height: size }} title={STATUS_LABEL[state] || state} aria-hidden="true">
      {s === 'running' && <i className="ping" />}
      <i />
    </span>
  );
}

export function Status({ state = 'settled', label, showLabel = true }) {
  const s = norm(state);
  const text = label ?? STATUS_LABEL[state] ?? state;
  if (!showLabel) return <StatusGlyph state={state} />;
  return (
    <span className={'om-spill om-spill--' + s} role="status">
      <StatusGlyph state={state} size={6} />
      {text}
    </span>
  );
}
