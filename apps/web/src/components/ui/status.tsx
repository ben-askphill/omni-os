import type { ReactNode } from 'react';
import { STATUS, glyphFor, statusLabel, type Glyph } from '@omni/shared/status.ts';
import { Icon } from './icons.tsx';

export { STATUS, asksForYou, glyphFor, statusLabel, threadGlyph, type Glyph } from '@omni/shared/status.ts';

/** A thread's status in words. A thread whose own turn is over while the threads it delegated work reads as such. */
export const threadStatusText = (t: { status: string; delegating?: boolean }) =>
  t.delegating && t.status !== 'running' && t.status !== 'queued' ? 'Delegated threads running' : statusLabel(t.status);

// The needs diamond and the failed cross lose their shape below 8px.
const MIN_SHAPED = 8;

export function StatusDot({ status, size = 8, className = '' }: { status: Glyph | string | null | undefined; size?: number; className?: string }) {
  const s = glyphFor(status);
  const box = s === 'needs' || s === 'failed' ? Math.max(size, MIN_SHAPED) : size;
  return (
    <span title={STATUS[s].label} data-s={s} className={`glyph ${className}`} style={{ width: box, height: box }}>
      {s === 'running' && <i className="ping" />}
      <i />
    </span>
  );
}

/** In place of the status dot on a thread Ben marked done: out of Needs you, still in its channel. */
export function DoneMark({ size = 8, className = '' }: { size?: number; className?: string }) {
  return (
    <span title="Marked done" className={`grid place-items-center text-fg-3 ${className}`}>
      <Icon name="check" size={size + 5} strokeWidth={2.2} />
    </span>
  );
}

/** A failure announces itself (role="alert"); every other state is a polite status. */
export function StatusPill({ status, label }: { status: Glyph | string; label?: ReactNode }) {
  const s = glyphFor(status);
  return (
    <span role={s === 'failed' ? 'alert' : 'status'} data-s={s} className="spill">
      <StatusDot status={s} size={6} />
      {label ?? STATUS[s].label}
    </span>
  );
}
