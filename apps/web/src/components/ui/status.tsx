import type { ReactNode } from 'react';
import type { ThreadStatus } from '@omni/server/db.ts';
import { Icon } from './icons.tsx';

// ---------- status ----------

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  imported: 'Imported',
  needs: 'Needs you',
  settled: 'Done',
  idle: 'Idle',
};

/** A thread's status in words. A thread whose own turn is over while the threads it delegated work reads as such. */
export const threadStatusText = (t: { status: string; delegating?: boolean }) =>
  t.delegating && t.status !== 'running' && t.status !== 'queued' ? 'Delegated threads running' : (STATUS_LABEL[t.status] ?? t.status);

export type Glyph = 'running' | 'needs' | 'done' | 'settled' | 'idle' | 'queued';

/** Thread status to the glyph it draws: a failure needs you, a stop just settles. */
export function glyphFor(status: ThreadStatus | string | null | undefined): Glyph {
  switch (status) {
    case 'running':
    case 'needs':
    case 'done':
    case 'settled':
    case 'queued':
    case 'idle':
      return status;
    case 'failed':
      return 'needs';
    case 'imported':
      return 'idle';
    default:
      return 'settled';
  }
}

export function StatusDot({ status, size = 8, className = '' }: { status: ThreadStatus | Glyph | string | null | undefined; size?: number; className?: string }) {
  const s = glyphFor(status);
  return (
    <span title={STATUS_LABEL[status ?? 'imported'] ?? status ?? undefined} data-s={s} className={`glyph ${className}`} style={{ width: size, height: size }}>
      {s === 'running' && <i className="ping" />}
      <i />
    </span>
  );
}

/** In place of the status dot on a thread Ben marked done: out of Needs you, still in its channel. */
export function DoneMark({ size = 8, className = '' }: { size?: number; className?: string }) {
  return (
    <span title="Marked done" className={`grid place-items-center text-fg-4 ${className}`}>
      <Icon name="check" size={size + 5} strokeWidth={2.2} />
    </span>
  );
}

export function StatusPill({ status, label }: { status: string; label?: ReactNode }) {
  return (
    <span role="status" data-s={glyphFor(status)} className="spill">
      <StatusDot status={status} size={6} />
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}
