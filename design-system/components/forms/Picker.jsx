import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons/Icon.jsx';
import { Monogram } from '../core/Monogram.jsx';

/* Dropdown picker (Bencho "pik", web/src ui.tsx). */
export function Picker({ value, options = [], onChange, label, prefix, lead, searchable, disabled, align = 'left', up: forceUp, className = '' }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [q, setQ] = useState('');
  const wrap = useRef(null), btn = useRef(null), list = useRef(null);
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? options.filter((o) => (o.label + ' ' + (o.sub || '')).toLowerCase().includes(s)) : options; }, [options, q]);
  const canSearch = searchable ?? options.length > 7;
  const openMenu = () => {
    if (disabled) return;
    const r = btn.current && btn.current.getBoundingClientRect();
    const need = Math.min(options.length * 44 + (canSearch ? 52 : 0) + 16, 340);
    setUp(forceUp ?? (!!r && window.innerHeight - r.bottom < need && r.top > window.innerHeight - r.bottom));
    setQ(''); setCursor(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true);
  };
  const close = (refocus = true) => { setOpen(false); if (refocus && btn.current) btn.current.focus({ preventScroll: true }); };
  const pick = (o) => { onChange && onChange(o.value); close(); };
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !(wrap.current && wrap.current.contains(e.target)) && close(false);
    document.addEventListener('mousedown', onDown);
    if (!canSearch && list.current) list.current.focus({ preventScroll: true });
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, canSearch]);
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(shown.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[cursor]) pick(shown[cursor]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  };
  const avatar = (o, px) => o.lead ? o.lead : o.avatar === false ? (o.icon ? <span style={{ display: 'grid', placeItems: 'center', width: px, height: px, color: 'var(--fg-3)' }}><Icon name={o.icon} size={14} /></span> : null) : <Monogram name={o.avatar || o.label} code={o.code} icon={o.icon} size={px} />;
  return (
    <div ref={wrap} className={'om-pik ' + className}>
      <button ref={btn} type="button" className="om-pik-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label + ': ' + (current ? current.label : 'none')} disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openMenu(); } }}>
        {lead || (current ? avatar(current, 24) : <span style={{ width: 6 }} />) || <span style={{ width: 6 }} />}
        {prefix && <span style={{ marginRight: -4, color: 'var(--fg-4)' }}>{prefix}</span>}
        <span className="lbl">{current ? current.label : 'Choose'}</span>
        <Icon name="chevronDown" size={13} className="om-pik-chev" />
      </button>
      {open && (
        <div className="om-pik-card" data-up={up || undefined} style={align === 'right' ? { right: 0 } : { left: 0 }} onKeyDown={onKey}>
          {canSearch && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, marginBottom: 4, padding: '0 12px', borderRadius: 16, background: 'var(--surface)', color: 'var(--fg-4)' }}>
              <Icon name="search" size={14} />
              <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} placeholder={'Find ' + String(label).toLowerCase()} aria-label={'Find ' + label} style={{ flex: 1, minWidth: 0, height: '100%', border: 0, outline: 'none', background: 'transparent', font: '400 13px var(--font-sans)', color: 'var(--fg)' }} />
            </label>
          )}
          <div ref={list} role="listbox" aria-label={label} tabIndex={-1} style={{ maxHeight: 280, overflowY: 'auto', outline: 'none' }}>
            {shown.map((o, i) => (
              <button key={o.value} type="button" role="option" aria-selected={o.value === value} data-cursor={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => pick(o)} className="om-pik-row">
                {avatar(o, 28)}
                <span className="t"><b>{o.label}</b>{o.sub && <span>{o.sub}</span>}</span>
                <span className="om-pik-mark">{o.value === value && <Icon name="check" size={12} strokeWidth={2.6} />}</span>
              </button>
            ))}
            {!shown.length && <div style={{ padding: 12, font: '400 12.5px var(--font-sans)', color: 'var(--fg-4)' }}>No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}
