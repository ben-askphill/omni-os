import type { ReactNode } from 'react';
import { PHASE, STATUS, glyphFor, statusLabel, threadGlyph, threadPhase, type Glyph, type Phase } from '@omni/shared/status.ts';
import { Icon } from './icons.tsx';

export { PHASE, STATUS, asksForYou, glyphFor, statusLabel, threadGlyph, threadPhase, turnPhase, type Glyph, type Phase, type TurnPhase } from '@omni/shared/status.ts';

/** A thread's status in words: its phase while it is at work (Starting, Running, Waiting on crew), else its status. */
export function threadStatusText(t: { status: string; delegating?: boolean; setup?: string | null }) {
  const phase = threadPhase(t);
  return phase ? PHASE[phase].label : statusLabel(t.status);
}

// The needs diamond and the failed cross lose their shape below 8px.
const MIN_SHAPED = 8;

/**
 * The one status mark. A thread at work passes its `phase` (threadPhase), and the running dot draws it: hollow while
 * it starts, filled while its own turn works, inside a ring while a tool runs, a ring around a core while it waits on
 * its crew, amber while checks run. All of them move the same way, a halo leaving the dot, slower for the phases that
 * wait on something else, and not at all under reduced motion, where the shapes still tell them apart. The phase's
 * name and meaning are the dot's tooltip and accessible label. Without a phase a running dot is the plain filled one.
 */
export function StatusDot({ status, phase, size = 8, className = '' }: { status: Glyph | string | null | undefined; phase?: Phase | null; size?: number; className?: string }) {
  const own = glyphFor(status);
  // A phase belongs to a thread at work. One still queued while its folder is prepared is at work too.
  const p = phase && (own === 'running' || own === 'queued') ? phase : null;
  const s = p ? 'running' : own;
  const box = s === 'needs' || s === 'failed' ? Math.max(size, MIN_SHAPED) : size;
  const said = p ? { role: 'img' as const, 'aria-label': PHASE[p].label, title: `${PHASE[p].label}. ${PHASE[p].hint}.` } : { title: STATUS[s].label };
  return (
    <span {...said} data-s={s} data-phase={p ?? undefined} className={`glyph ${className}`} style={{ width: box, height: box }}>
      {s === 'running' && <i className="ping" />}
      <i />
    </span>
  );
}

/**
 * Something loads that is not a thread at work: a button's request, a list being read. The running dot in the text's
 * own color, half its box so it sits where an icon would.
 */
export function Loader({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <span role="status" aria-label="Loading" data-s="running" data-phase="loading" className={`glyph ${className}`} style={{ width: size, height: size }}>
      <i className="ping" />
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

/**
 * A thread's mark on a row: its phase while it is at work, the check once Ben marked it done, else its status.
 * `state`: the glyph the row settled on (the thread tree's needs you and failed come before the thread's own), which
 * a phase gives way to. `busy`: the row knows of work the thread's own state does not say, as sub-agents a stopped
 * turn left behind.
 */
export function ThreadDot({
  t,
  state,
  busy = false,
  size = 7,
}: {
  t: { status: string; delegating?: boolean; setup?: string | null; limit_state?: string | null; done_at?: string | null };
  state?: Glyph;
  busy?: boolean;
  size?: number;
}) {
  const phase = !state || state === 'running' || state === 'queued' ? (threadPhase(t) ?? (busy || state === 'running' ? 'delegating' : null)) : null;
  if (phase) return <StatusDot status="running" phase={phase} size={size + 1} />;
  if (t.done_at) return <DoneMark size={size} />;
  return <StatusDot status={state ?? threadGlyph(t)} size={size} />;
}

/** A failure announces itself (role="alert"); every other state is a polite status. */
export function StatusPill({ status, phase, label }: { status: Glyph | string; phase?: Phase | null; label?: ReactNode }) {
  const s = glyphFor(status);
  return (
    <span role={s === 'failed' ? 'alert' : 'status'} data-s={s} className="spill">
      <StatusDot status={s} phase={phase} size={7} />
      {label ?? STATUS[s].label}
    </span>
  );
}
