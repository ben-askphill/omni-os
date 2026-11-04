import React from 'react';
import { Status } from '../core/Status.jsx';
import { TaskId } from '../core/Monogram.jsx';
import { CrewMark } from '../icons/CrewMark.jsx';
import { HarnessMark } from '../icons/HarnessMark.jsx';

/* The Conductor's fan-out: a surface card, one rounded elbow per crew thread, each branch carrying its live state. */
export function Delegation({ title, branches = [], onOpen }) {
  const ids = branches.map((b) => b.taskId).filter(Boolean);
  return (
    <section className="om-deleg" aria-label="Delegation">
      <div className="om-deleg__head">
        <svg width="14" height="14" viewBox="-64 -64 128 128" aria-hidden="true" style={{ display: 'block', flex: 'none' }}><circle r="39" fill="none" stroke="currentColor" strokeWidth="26" /></svg>
        <span>{title || `Delegated ${branches.length} task${branches.length === 1 ? '' : 's'}`}</span>
        <span className="ids">{ids.join('  ')}</span>
      </div>
      <div className="om-deleg__tree">
        {branches.map((b) => (
          <div key={b.taskId} className={'om-branch om-branch--' + (b.state || 'idle')}>
            <span className="om-branch__mark"><CrewMark role={b.role} size={15} /></span>
            <div className="om-branch__main">
              <span className="om-branch__title">{b.title}</span>
              <span className="om-branch__meta">
                <span>{b.role}</span>
                {b.channel && <span>#{b.channel.name}</span>}
                {b.harness && <HarnessMark harness={b.harness} />}
                <TaskId id={b.taskId} onClick={onOpen ? () => onOpen(b) : undefined} />
                {b.progress && <span className="prog">{b.progress}</span>}
              </span>
              {b.note && <span className="om-branch__note">{b.note}</span>}
              {b.actions && <span className="om-branch__actions">{b.actions}</span>}
            </div>
            <span className="om-branch__side"><Status state={b.state || 'idle'} label={b.statusLabel} /></span>
          </div>
        ))}
      </div>
    </section>
  );
}
