import type { ReactNode } from 'react';
import { MARK, PHASE, STATUS, glyphFor, markOf, statusLabel, threadMark, threadPhase, type Glyph, type Mark, type MarkContext, type Phase } from '@omni/shared/status.ts';
import { useNeedOf } from '../../store.tsx';
import { Icon } from './icons.tsx';

export { MARK, PHASE, STATUS, asksForYou, blockerMark, glyphFor, markOf, statusLabel, threadGlyph, threadMark, threadPhase, turnPhase, type Glyph, type Mark, type Phase, type TurnPhase } from '@omni/shared/status.ts';

/** A thread's status in words: its phase while it is at work (Starting, Running, Waiting on crew), else its status. */
export function threadStatusText(t: { status: string; delegating?: boolean; setup?: string | null }) {
  const phase = threadPhase(t);
  return phase ? PHASE[phase].label : statusLabel(t.status);
}

// Every mark on a 16 unit box, in the mark's own color. The satellite (a small dot top right) says the state belongs
// to a thread under this one.
const SATELLITE = <circle cx="13.25" cy="2.75" r="2.6" />;
const line = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const SHAPE: Record<Mark | 'loading', ReactNode> = {
  // Circles: the agent has it. Dashed while it waits in line, half while it starts, full while it works.
  queued: <circle cx="8" cy="8" r="5.75" {...line} strokeLinecap="butt" strokeWidth="2.5" strokeDasharray="5.5 3.53" />,
  starting: (
    <>
      <circle cx="8" cy="8" r="6.25" {...line} strokeWidth="2.5" />
      <path d="M8 .5A7.5 7.5 0 0 0 8 15.5Z" />
    </>
  ),
  working: <circle cx="8" cy="8" r="7" />,
  tool: (
    <>
      <circle cx="8" cy="8" r="3.75" />
      <circle cx="8" cy="8" r="6.9" {...line} strokeWidth="1.6" />
    </>
  ),
  delegating: (
    <>
      <circle cx="6" cy="10" r="5.5" />
      {SATELLITE}
    </>
  ),
  loading: <circle cx="8" cy="8" r="4" />,
  // Squares: a system outside Omni has it.
  checking: <rect x="1.5" y="1.5" width="13" height="13" rx="3" />,
  limited: <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" {...line} strokeWidth="2.5" />,
  resuming: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" {...line} strokeWidth="2.5" />
      <path d="M8 2.5H5A2.5 2.5 0 0 0 2.5 5v6A2.5 2.5 0 0 0 5 13.5h3Z" />
    </>
  ),
  // Diamonds: the user has it. Filled while the agent waits on them, hollow for a held message, half for a review.
  question: <path d="M8 1.2 14.8 8 8 14.8 1.2 8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  crew_question: (
    <>
      <path d="M6.5 3.9 12.1 9.5 6.5 15.1.9 9.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      {SATELLITE}
    </>
  ),
  held: <path d="M8 2 14 8 8 14 2 8Z" {...line} strokeWidth="2.4" />,
  review: (
    <>
      <path d="M8 2 14 8 8 14 2 8Z" {...line} strokeWidth="2.4" />
      <path d="M8 2 2 8 8 14Z" />
    </>
  ),
  // Broken: a cross where a turn failed, a triangle where it never started.
  failed: <path d="M3 3 13 13M13 3 3 13" {...line} strokeWidth="3" />,
  crew_failed: (
    <>
      <path d="M1.6 6 10 14.4M10 6 1.6 14.4" {...line} strokeWidth="2.8" />
      {SATELLITE}
    </>
  ),
  setup_failed: <path d="M8 2.8 14 13.2H2Z" {...line} strokeWidth="2.4" />,
  // Settled: nobody has it.
  done: (
    <>
      <circle cx="8" cy="8" r="6.8" className="mark-done" />
      <path d="M4.7 8.4 7 10.6 11.3 5.7" {...line} strokeWidth="2" className="mark-tick" />
    </>
  ),
  stopped: <rect x="1.5" y="5.5" width="13" height="5" rx="2.5" />,
  idle: <circle cx="8" cy="8" r="3.25" />,
};

// A shape that is not a plain dot loses itself below 8px, and one with a satellite below 9.
const MIN_SHAPED = 8;
const PLAIN: ReadonlySet<Mark> = new Set(['working', 'idle', 'starting']);
const CREW: ReadonlySet<Mark> = new Set(['delegating', 'crew_question', 'crew_failed']);
const boxOf = (mark: Mark, size: number) => (CREW.has(mark) ? Math.max(size, MIN_SHAPED + 1) : PLAIN.has(mark) ? size : Math.max(size, MIN_SHAPED));

