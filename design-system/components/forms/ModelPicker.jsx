import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons/Icon.jsx';
import { HarnessLogo } from '../icons/HarnessMark.jsx';
import { Picker } from './Picker.jsx';

/* Model pill (web/src ModelPicker.tsx). Auto first, then models grouped under each harness with a sticky header naming
   the plan, one search across all groups. A harness that is not installed or logged in shows the command that fixes it. */
const AUTO = { harness: 'auto', model: '' };
const isAuto = (v) => v && v.harness === 'auto';

export function ModelPicker({ harnesses = [], value = AUTO, onChange, onOpen, defaultOpen, placeholder = 'Model', offerAuto = true, label, disabled, disabledHelp, queued, up: forceUp }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [up, setUp] = useState(!!forceUp);
  const [q, setQ] = useState('');
  const wrap = useRef(null), btn = useRef(null);
  const auto = isAuto(value);
  const h = harnesses.find((x) => x.id === value.harness);
  const m = h && h.models.find((x) => x.id === value.model);
  const s = q.trim().toLowerCase();
  const groups = useMemo(() => harnesses.map((x) => ({ harness: x, models: s ? x.models.filter((y) => (y.label + ' ' + y.id + ' ' + x.name + ' ' + x.plan).toLowerCase().includes(s)) : x.models })), [harnesses, s]);
  const showAuto = offerAuto && 'auto'.includes(s);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !(wrap.current && wrap.current.contains(e.target)) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const pick = (v) => { onChange && onChange(v); setOpen(false); btn.current && btn.current.focus({ preventScroll: true }); };
  const toggle = () => {
    if (!open) {
      onOpen && onOpen();
      /* Under a thread the pill sits at the bottom of the page: the list opens upward when it has no room below. */
      const r = btn.current && btn.current.getBoundingClientRect();
      setUp(forceUp ?? (!!r && window.innerHeight - r.bottom < 380 && r.top > window.innerHeight - r.bottom));
      setQ('');
    }
    setOpen(!open);
  };
  const disc = (child) => <span style={{ display: 'grid', placeItems: 'center', width: 24, height: 24, flex: 'none', borderRadius: '50%', background: 'var(--bg)', color: 'var(--fg)' }}>{child}</span>;
  const rowDisc = (child) => <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, flex: 'none', borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--fg)' }}>{child}</span>;
  const small = { font: '400 11.5px/1.3 var(--font-sans)', color: 'var(--fg-4)' };
  return (
    <div ref={wrap} className={'om-pik' + (queued ? ' om-queued' : '')} title={disabled ? disabledHelp : undefined}>
      <button ref={btn} type="button" className="om-pik-btn" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={toggle}
        aria-label={auto ? 'Model: Auto' : 'Model: ' + (label || (m && m.label) || 'none') + (h ? ' on ' + h.name : '')}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); } }}>
        {h ? disc(<HarnessLogo harness={h.id} size={13} />) : <span style={{ display: 'grid', placeItems: 'center', width: 24, height: 24, color: 'var(--fg-3)' }}><Icon name="zap" size={14} /></span>}
        <span className="lbl">{label || (auto ? 'Auto' : m ? m.label : placeholder)}</span>
        {h && <span style={{ flex: 'none', color: 'var(--fg-4)' }}>· {h.name}</span>}
        <Icon name="chevronDown" size={13} className="om-pik-chev" />
      </button>
      {open && (
        <div className="om-pik-card" data-up={up || undefined} style={{ left: 0, width: 'min(340px, calc(100vw - 32px))' }} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current && btn.current.focus(); } }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, marginBottom: 4, padding: '0 12px', borderRadius: 16, background: 'var(--surface)', color: 'var(--fg-4)' }}>
            <Icon name="search" size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a model or harness" aria-label="Find a model or harness" style={{ flex: 1, minWidth: 0, height: '100%', border: 0, outline: 'none', background: 'transparent', font: '400 13px var(--font-sans)', color: 'var(--fg)' }} />
          </label>
          <div role="listbox" aria-label="Model" style={{ maxHeight: 320, overflowY: 'auto', outline: 'none' }}>
            {showAuto && (
              <button type="button" role="option" aria-selected={auto} onClick={() => pick(AUTO)} className="om-pik-row">
                {rowDisc(<Icon name="zap" size={13} />)}
                <span className="t"><b>Auto</b><span>Picks a model for each task</span></span>
                <span className="om-pik-mark">{auto && <Icon name="check" size={12} strokeWidth={2.6} />}</span>
              </button>
            )}
            {groups.map(({ harness, models }) => (
              <div key={harness.id}>
                <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px 4px', background: 'var(--elev)' }}>
                  <span className="om-caption" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><HarnessLogo harness={harness.id} size={12} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{harness.name}</span></span>
                  <span style={{ ...small, flex: 'none' }}>{harness.available === false ? 'Unavailable' : /plan$/.test(harness.plan) ? 'Bills your ' + harness.plan : harness.plan}</span>
                </div>
                {harness.available === false ? (
                  <div style={{ ...small, padding: '0 12px 8px' }}>Not available. {harness.fix && harness.fix.split(/\s+/).length <= 3 ? <>Run <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>{harness.fix}</code>.</> : harness.fix}</div>
                ) : models.length ? models.map((y) => {
                  const on = harness.id === value.harness && y.id === value.model;
                  return (
                    <button key={y.id} type="button" role="option" aria-selected={on} onClick={() => pick({ harness: harness.id, model: y.id })} className="om-pik-row">
                      {rowDisc(<HarnessLogo harness={harness.id} size={13} />)}
                      <span className="t"><b>{y.label}{y.default && <span style={{ color: 'var(--fg-4)', fontWeight: 400 }}> (default)</span>}</b>{y.note && <span>{y.note}</span>}</span>
                      <span className="om-pik-mark">{on && <Icon name="check" size={12} strokeWidth={2.6} />}</span>
                    </button>
                  );
                }) : s ? <div style={{ ...small, padding: '0 12px 8px' }}>No match</div> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* The effort pill beside it: "Default" plus the model's levels, or a disabled "Auto effort" when it has none. */
export function EffortPicker({ harnesses = [], choice = AUTO, value = '', onChange, disabled, queued, up }) {
  const h = harnesses.find((x) => x.id === choice.harness);
  const m = h && (h.models.find((x) => x.id === choice.model) || (!choice.model && (h.models.find((x) => x.default) || h.models[0])));
  const efforts = (m && m.efforts) || [];
  if (!efforts.length) return <Picker label="Effort" value="" options={[{ value: '', label: 'Auto effort', avatar: false, icon: 'sliders' }]} disabled />;
  const options = [{ value: '', label: m.defaultEffort ? 'Default (' + m.defaultEffort + ')' : 'Default', avatar: false, icon: 'sliders' }].concat(efforts.map((e) => ({ value: e, label: e, avatar: false, icon: 'sliders' })));
  const pill = <Picker label="Effort" value={value} options={options} onChange={onChange} disabled={disabled} up={up} />;
  return queued ? <span className="om-queued" style={{ display: 'contents' }}>{pill}</span> : pill;
}

/* Ahead of queued pills in a thread's composer: a switch picked during a turn waits for it to end. Clicking keeps the
   run the thread is on (`now`, e.g. "Sonnet 5.5, high"). */
export function NextTurnChip({ now, onKeep, disabled }) {
  return (
    <button type="button" className="om-next-turn" onClick={onKeep} disabled={disabled}
      title={'Runs on ' + now + ' until this turn ends. Click to keep it.'} aria-label={'Keep ' + now + ' for the next turn'}>
      <Icon name="clock" size={13} />Next turn<Icon name="x" size={12} className="x" />
    </button>
  );
}
