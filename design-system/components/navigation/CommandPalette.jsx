import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Monogram } from '../core/Monogram.jsx';
import { StatusGlyph } from '../core/Status.jsx';
import { Kbd } from '../core/Kbd.jsx';
import { Icon } from '../icons/Icon.jsx';
import { HarnessMark } from '../icons/HarnessMark.jsx';
import { Thumb, useSlidingThumb } from '../forms/Segmented.jsx';

function hl(text, q) {
  const w = q.trim().split(/\s+/).filter(Boolean)[0];
  if (!w) return text;
  const i = text.toLowerCase().indexOf(w.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + w.length)}</mark>{text.slice(i + w.length)}</>;
}

/* ⌘K (web/src CommandPalette.tsx): 28px-radius card, 64px input, 48px rows on a sliding wash thumb. */
export function CommandPalette({ items = [], onSelect, onClose, initialQuery = '', modal = true, placeholder = 'Search or jump to' }) {
  const [q, setQ] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);
  const input = useRef(null), listRef = useRef(null);
  useEffect(() => { requestAnimationFrame(() => input.current && input.current.focus({ preventScroll: true })); }, []);
  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let l = items.filter((i) => !words.length || words.every((w) => (i.label + ' ' + (i.sub || '') + ' ' + (i.taskId || '')).toLowerCase().includes(w)));
    if (!words.length) { let n = 0; l = l.filter((i) => i.group !== 'Recent threads' || n++ < 6); }
    if (q.trim()) l = [{ id: 'search', group: 'Search', kind: 'command', icon: 'search', label: `Search threads for “${q.trim()}”`, sub: 'Titles, prompts, replies and tool output' }, ...l];
    return l;
  }, [items, q]);
  useEffect(() => setCursor(0), [q]);
  const safe = Math.min(cursor, Math.max(0, list.length - 1));
  const box = useSlidingThumb(listRef, safe + ':' + list.length, true, '[data-active="true"]');
  useEffect(() => { const el = listRef.current && listRef.current.querySelector('[data-active="true"]'); if (el && listRef.current) { const p = listRef.current; if (el.offsetTop < p.scrollTop) p.scrollTop = el.offsetTop - 8; else if (el.offsetTop + el.offsetHeight > p.scrollTop + p.clientHeight) p.scrollTop = el.offsetTop + el.offsetHeight - p.clientHeight + 8; } }, [safe]);
  const run = (i) => { if (i && onSelect) onSelect(i); };
  const groups = [];
  list.forEach((item, index) => { const g = groups[groups.length - 1]; if (g && g.name === item.group) g.items.push({ item, index }); else groups.push({ name: item.group, items: [{ item, index }] }); });
  const lead = (it) => {
    if (it.kind === 'channel') return <Monogram name={it.label.replace('#', '')} icon={it.icon} size={28} />;
    if (it.kind === 'thread' || it.kind === 'task') return <span className="om-palette__lead om-palette__lead--bare"><StatusGlyph state={it.state || 'settled'} /></span>;
    return <span className="om-palette__lead"><Icon name={it.icon || 'arrowRight'} size={14} /></span>;
  };
  const box2 = (
    <div className="om-palette" role="dialog" aria-modal="true" aria-label="Command menu" onMouseDown={(e) => e.stopPropagation()}>
      <div className="om-palette__input">
        <Icon name="search" size={18} style={{ color: 'var(--fg-4)' }} />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(list.length - 1, c + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); run(list[safe]); }
            else if (e.key === 'Escape') onClose && onClose();
          }} />
        <Kbd>Esc</Kbd>
      </div>
      <div ref={listRef} className="om-palette__list" role="listbox">
        <Thumb box={box} tone="wash" style={{ borderRadius: 16 }} />
        {groups.map((g) => (
          <div key={g.name} className="om-palette__group" role="group" aria-label={g.name}>
            <span className="om-caption">{g.name}</span>
            {g.items.map(({ item, index }) => (
              <div key={item.id} role="option" aria-selected={index === safe} data-active={index === safe} className="om-palette__row" onMouseMove={() => index !== safe && setCursor(index)} onClick={() => run(item)}>
                {lead(item)}
                <span className="om-palette__label"><b>{hl(item.label, q)}</b>{item.sub && <span>{item.sub}</span>}</span>
                <span className="om-palette__meta">
                  {item.meta && <span style={item.metaLive ? { color: 'var(--live-text)' } : null}>{item.meta}</span>}
                  {item.harness && <HarnessMark harness={item.harness} />}
                  {item.taskId && <span className="om-tid">{hl(item.taskId, q)}</span>}
                  {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                </span>
                {index === safe && <Icon name="arrowRight" size={14} style={{ color: 'var(--fg-3)' }} />}
              </div>
            ))}
          </div>
        ))}
        {!list.length && <div className="om-palette__empty">Nothing matches</div>}
      </div>
      <div className="om-palette__foot"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> open</span><span><Kbd>T-</Kbd> task ids</span></div>
    </div>
  );
  if (!modal) return box2;
  return <div className="om-palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>{box2}</div>;
}
