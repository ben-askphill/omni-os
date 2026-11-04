import React, { useRef, useState } from 'react';
import { StatusGlyph } from '../core/Status.jsx';
import { Icon } from '../icons/Icon.jsx';
import { Thumb, useSlidingThumb } from '../forms/Segmented.jsx';

const kindIcon = (k) => (k === 'artifact' ? 'file' : k === 'panel' ? 'panel' : 'message');
const live = (s) => s && s !== 'idle' && s !== 'settled';

/* Open threads and artifacts. Recent ones are pill tabs on a sliding thumb; the rest collapse into leaves that fan open. */
export function TabStack({ tabs = [], activeId, visible = 3, onSelect, onClose, children }) {
  const [open, setOpen] = useState(false);
  const track = useRef(null);
  const shown = tabs.slice(0, visible);
  const rest = tabs.slice(visible);
  const box = useSlidingThumb(track, activeId, false, '[data-active="true"]');
  return (
    <div className="om-tabs" role="tablist">
      <div ref={track} className="om-tabs__track">
        <Thumb box={box} tone="soft" />
        {shown.map((t) => (
          <button key={t.id} type="button" role="tab" className="om-tab" data-active={t.id === activeId || undefined} aria-selected={t.id === activeId} onClick={() => onSelect && onSelect(t.id)} title={t.title}>
            {live(t.state) ? <StatusGlyph state={t.state} size={7} /> : <Icon name={kindIcon(t.kind)} size={14} style={{ color: 'var(--fg-4)' }} />}
            <span className="om-tab__title">{t.title}</span>
            {onClose && t.id === activeId && <span role="button" aria-label="Close tab" className="om-tab__x" onClick={(e) => { e.stopPropagation(); onClose(t.id); }}><Icon name="x" size={11} /></span>}
          </button>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="om-stack" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} aria-label={rest.length + ' more tabs'}>
          <span className="om-stack__leaves">{rest.map((t) => <i key={t.id} className={'om-stack__leaf' + (live(t.state) ? ' om-stack__leaf--' + t.state : '')} />)}</span>
          <span className="om-stack__count">+{rest.length}</span>
          {open && (
            <div className="om-stack__menu" role="menu">
              {rest.map((t) => (
                <button key={t.id} type="button" role="menuitem" className="om-stack__row" onClick={() => { setOpen(false); onSelect && onSelect(t.id); }}>
                  <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-2)' }}>{live(t.state) ? <StatusGlyph state={t.state} /> : <Icon name={kindIcon(t.kind)} size={14} style={{ color: 'var(--fg-3)' }} />}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  <span className="om-tid" style={{ color: 'var(--fg-4)' }}>{t.taskId || t.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{ flex: 1 }} />
      {children && <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>{children}</div>}
    </div>
  );
}
