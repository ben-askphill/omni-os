import React from 'react';
import { StatusGlyph } from '../core/Status.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { Icon } from '../icons/Icon.jsx';

/* Toast (Bencho "bell", web/src Toaster.tsx): springs up from the corner when a thread finishes elsewhere. */
export function Toast({ title, body, status, icon, action = 'Open', onAction, onDismiss }) {
  return (
    <div role="status" className="om-toast">
      {status ? <StatusGlyph state={status} /> : icon ? <Icon name={icon} size={15} style={{ color: 'var(--fg-3)' }} /> : null}
      <div className="t"><b>{title}</b>{body && <span>{body}</span>}</div>
      {onAction && <button type="button" className="om-btn om-btn--primary om-btn--sm" style={{ height: 32, padding: '0 14px' }} onClick={onAction}>{action}</button>}
      {onDismiss && <IconButton label="Dismiss" icon="x" iconSize={14} onClick={onDismiss} />}
    </div>
  );
}
