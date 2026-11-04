import React, { Fragment, useRef, useState } from 'react';
import { StatusGlyph } from '../core/Status.jsx';
import { Kbd } from '../core/Kbd.jsx';
import { Icon } from '../icons/Icon.jsx';
import { OmniMark } from '../brand/OmniMark.jsx';
import { OmniLogo } from '../brand/OmniLogo.jsx';
import { Segmented, Thumb, useSlidingThumb } from '../forms/Segmented.jsx';
import { Ticks } from '../forms/CheckItem.jsx';
import { HarnessLogo, harnessFor } from '../icons/HarnessMark.jsx';

const GROUPS = [['client', 'Clients'], ['internal', 'Internal'], ['personal', 'Personal']];

function RunningBadge({ n }) {
  if (!n) return null;
  return <span className="om-badge" title={n + ' running'}><StatusGlyph state="running" size={6} />{n}</span>;
}
function NeedsBadge({ n }) {
  if (!n) return null;
  return <span className="om-badge om-badge--needs" title={n + ' need you'}><StatusGlyph state="needs" size={7} />{n}</span>;
}
const Side = ({ c }) => <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><NeedsBadge n={c.needs} /><RunningBadge n={c.running} /></span>;

function UsageCard({ usage = [], footer }) {
  const cell = (v) => {
    if (v == null) return <span className="om-usagecard__cell" style={{ justifyContent: 'center', font: '400 10px var(--font-num)', color: 'var(--fg-4)' }}>—</span>;
    const tone = v >= 0.9 ? 'needs' : undefined;
    return <span className="om-usagecard__cell"><Ticks value={v} count={10} height={10} tone={tone} style={{ flex: 1 }} /><b>{Math.round(v * 100)}%</b></span>;
  };
  return (
    <div className="om-usagecard">
      <div className="om-usagecard__hd"><span style={{ width: 66, flex: 'none' }} /><span style={{ flex: 1 }}>5h</span><span style={{ flex: 1 }}>Week</span></div>
      {usage.map((u) => (
        <div key={u.name} className="om-usagecard__row"><span className="om-caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: 66 }}>{harnessFor(u.harness || u.name) && <span style={{ color: 'var(--fg)' }}><HarnessLogo harness={harnessFor(u.harness || u.name)} size={12} /></span>}{u.name}</span>{cell(u.five)}{cell(u.week)}</div>
      ))}
      {footer && <div className="om-usagecard__ft"><StatusGlyph state="done" size={6} />{footer}</div>}
    </div>
  );
}

/*
 * A thread section above the channels (Sidebar.tsx ThreadSection + SectionLink): Running, Pinned or Recent threads. A
 * caption with a chevron folds the rows away and shows the count while folded. A row is flush with the channels: status,
 * title, its channel's name in fg-4. It never wears the thumb (that stays on the thread's row under its channel); the open
 * one reads medium. In Pinned the channel's name gives way on hover to a pin that unpins. The caller leaves a section out
 * when it lists nothing.
 */
function RailSection({ s, activeId, onSelect }) {
  const [closed, setClosed] = useState(!!s.collapsed);
  const threads = s.threads || [];
  return (
    <div className="om-side__group">
      <button type="button" className="om-caption" aria-expanded={!closed} onClick={() => setClosed(!closed)}
        style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>
        {s.label}
        <Icon name={closed ? 'chevronRight' : 'chevronDown'} size={11} style={{ color: 'var(--fg-4)' }} />
        {closed && <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{threads.length}</span>}
      </button>
      {!closed && threads.map((t) => (
        <button key={t.id} type="button" className="om-nav" onClick={() => onSelect && onSelect(t.id)} title={t.title + (t.channel ? ' · ' + t.channel : '')}
          style={activeId === t.id ? { fontWeight: 500, color: 'var(--fg)' } : undefined}>
          <span className="lead"><StatusGlyph state={t.state || 'done'} size={7} /></span>
          <span className="name">{t.title}</span>
          {t.channel && <span className="om-badge" style={{ color: 'var(--fg-4)', fontWeight: 400 }}>{t.channel}</span>}
        </button>
      ))}
    </div>
  );
}

