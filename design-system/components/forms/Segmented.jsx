import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons/Icon.jsx';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Bencho sliding thumb (web/src ui.tsx): stretch to cover old + new along the travel axis, then settle. */
export function useSlidingThumb(track, activeKey, vertical = false, selector = ':scope > [data-active="true"], :scope > * > [data-active="true"]') {
  const [box, setBox] = useState(null);
  const last = useRef(null);
  const measure = useCallback(() => {
    const el = track.current && track.current.querySelector(selector);
    if (!el) return null;
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }, [track, selector]);
  useLayoutEffect(() => {
    const next = measure();
    const prev = last.current;
    last.current = next;
    if (!next) return setBox(null);
    if (!prev || reducedMotion()) return setBox({ ...next, phase: 'idle' });
    if (prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) return;
    const x = vertical ? next.x : Math.min(prev.x, next.x);
    const y = vertical ? Math.min(prev.y, next.y) : next.y;
    const w = vertical ? next.w : Math.max(prev.x + prev.w, next.x + next.w) - x;
    const h = vertical ? Math.max(prev.y + prev.h, next.y + next.h) - y : next.h;
    setBox({ x, y, w, h, phase: 'stretch' });
    const t = setTimeout(() => setBox({ ...next, phase: 'settle' }), 150);
    return () => clearTimeout(t);
  }, [activeKey, measure, vertical]);
  useEffect(() => {
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const n = measure(); last.current = n; setBox(n ? { ...n, phase: 'idle' } : null); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [track, measure]);
  return box;
}

export function Thumb({ box, tone, className = '', style }) {
  if (!box) return null;
  return <span aria-hidden="true" className={'om-thumb ' + className} data-phase={box.phase} data-tone={tone} style={{ width: box.w, height: box.h, transform: `translate3d(${box.x}px, ${box.y}px, 0)`, ...style }} />;
}

/* kind: 'choice' (default) is a radio group, 'tabs' a tablist (panel: the tabpanel's id), 'nav' page links with
   aria-current. choice and tabs are one Tab stop: arrows, Home and End move and pick (tabs with manual only move). */
export function Segmented({ options = [], value, onChange, size = 'md', label, kind = 'choice', panel, manual, bare, tone, vertical, className = '' }) {
  const ref = useRef(null);
  const box = useSlidingThumb(ref, value, !!vertical);
  const iconsOnly = options.every((o) => !o.label);
  const roving = kind !== 'nav';
  const onKeyDown = (e) => {
    const items = [...ref.current.querySelectorAll('.om-seg-item:not(:disabled)')];
    const at = items.indexOf(e.target);
    if (!roving || at < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const fwd = e.key === 'ArrowRight' || ((vertical || kind === 'choice') && e.key === 'ArrowDown');
    const back = e.key === 'ArrowLeft' || ((vertical || kind === 'choice') && e.key === 'ArrowUp');
    const next = fwd ? at + 1 : back ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const el = items[(next + items.length) % items.length];
    el.focus();
    if (!(kind === 'tabs' && manual)) el.click();
  };
  const Tag = kind === 'nav' ? 'nav' : 'div';
  return (
    <Tag ref={ref} onKeyDown={onKeyDown} role={kind === 'tabs' ? 'tablist' : kind === 'choice' ? 'radiogroup' : undefined} aria-label={label} data-size={size} data-bare={bare || undefined} data-icons={iconsOnly || undefined} data-orientation={vertical ? 'vertical' : undefined} className={'om-seg ' + className}>
      <Thumb box={box} tone={tone} />
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button key={o.id} type="button" id={kind === 'tabs' && panel ? `${panel}-tab-${o.id}` : undefined} tabIndex={roving ? (active ? 0 : -1) : undefined} role={kind === 'tabs' ? 'tab' : kind === 'choice' ? 'radio' : undefined} aria-selected={kind === 'tabs' ? active : undefined} aria-checked={kind === 'choice' ? active : undefined} aria-current={kind === 'nav' && active ? 'page' : undefined} aria-label={o.label ? undefined : o.title} title={o.title} data-active={active} className="om-seg-item" onClick={() => onChange && onChange(o.id)}>
            {o.icon && <Icon name={o.icon} size={size === 'sm' ? 13 : 14} />}
            {o.label}
            {o.count != null && <span className="om-count">{o.count}</span>}
          </button>
        );
      })}
    </Tag>
  );
}
