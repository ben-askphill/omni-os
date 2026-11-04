import React, { useEffect, useRef, useState } from 'react';
import { IconButton } from '../core/IconButton.jsx';
import { Icon } from '../icons/Icon.jsx';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const readStored = (key) => { try { const v = key && parseFloat(localStorage.getItem(key)); return Number.isFinite(v) ? v : null; } catch (e) { return null; } };

/* Side panel beside a thread: white column, display-face header, sections as 20px-radius surface trays.
   Drag the left edge to resize (double-click resets); arrow keys nudge it when the edge has focus. */
export function Panel({ title, meta, icon, onClose, actions, children, width, resizable = true, minWidth = 280, maxWidth = 720, defaultWidth = 360, storageKey = 'omni.panel.width', onResize }) {
  const [w, setW] = useState(() => (typeof width === 'number' ? width : readStored(storageKey) ?? defaultWidth));
  const [drag, setDrag] = useState(false);
  const [entered, setEntered] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (typeof width === 'number') setW(width); }, [width]);
  useEffect(() => {
    const fit = () => setW((cur) => { const m = maxFor(); return cur > m ? Math.round(m) : cur; });
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [minWidth, maxWidth]);
  /* Never let the panel squeeze the thread column below 420px: clamp against the row it sits in, not the window. */
  const maxFor = () => {
    const row = ref.current && ref.current.parentElement;
    const avail = row ? row.getBoundingClientRect().width : window.innerWidth;
    return Math.max(minWidth, Math.min(maxWidth, avail - 420));
  };
  const commit = (nw) => {
    const v = Math.round(clamp(nw, minWidth, maxFor()));
    setW(v);
    onResize && onResize(v);
    try { storageKey && localStorage.setItem(storageKey, String(v)); } catch (e) {}
  };
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, w0 = ref.current ? ref.current.getBoundingClientRect().width : w;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(true);
    const move = (ev) => commit(w0 + (x0 - ev.clientX));
    const up = () => { setDrag(false); e.target.removeEventListener('pointermove', move); e.target.removeEventListener('pointerup', up); e.target.removeEventListener('pointercancel', up); };
    e.target.addEventListener('pointermove', move);
    e.target.addEventListener('pointerup', up);
    e.target.addEventListener('pointercancel', up);
  };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') { e.preventDefault(); commit(w + step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); commit(w - step); }
    else if (e.key === 'Home') { e.preventDefault(); commit(maxWidth); }
    else if (e.key === 'End') { e.preventDefault(); commit(minWidth); }
  };
  return (
    <aside ref={ref} className="om-panel" style={{ width: w }} aria-label={title} data-resizing={drag || undefined} data-entered={entered || undefined} onAnimationEnd={(e) => { if (e.target === e.currentTarget) setEntered(true); }}>
      {resizable && (
        <div className="om-panel__grip" role="separator" aria-orientation="vertical" aria-label="Resize panel" aria-valuemin={minWidth} aria-valuemax={Math.round(ref.current ? maxFor() : maxWidth)} aria-valuenow={w} tabIndex={0}
          onPointerDown={onPointerDown} onDoubleClick={() => commit(defaultWidth)} onKeyDown={onKeyDown} />
      )}
      <div className="om-panel__head">
        {icon && <Icon name={icon} size={15} style={{ color: 'var(--fg-3)' }} />}
        <span className="om-panel__title">{title}</span>
        {meta && <span className="om-panel__meta">{meta}</span>}
        {actions}
        {onClose && <IconButton label="Close panel" icon="x" iconSize={15} onClick={onClose} />}
      </div>
      <div className="om-panel__body">{children}</div>
    </aside>
  );
}

export function PanelSection({ label, meta, children }) {
  return (
    <section className="om-panel__sec">
      {label && <h3 className="om-panel__label"><span className="om-caption">{label}</span>{meta && <b>{meta}</b>}</h3>}
      {children}
    </section>
  );
}
