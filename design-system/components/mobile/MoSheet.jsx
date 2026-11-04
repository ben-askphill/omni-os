import React from 'react';
import { MoRoundButton } from './MoButtons.jsx';

/* Bottom sheet for secondary choices: thread menu, attach with model and effort, search, new delegation.
   28pt top corners, a 36 × 5 grabber, scrim tap closes. full = stops 56pt below the top. */
export function MoSheet({ title, onClose, full = false, right, children }) {
  return (
    <div className={'om-mo-sheet' + (full ? ' om-mo-sheet--full' : '')}>
      <div className="om-mo-sheet__scrim" onClick={onClose} />
      <div className="om-mo-sheet__panel" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="om-mo-sheet__grabber" />
        {title && (
          <div className="om-mo-sheet__head">
            <span className="om-mo-sheet__title om-mo-ellipsis">{title}</span>
            {right}
            {onClose && <MoRoundButton icon="x" label="Close" size={32} onPress={onClose} />}
          </div>
        )}
        <div className="om-mo-sheet__body">{children}</div>
      </div>
    </div>
  );
}
