import React from 'react';
import { Icon } from '../icons/Icon.jsx';
import { Loader } from '../brand/Loader.jsx';
import { Button } from '../core/Button.jsx';
import { StatusGlyph } from '../core/Status.jsx';

/* Handing a running thread to another synced Mac (web/src components/thread/Handoff.tsx, apps/mac HandoffViews.swift).
   The card sits in the transcript column while the handoff is under way or went wrong; once it settles it is one quiet
   line. Copy comes from packages/shared/handoff.ts handoffText. */
export function HandoffCard({ tone = 'working', children, note, cancel = false, mobile = false }) {
  const alert = tone === 'alert';
  return (
    <section className={'om-handoff' + (mobile ? ' om-handoff--phone' : '')} role={alert ? 'alert' : 'status'} aria-label="Handoff">
      <span className={'om-handoff__mark' + (alert ? ' om-handoff__mark--alert' : '')}>
        {tone === 'working' ? <Loader size={14} /> : <Icon name={alert ? 'alert' : 'clock'} size={15} />}
      </span>
      <div className="om-handoff__body">
        <p className="om-handoff__say">{children}</p>
        {note && <p className="om-handoff__note">{note}</p>}
      </div>
      {cancel && <Button size="sm" variant="secondary" icon="x" className="om-handoff__cancel">Cancel handoff</Button>}
    </section>
  );
}

/* The settled handoff: accepted (share icon) or cancelled (x). */
export function HandoffLine({ tone = 'done', children }) {
  return (
    <div className="om-handoff-line" role="status">
      <Icon name={tone === 'done' ? 'share' : 'x'} size={13} />
      <span>{children}</span>
    </div>
  );
}

const DOT = { online: 'done', unknown: 'settled', offline: 'idle' };

/* The Macs a thread can go to: online first, then the ones Tailscale cannot check, then asleep ones, which cannot be
   picked. `error` is the server's refusal, shown under the list. */
export function DevicePicker({ devices = [], error, title = 'Hand off to' }) {
  return (
    <div className="om-devices" role="menu" aria-label={title}>
      <div className="om-devices__title">{title}</div>
      {devices.map((d) => (
        <button key={d.name} type="button" role="menuitem" className="om-devices__row" disabled={d.reachability === 'offline'}>
          <StatusGlyph state={DOT[d.reachability]} size={7} />
          <span className="om-devices__text">
            <span className="om-devices__name">{d.name}</span>
            <span className="om-devices__label">{d.label}</span>
          </span>
        </button>
      ))}
      {error && <p className="om-devices__error">{error}</p>}
    </div>
  );
}
