import React from 'react';
import { CrewMark } from '../icons/CrewMark.jsx';
import { Icon } from '../icons/Icon.jsx';
import { Loader } from '../brand/Loader.jsx';

/* Transcript turns (web/src Transcript.tsx). You: a right-aligned bubble. Agents: markdown, no bubble. */
export function Message({ role = 'agent', author, crew = 'conductor', model, time, source, children }) {
  if (role === 'user') {
    return (
      <div className="om-user">
        <div className="om-user__meta">
          {source && <b className="from">{source}</b>}
          {author && <b>{author}</b>}
          {time && <time>{time}</time>}
        </div>
        <div className="om-bubble">{children}</div>
      </div>
    );
  }
  return (
    <div className="om-agent">
      {(author || model) && (
        <div className="om-agent__meta">
          <CrewMark role={crew} size={13} />
          <span className="om-caption" style={{ color: 'var(--fg-3)' }}>{author || crew}</span>
          {model && <span className="om-caption">{model}</span>}
          {time && <span className="om-caption">{time}</span>}
        </div>
      )}
      <div className="om-md">{children}</div>
    </div>
  );
}

export function ResultLine({ children, ok = true }) {
  return <div className="om-result"><span><i style={ok ? null : { background: 'var(--needs)' }} />{children}</span></div>;
}

/* A run switch between turns (web/src Transcript.tsx SwitchLine, apps/mac MessageViews SwitchLineView): the result
   line's quiet rule with the switch, and the handover's progress under it. The loader shows only while the turn that
   picks the handover up runs. The icon is inline so a wrapped line keeps it on its first line. */
export function SwitchLine({ children, note, pending = false }) {
  return (
    <div className="om-switch">
      <div className="om-switch__line">
        <span className="om-switch__say">
          <Icon name="refresh" size={12} style={{ display: 'inline-block', marginRight: 6, verticalAlign: -1 }} />
          {children}
          {pending && <span className="om-switch__wait"><Loader size={11} /></span>}
        </span>
      </div>
      {note && <div className="om-switch__note">{note}</div>}
    </div>
  );
}
