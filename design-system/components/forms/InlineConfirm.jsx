import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons/Icon.jsx';
import { Loader } from '../brand/Loader.jsx';

/* Inline confirm with undo fuse (Bencho "say", web/src ui.tsx). The pill asks in place and springs between widths. */
export function InlineConfirm({ label, icon, confirmLabel, cancelLabel = 'Cancel', doneLabel, busyLabel, undoMs, needs = true, disabled, onConfirm, className = '', height }) {
  const [phase, setPhase] = useState('idle');
  const [width, setWidth] = useState(undefined);
  const shell = useRef(null), row = useRef(null), cancelRef = useRef(null);
  const run = useRef(onConfirm); run.current = onConfirm;
  const pending = useRef(false);
  const fire = useCallback(async () => {
    pending.current = false;
    setPhase('busy');
    try { await (run.current && run.current()); setPhase(doneLabel ? 'done' : 'idle'); } catch (e) { setPhase('idle'); }
  }, [doneLabel]);
  useLayoutEffect(() => {
    const el = row.current; if (!el) return;
    const set = () => setWidth(el.scrollWidth); set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set); ro.observe(el); return () => ro.disconnect();
  }, [phase]);
  useEffect(() => {
    if (phase !== 'asking') return;
    cancelRef.current && cancelRef.current.focus({ preventScroll: true });
    const onDown = (e) => !(shell.current && shell.current.contains(e.target)) && setPhase('idle');
    const onKey = (e) => e.key === 'Escape' && setPhase('idle');
    document.addEventListener('mousedown', onDown); window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [phase]);
  useEffect(() => {
    if (phase !== 'pending' || !undoMs) return;
    pending.current = true;
    const t = setTimeout(() => void fire(), undoMs);
    return () => clearTimeout(t);
  }, [phase, undoMs, fire]);
  useEffect(() => () => { if (pending.current && run.current) run.current(); }, []);
  const confirm = () => (undoMs ? setPhase('pending') : void fire());
  let content;
  if (phase === 'asking') {
    content = <><button ref={cancelRef} type="button" className="om-say-btn" onClick={() => setPhase('idle')}>{cancelLabel}</button><span className="om-say-seam" /><button type="button" className="om-say-btn" data-needs={needs || undefined} onClick={confirm}>{confirmLabel}</button></>;
  } else if (phase === 'busy') {
    content = <span className="om-say-done"><Loader size={13} /> {busyLabel || confirmLabel + '…'}</span>;
  } else if (phase === 'pending' || phase === 'done') {
    content = (
      <>
        <span className="om-say-done"><Icon name="check" size={14} /> {doneLabel || 'Done'}</span>
        {phase === 'pending' && (
          <button type="button" className="om-say-undo" onClick={() => { pending.current = false; setPhase('idle'); }}>
            <Icon name="undo" size={13} /> Undo<span className="om-say-fuse" style={{ animationDuration: undoMs + 'ms' }} />
          </button>
        )}
      </>
    );
  } else {
    content = <button type="button" className="om-say-btn" disabled={disabled} onClick={() => setPhase('asking')}>{icon && <Icon name={icon} size={14} />}{label}</button>;
  }
  return (
    <div ref={shell} className={'om-say ' + className} style={{ width, opacity: disabled ? 0.45 : undefined, '--say-h': height ? height + 'px' : undefined }} aria-live="polite">
      <div ref={row} className="om-say-row">{content}</div>
    </div>
  );
}
