import React from 'react';
import { StatusGlyph } from '../core/Status.jsx';
import { CrewMark } from '../icons/CrewMark.jsx';
import { Icon } from '../icons/Icon.jsx';

/* Crew mark in a surface-2 disc with the status glyph on its corner. */
export function MoAvatar({ role = 'conductor', state, size = 36 }) {
  return (
    <span className="om-mo-avatar" style={{ width: size, height: size }}>
      <CrewMark role={role} size={Math.round(size * 0.46)} />
      {state && <span className="om-mo-avatar__status"><StatusGlyph state={state} size={8} /></span>}
    </span>
  );
}

export function MoDiff({ add, del }) {
  return <span className="om-mo-diff"><span className="add">+{add}</span> <span className="del">−{del}</span></span>;
}

/* One row wherever a thread is listed on the phone. Running progress reads in live text; needs-you titles are medium;
   finished titles drop to fg-2. Diff or artifact count on the right. */
export function MoThreadRow({ title, state = 'settled', role, channel, progress, meta, time, diff, artifacts, last = false, onPress }) {
  const settled = state === 'done' || state === 'settled';
  const cls = 'om-mo-trow' + (state === 'needs' ? ' om-mo-trow--needs' : '') + (settled ? ' om-mo-trow--settled' : '') + (last ? ' om-mo-trow--last' : '');
  const lead = [channel && '#' + channel, state === 'needs' ? 'Needs you' : null, meta].filter(Boolean).join(' · ');
  return (
    <button type="button" className={cls} onClick={onPress}>
      <MoAvatar role={role} state={state} />
      <span className="om-mo-trow__main">
        <span className="om-mo-trow__top">
          <span className="om-mo-trow__title om-mo-ellipsis">{title}</span>
          {time && <span className="om-mo-trow__time">{time}</span>}
        </span>
        <span className="om-mo-trow__sub">
          <span className="om-mo-trow__meta om-mo-ellipsis">
            {lead}
            {state === 'running' && progress && <>{lead ? ' · ' : ''}<span className="om-mo-trow__progress">{progress}</span></>}
          </span>
          {diff && <MoDiff add={diff[0]} del={diff[1]} />}
          {artifacts > 0 && <span className="om-mo-trow__count"><Icon name="file" size={13} />{artifacts}</span>}
        </span>
      </span>
    </button>
  );
}
