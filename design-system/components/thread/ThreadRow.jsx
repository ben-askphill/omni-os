import React from 'react';
import { StatusGlyph } from '../core/Status.jsx';
import { Chip, Monogram } from '../core/Monogram.jsx';
import { HarnessMark } from '../icons/HarnessMark.jsx';
import { Icon } from '../icons/Icon.jsx';
import { Loader } from '../brand/Loader.jsx';

/* A thread Ben marked done (web DoneMark in ui/status.tsx, Mac StatusDot done): a grey check in place of the dot. */
function DoneMark({ size = 13 }) {
  return <span title="Marked done" style={{ display: 'grid', placeItems: 'center', color: 'var(--fg-4)' }}><Icon name="check" size={size} strokeWidth={2.2} /></span>;
}

/* ThreadRow (web/src ThreadList.tsx): 32px round lead, 14px title, chips, time; second line branch pill + preview. */
export function ThreadRow({ title, taskId, state = 'settled', harness, crew, role, source, time, meta, branch, preview, channel, markedDone = false, selected = false, onClick }) {
  const hot = !markedDone && (state === 'running' || state === 'needs' || state === 'done');
  const r = role || crew;
  const b = branch || meta;
  const text = preview ?? (state === 'running' ? 'Working' : state === 'queued' ? 'Waiting for a slot' : '');
  const lead = markedDone ? <DoneMark size={channel ? 12 : 13} /> : <StatusGlyph state={state} />;
  return (
    <button type="button" className={'om-trow' + (hot ? '' : ' om-trow--quiet')} data-on={selected || undefined} onClick={onClick}>
      {channel ? (
        <span style={{ position: 'relative', flex: 'none', marginTop: 2 }}>
          <Monogram name={channel} size={32} />
          <span style={{ position: 'absolute', right: -2, bottom: -2, display: 'grid', placeItems: 'center', width: 14, height: 14, borderRadius: '50%', background: 'var(--bg)' }}>{lead}</span>
        </span>
      ) : (
        <span className="om-trow__lead">{lead}</span>
      )}
      <span className="om-trow__main">
        <span className="om-trow__top">
          <span className="om-trow__title" style={markedDone ? { color: 'var(--fg-4)' } : undefined}>{title || 'Untitled'}</span>
          {markedDone && <Chip tone="outline">Done</Chip>}
          {!markedDone && state === 'needs' && <Chip tone="needs">Needs you</Chip>}
          {!markedDone && state === 'done' && <Chip tone="done">Done</Chip>}
          {r && <Chip>{r}</Chip>}
          {source && <Chip tone="outline">{source}</Chip>}
          <span className="om-trow__time">{time}</span>
        </span>
        {(text || b || taskId || harness || channel) && (
          <span className="om-trow__sub">
            {channel && <span style={{ flex: 'none', color: 'var(--fg-2)' }}>#{channel}</span>}
            {harness && <HarnessMark harness={harness} />}
            {b && <span className="om-trow__branch">{b}</span>}
            {state === 'running' && !preview && <Loader size={11} />}
            <span className="om-trow__preview">{text}</span>
            {taskId && <span className="om-tid" style={{ marginLeft: 'auto', paddingLeft: 8, color: 'var(--fg-4)' }}>{taskId}</span>}
          </span>
        )}
      </span>
    </button>
  );
}

/* Day groups with sticky mono-caps headers and the Bencho staggered rise. */
export function ThreadGroup({ label, count, children }) {
  const kids = React.Children.toArray(children);
  return (
    <section className="om-tgroup">
      <h3 className="om-caption" style={{ margin: 0 }}>{label}{count != null && <b>{count}</b>}</h3>
      <div className="om-rise">{kids.map((k, i) => <div key={i} style={{ '--i': Math.min(i, 12) }}>{k}</div>)}</div>
    </section>
  );
}
