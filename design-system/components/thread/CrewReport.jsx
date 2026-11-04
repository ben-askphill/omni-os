import React from 'react';
import { Status } from '../core/Status.jsx';
import { Chip } from '../core/Monogram.jsx';
import { CrewMark } from '../icons/CrewMark.jsx';
import { Icon } from '../icons/Icon.jsx';

/* Crew report (web/src Transcript ReportCard), plus the T-id, a fresh flag and a mono fact line. */
export function CrewReport({ role = 'researcher', taskId, channel, time, title, fresh = true, status = 'done', facts = [], actions, onOpen, children }) {
  return (
    <section className="om-report" aria-label={'Report ' + (taskId || '')}>
      <div className="om-report__head">
        <span className="om-report__ic"><CrewMark role={role} size={14} /></span>
        <b>Report from {role}</b>
        {taskId && <span className="om-tid">{taskId}</span>}
        {channel && <span>#{channel.name}</span>}
        {fresh && <Chip tone="done">New</Chip>}
        <span className="om-report__end">
          {time && <time className="om-report__time">{time}</time>}
          {status && !fresh && <Status state={status} />}
          <button type="button" className="om-openpill" onClick={onOpen}>Open thread <Icon name="arrowRight" size={12} /></button>
        </span>
      </div>
      {title && <h2 className="om-report__title">{title}</h2>}
      <div className="om-report__body om-md">{children}</div>
      {actions && <div className="om-report__actions">{actions}</div>}
      {facts.length > 0 && <div className="om-report__facts">{facts.map((f, i) => <span key={i}>{f}</span>)}</div>}
    </section>
  );
}
