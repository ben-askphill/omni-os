import React from 'react';
import { Button } from '../core/Button.jsx';
import { Chip } from '../core/Monogram.jsx';
import { StatusGlyph } from '../core/Status.jsx';
import { Icon } from '../icons/Icon.jsx';
import { MoAvatar } from './MoThreadRow.jsx';
import { MoRadio } from './MoList.jsx';

/* After answering: a pill strip with the outcome and Undo. */
export function MoResolvedStrip({ text, onUndo }) {
  return (
    <div className="om-mo-resolved">
      <StatusGlyph state="done" size={9} />
      <span className="om-mo-resolved__text om-mo-ellipsis">{text}</span>
      {onUndo && <button type="button" className="om-mo-press" onClick={onUndo}><Icon name="undo" size={14} />Undo</button>}
    </div>
  );
}

/* The decision card: the agent's question and the buttons that answer it, the same card in Activity and in the thread.
   kind: confirm (body text), draft (a white sheet with the draft), choice (options with a radio, one recommended).
   The answer is a 48pt vermilion pill: the only filled vermilion on the screen. */
export function MoDecisionCard({ kind = 'confirm', title, channel, role = 'conductor', via, time, body, draftTo, draft, options = [], confirmLabel = 'Approve', denyLabel, onConfirm, onDeny, onOpen, inThread = false }) {
  const [pick, setPick] = React.useState(Math.max(0, options.findIndex((o) => o.recommended)));
  const meta = [channel && '#' + channel, role, via && 'via Conductor'].filter(Boolean).join(' · ');
  return (
    <div className="om-mo-decision">
      {inThread ? <span className="om-mo-decision__title">{title}</span> : (
        <button type="button" className="om-mo-decision__head" onClick={onOpen}>
          <MoAvatar role={role} state="needs" />
          <span className="om-mo-decision__text">
            <span className="om-mo-decision__meta">{meta}</span>
            <span className="om-mo-decision__title">{title}</span>
          </span>
          {time && <span className="om-mo-decision__time">{time}</span>}
        </button>
      )}
      {kind === 'confirm' && body && <p className="om-mo-decision__body">{body}</p>}
      {kind === 'draft' && (
        <div className="om-mo-decision__sheet"><div className="om-mo-decision__draft">{draftTo && <span>Draft to {draftTo}</span>}<p>{draft}</p></div></div>
      )}
      {kind === 'choice' && (
        <div className="om-mo-decision__sheet" role="radiogroup">
          {options.map((o, i) => (
            <button key={i} type="button" role="radio" aria-checked={pick === i} className="om-mo-decision__opt" onClick={() => setPick(i)}>
              <MoRadio on={pick === i} />
              <span style={{ flex: 1, minWidth: 0 }}><b>{o.label}{o.recommended && <Chip tone="outline">Recommended</Chip>}</b>{o.sub && <small>{o.sub}</small>}</span>
            </button>
          ))}
        </div>
      )}
      <div className="om-mo-decision__actions">
        <Button variant="needs" size="lg" onClick={() => onConfirm && onConfirm(kind === 'choice' ? pick : undefined)}>{confirmLabel}</Button>
        {denyLabel && <Button variant="secondary" size="lg" onClick={onDeny}>{denyLabel}</Button>}
      </div>
    </div>
  );
}