/* Sidebar (web/src Sidebar.tsx): white canvas, pill nav rows with a sliding thumb, Running / Pinned / Recent threads sections, running threads nested under channels. */
export function Rail({ channels = [], activeId, onSelect, conductor = { state: 'idle' }, onJump, onNew, extra = [], sections = [], usage, usageFooter, theme, onTheme, maxThreads = 5 }) {
  const listRef = useRef(null);
  const rowsKey = channels.map((c) => (c.threads || []).map((t) => t.id).join('.')).join('|') + sections.map((s) => (s.threads || []).length).join('.');
  const box = useSlidingThumb(listRef, activeId + ':' + rowsKey, true, '[data-active="true"]');
  const sel = (id) => () => onSelect && onSelect(id);
  const thread = (t) => (
    <button key={t.id} type="button" className="om-nav om-nav--sub" data-active={activeId === t.id || undefined} onClick={sel(t.id)} title={t.title}>
      <span className="lead">{t.state === 'running' ? <StatusGlyph state="running" size={7} /> : <StatusGlyph state={t.state} size={7} />}</span>
      <span className="name">{t.title}</span>
    </button>
  );
  const threads = (c) => {
    const list = c.threads || [];
    const shown = list.filter((t, i) => i < maxThreads || t.id === activeId);
    return <>{shown.map(thread)}{list.length > shown.length && <button type="button" className="om-nav om-nav--sub om-nav--more" onClick={sel(c.id)}>{list.length - shown.length} more</button>}</>;
  };
  const channel = (c) => (
    <Fragment key={c.id}>
      <button type="button" className="om-nav" data-active={activeId === c.id || undefined} onClick={sel(c.id)} title={c.name}>
        <span className="lead hash">#</span>
        <span className="name">{c.name}</span>
        <Side c={c} />
      </button>
      {threads(c)}
    </Fragment>
  );
  const cond = channels.find((c) => c.id === 'conductor');
  const rest = channels.filter((c) => c.id !== 'conductor');
  return (
    <nav className="om-side scheme-dark" aria-label="Main">
      <div className="om-side__head"><OmniLogo height={20} /></div>
      <div className="om-side__top">
        <button type="button" className="om-side__search" onClick={onJump}><Icon name="search" size={15} /><span>Search or jump to</span><Kbd>⌘K</Kbd></button>
        <button type="button" className="om-side__new" onClick={onNew}><Icon name="plus" size={15} strokeWidth={2} /> New thread</button>
      </div>
      <div className="om-side__scroll">
        <div ref={listRef} className="om-side__list">
          <Thumb box={box} tone="soft" />
          <div className="om-side__group">
            <button type="button" className="om-nav" data-active={activeId === 'home' || undefined} onClick={sel('home')}><span className="lead"><Icon name="home" size={15} /></span><span className="name">Home</span></button>
            <button type="button" className="om-nav" data-active={activeId === 'conductor' || undefined} onClick={sel('conductor')}>
              <span className="lead"><OmniMark size={17} state={conductor.state} interactive={false} droplets={conductor.droplets || 3} /></span>
              <span className="name">Conductor</span>
              <Side c={{ needs: conductor.needs, running: conductor.running }} />
            </button>
            {cond && threads(cond)}
            {extra.map((x) => (
              <button key={x.id} type="button" className="om-nav" data-active={activeId === x.id || undefined} onClick={sel(x.id)}><span className="lead"><Icon name={x.icon} size={15} /></span><span className="name">{x.name}</span>{x.meta && <span className="om-badge" style={{ color: 'var(--fg-4)' }}>{x.meta}</span>}</button>
            ))}
          </div>
          {sections.filter((s) => (s.threads || []).length).map((s) => <RailSection key={s.id || s.label} s={s} activeId={activeId} onSelect={onSelect} />)}
          {GROUPS.map(([k, label]) => {
            const list = rest.filter((c) => (c.kind || 'client') === k);
            if (!list.length) return null;
            return <div key={k} className="om-side__group"><div className="om-caption">{label}</div>{list.map(channel)}</div>;
          })}
        </div>
      </div>
      {(usage || onTheme) && (
        <div className="om-side__foot">
          {usage && <UsageCard usage={usage} footer={usageFooter} />}
          {onTheme && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 8 }}>
              <span className="om-caption">Theme</span>
              <Segmented radio size="sm" label="Theme" value={theme || 'light'} onChange={onTheme} options={[{ id: 'light', icon: 'sun', title: 'Light' }, { id: 'system', icon: 'monitor', title: 'Match system' }, { id: 'dark', icon: 'moon', title: 'Dark' }]} />
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
