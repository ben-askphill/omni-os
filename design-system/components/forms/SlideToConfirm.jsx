import React, { useRef, useState } from 'react';
import { Icon } from '../icons/Icon.jsx';
import { Loader } from '../brand/Loader.jsx';

const GRIP = 48;

/* Slide to confirm (Bencho "sld", web/src ui.tsx). */
export function SlideToConfirm({ label, doneLabel = 'Done', busyLabel, disabled, onConfirm, className = '' }) {
  const track = useRef(null);
  const [x, setX] = useState(0);
  const [held, setHeld] = useState(false);
  const [spring, setSpring] = useState(false);
  const [phase, setPhase] = useState('idle');
  const start = useRef(0);
  const max = () => Math.max(0, ((track.current && track.current.clientWidth) || 0) - GRIP - 8);
  const complete = async () => {
    setSpring(true); setX(max()); setPhase('busy');
    try { await (onConfirm && onConfirm()); setPhase('done'); } catch (e) { setPhase('idle'); setX(0); }
  };
  const release = () => {
    if (!held) return;
    setHeld(false);
    if (x >= max() * 0.9) void complete(); else { setSpring(true); setX(0); }
  };
  const locked = disabled || phase !== 'idle';
  const progress = Math.min(1, x / (max() || 1));
  return (
    <div ref={track} className={'om-sld ' + className} style={{ opacity: disabled ? 0.45 : undefined }} data-held={held || undefined} data-done={phase === 'done' || undefined}>
      {phase === 'done' ? (
        <div className="om-sld-done"><Icon name="check" size={16} /> {doneLabel}</div>
      ) : (
        <>
          <div className="om-sld-wash" data-spring={spring || undefined} style={{ width: x + GRIP }} />
          <div className="om-sld-say" style={{ opacity: phase === 'busy' ? 1 : 1 - progress * 1.4 }}>
            {phase === 'busy' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--fg-2)' }}><Loader size={14} /> {busyLabel || 'Working'}</span> : label}
          </div>
          <button type="button" className="om-sld-grip" aria-label={label} disabled={locked} data-spring={spring || undefined} style={{ transform: `translate3d(${x}px,0,0)` }}
            onPointerDown={(e) => { if (locked) return; e.currentTarget.setPointerCapture(e.pointerId); start.current = e.clientX - x; setSpring(false); setHeld(true); }}
            onPointerMove={(e) => held && setX(Math.max(0, Math.min(max(), e.clientX - start.current)))}
            onPointerUp={release} onPointerCancel={release}
            onKeyDown={(e) => {
              if (locked) return;
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void complete(); }
              else if (e.key === 'ArrowRight') { e.preventDefault(); setSpring(true); const nx = Math.min(max(), x + max() / 4); setX(nx); if (nx >= max()) void complete(); }
              else if (e.key === 'ArrowLeft' || e.key === 'Escape') { setSpring(true); setX(0); }
            }}>
            {phase === 'busy' ? <Loader size={16} color="currentColor" /> : <Icon name="arrowRight" size={18} strokeWidth={2} />}
          </button>
        </>
      )}
    </div>
  );
}