/**
 * The one status mark, for every state a thread can be in (`Mark` in @omni/shared/status.ts). Its shape says who has
 * the ball (circle: the agent, square: an outside system, diamond: Ben, cross or triangle: broken), its fill how far
 * along, a satellite dot that the state is its crew's. Two motions only: a halo leaves it while the agent's own turn
 * works, and it breathes while it waits on other work. Neither runs under reduced motion, where the shapes still
 * tell the states apart. The mark's name and meaning are its tooltip and accessible label.
 *
 * `mark` names the state outright. Without it, `status` (a glyph or a thread status) and the `phase` of a thread at
 * work say which one.
 */
export function StatusDot({
  status,
  phase,
  mark,
  size = 8,
  className = '',
}: {
  status?: Glyph | string | null;
  phase?: Phase | null;
  mark?: Mark | null;
  size?: number;
  className?: string;
}) {
  const m = mark ?? markOf(glyphFor(status), phase);
  const { family, glyph, motion } = MARK[m];
  // A bare status also marks things that are not threads (a connection, a check): it keeps the status's plain name.
  const named = mark || phase;
  const label = named ? MARK[m].label : STATUS[glyph].label;
  const box = boxOf(m, size);
  return (
    <span
      role="img"
      aria-label={label}
      title={named ? `${label}. ${MARK[m].hint}.` : label}
      data-s={glyph}
      data-mark={m}
      data-family={family}
      data-phase={m in PHASE ? m : undefined}
      className={`glyph ${className}`}
      style={{ width: box, height: box }}
    >
      {motion === 'ping' && <i className="ping" />}
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={motion === 'breathe' ? 'breathe' : undefined}>
        {SHAPE[m]}
      </svg>
    </span>
  );
}

/**
 * Something loads that is not a thread at work: a button's request, a list being read. The running dot in the text's
 * own color, half its box so it sits where an icon would.
 */
export function Loader({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <span role="status" aria-label="Loading" data-s="running" data-mark="loading" data-phase="loading" className={`glyph ${className}`} style={{ width: size, height: size }}>
      <i className="ping" />
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {SHAPE.loading}
      </svg>
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

type Marked = { id?: string; status: string; delegating?: boolean; setup?: string | null; limit_state?: string | null; done_at?: string | null };

/**
 * A thread's mark on a row: what holds it up for Ben (its Needs you item), its phase while it is at work, the check
 * once Ben marked it done, else how it ended. `state`: the glyph the row settled on (the thread tree's needs you and
 * failed come before the thread's own), which a phase gives way to. `busy`: the row knows of work the thread's own
 * state does not say, as sub-agents a stopped turn left behind. `pr`: the pull request on its branch.
 */
export function ThreadDot({ t, state, busy = false, size = 7, pr, turn }: { t: Marked; state?: Glyph; busy?: boolean; size?: number } & Pick<MarkContext, 'pr' | 'turn'>) {
  const need = useNeedOf(t.id);
  const mark = threadMark(t, { need, pr, turn });
  const own = MARK[mark].glyph;
  // The tree put a state first that the thread's own mark does not say: draw the tree's.
  if (state && state !== 'running' && state !== 'queued' && own !== state && !need?.blockers.length) return <StatusDot status={state} size={size} />;
  if (need?.blockers.length) return <StatusDot mark={mark} size={size} />;
  if (own === 'running' && mark !== 'queued') return <StatusDot mark={mark} size={size + 1} />;
  if (busy || state === 'running') return <StatusDot mark="delegating" size={size + 1} />;
  if (t.done_at) return <DoneMark size={size} />;
  return <StatusDot mark={mark} size={size} />;
}

/** A failure announces itself (role="alert"); every other state is a polite status. */
export function StatusPill({ status, phase, mark, label }: { status?: Glyph | string; phase?: Phase | null; mark?: Mark | null; label?: ReactNode }) {
  const m = mark ?? markOf(glyphFor(status), phase);
  const s = MARK[m].glyph;
  return (
    <span role={s === 'failed' ? 'alert' : 'status'} data-s={s} data-mark={m} className="spill">
      <StatusDot mark={m} size={7} />
      {label ?? (mark ? MARK[m].label : STATUS[s].label)}
    </span>
  );
}
