// One status vocabulary for every client: the web and phone layouts (apps/web/src/components/ui/status.tsx) and the
// iOS app (apps/ios/src/components/glyph.ts) read their labels and tones here. Pure.

/**
 * What a status dot draws. The five states a person reads (running, needs, limited, failed, done) plus the quiet
 * ones: settled after a stop, queued and idle as a hollow ring.
 */
export type Glyph = 'running' | 'needs' | 'limited' | 'failed' | 'done' | 'settled' | 'queued' | 'idle';

/** The token a state takes its colour from: --live, --needs, --warn, --done, or none. */
export type StatusTone = 'live' | 'needs' | 'warn' | 'done' | 'neutral';

export const STATUS: Record<Glyph, { label: string; tone: StatusTone }> = {
  running: { label: 'Running', tone: 'live' },
  needs: { label: 'Needs you', tone: 'needs' },
  limited: { label: 'Limited', tone: 'warn' },
  failed: { label: 'Failed', tone: 'needs' },
  done: { label: 'Done', tone: 'done' },
  settled: { label: 'Stopped', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'neutral' },
  idle: { label: 'Idle', tone: 'neutral' },
};

/** A thread status (ThreadStatus in apps/server/db/repos/threads.ts), a glyph, or anything else, to its glyph. */
export function glyphFor(status: string | null | undefined): Glyph {
  switch (status) {
    case 'running':
    case 'needs':
    case 'limited':
    case 'failed':
    case 'done':
    case 'settled':
    case 'queued':
    case 'idle':
      return status;
    case 'imported':
      return 'idle';
    default:
      return 'settled';
  }
}

export const statusLabel = (status: string | null | undefined) => STATUS[glyphFor(status)].label;

/**
 * The glyph a thread shows. A turn the harness stopped at its usage limit ends failed and keeps its `limit_state`
 * (apps/server/runner/records.ts limitStop): that reads Limited, not Failed. A thread whose own turn ended while
 * threads or sub-agents it delegated still work reads Running.
 */
export function threadGlyph(t: { status: string; delegating?: boolean; limit_state?: string | null }): Glyph {
  if (t.delegating && t.status !== 'queued') return 'running';
  if (t.limit_state && t.status !== 'running' && t.status !== 'queued') return 'limited';
  return glyphFor(t.status);
}

/**
 * What a working thread is doing, as far as the app knows it. Each phase is a mark of its own (`Mark`, below).
 */
export type Phase = 'starting' | 'working' | 'tool' | 'delegating' | 'checking';

/** Each phase's name and what it means, for the dot's tooltip and accessible label. */
export const PHASE: Record<Phase, { label: string; hint: string }> = {
  starting: { label: 'Starting', hint: 'Its folder is being prepared, or the agent has not picked the message up yet' },
  working: { label: 'Running', hint: 'Its own turn runs' },
  tool: { label: 'Running a tool', hint: 'A tool call in its turn has not returned yet' },
  delegating: { label: 'Waiting on crew', hint: 'Its own turn ended; threads or sub-agents it delegated still work' },
  checking: { label: 'Checks running', hint: 'Checks on its pull request have not finished' },
};

/** What a running turn is doing, read off the open thread's rows (turnPhase). The lists do not have the rows. */
export type TurnPhase = Extract<Phase, 'starting' | 'working' | 'tool'>;

/** The rows that show the harness took the message or answered: before the first of them, the turn is starting. */
const TURN_LIVE = new Set(['user', 'crew_report', 'assistant_text', 'tool_use', 'tool_result', 'task']);
/** How far back a turn is read. An open call older than this reads Working. */
const TURN_ROWS = 600;

/**
 * The running turn's phase, from the thread's rows back to the last result: `starting` until the harness replays the
 * message or says anything, `tool` while a call has no result yet, else `working`. Only meaningful while the thread's
 * own turn runs.
 */
export function turnPhase(events: readonly { kind: string; payload?: string | null }[]): TurnPhase {
  const returned = new Set<string>();
  let live = false;
  for (let k = events.length - 1, n = 0; k >= 0 && n < TURN_ROWS; k--, n++) {
    const e = events[k];
    if (e.kind === 'result') break;
    if (TURN_LIVE.has(e.kind)) live = true;
    if (e.kind !== 'tool_use' && e.kind !== 'tool_result') continue;
    let p: { id?: unknown; tool_use_id?: unknown } | null = null;
    try {
      p = JSON.parse(e.payload ?? 'null');
    } catch {
      continue;
    }
    if (e.kind === 'tool_result') {
      if (typeof p?.tool_use_id === 'string') returned.add(p.tool_use_id);
    } else if (typeof p?.id === 'string' && !returned.has(p.id)) return 'tool';
  }
  return live ? 'working' : 'starting';
}

/**
 * The phase a thread's running dot shows, or null when it is not at work. Its folder being prepared comes first
 * (`setup`, runner/setup.ts), then its own turn (with `turn` where the rows are at hand), then the threads and
 * sub-agents it delegated (`delegating`, apps/server/delegating.ts). Queued alone waits for a slot: no phase.
 */
export function threadPhase(t: { status: string; delegating?: boolean; setup?: string | null }, turn?: TurnPhase | null): Phase | null {
  if (t.setup === 'preparing' && (t.status === 'running' || t.status === 'queued')) return 'starting';
  if (t.status === 'running') return turn ?? 'working';
  if (t.delegating && t.status !== 'queued') return 'delegating';
  return null;
}

/** The glyph asks for Ben: he answers it, resumes it or looks into it. */
export const asksForYou = (g: Glyph) => g === 'needs' || g === 'failed' || g === 'limited';

/** What holds a thread up until Ben acts (NeedsYouBlocker in apps/server/db/repos/needs-you.ts), to its glyph. */
export const BLOCKER_GLYPH: Record<'question' | 'setup' | 'recovered' | 'uncertain' | 'limited' | 'child_failed', Glyph> = {
  question: 'needs',
  child_failed: 'failed',
  setup: 'failed',
  limited: 'limited',
  uncertain: 'needs',
  recovered: 'needs',
};

/**
 * The one vocabulary a status mark draws, for every state a thread can be in (StatusDot, apps/web/src/index.css
 * .glyph). The shape says who has the ball: a circle while the agent has it, a square while a system outside Omni
 * does (checks, a usage limit), a diamond when Ben does, a cross or a triangle when something broke. The fill says
 * how far along: hollow before it starts or while it only waits, half while it is partway, filled while it is on.
 * A small satellite dot says the state belongs to a thread under this one (its crew). The Web UI only: the iOS app
 * draws `Glyph`.
 */
export type Mark =
  | 'queued'
  | Phase
  | 'limited'
  | 'resuming'
  | 'question'
  | 'crew_question'
  | 'held'
  | 'review'
  | 'failed'
  | 'crew_failed'
  | 'setup_failed'
  | 'done'
  | 'stopped'
  | 'idle';

/** Who has the ball, which is the mark's color: the agent, an outside system, Ben, nobody because it broke, or nobody because it ended. */
export type MarkFamily = 'agent' | 'system' | 'you' | 'broken' | 'settled' | 'quiet';

/**
 * How a mark moves. `ping`: a halo leaves it while the agent's own turn works. `breathe`: it fades and returns while
 * it waits on other work (crew, checks, a limit's clock). `still`: it waits on Ben, or nothing happens.
 */
export type MarkMotion = 'ping' | 'breathe' | 'still';

export const MARK: Record<Mark, { label: string; hint: string; family: MarkFamily; glyph: Glyph; motion: MarkMotion }> = {
  queued: { label: 'Queued', hint: 'It waits for a free slot', family: 'quiet', glyph: 'queued', motion: 'still' },
  starting: { ...PHASE.starting, family: 'agent', glyph: 'running', motion: 'ping' },
  working: { ...PHASE.working, family: 'agent', glyph: 'running', motion: 'ping' },
  tool: { ...PHASE.tool, family: 'agent', glyph: 'running', motion: 'ping' },
  delegating: { ...PHASE.delegating, family: 'agent', glyph: 'running', motion: 'breathe' },
  checking: { ...PHASE.checking, family: 'system', glyph: 'running', motion: 'breathe' },
  limited: { label: 'Usage limit', hint: 'Its harness stopped the turn at the plan\'s usage limit', family: 'system', glyph: 'limited', motion: 'still' },
  resuming: { label: 'Resumes at reset', hint: 'It hit the usage limit and continues by itself when the limit resets', family: 'system', glyph: 'limited', motion: 'breathe' },
  question: { label: 'Waiting on you', hint: 'Its agent asked you a question and waits', family: 'you', glyph: 'needs', motion: 'still' },
  crew_question: { label: 'Crew waits on you', hint: 'A thread under this one asked you a question and waits', family: 'you', glyph: 'needs', motion: 'still' },
  held: { label: 'Message held', hint: 'A restart kept a message back: it is sent when you say so', family: 'you', glyph: 'needs', motion: 'still' },
  review: { label: 'Ready for review', hint: 'It finished and its pull request is open', family: 'you', glyph: 'done', motion: 'still' },
  failed: { label: 'Failed', hint: 'Its turn ended in an error', family: 'broken', glyph: 'failed', motion: 'still' },
  crew_failed: { label: 'Crew failed', hint: 'A thread under this one failed and you have not opened it', family: 'broken', glyph: 'failed', motion: 'still' },
  setup_failed: { label: 'Setup failed', hint: 'Its folder could not be prepared, so it never started', family: 'broken', glyph: 'failed', motion: 'still' },
  done: { label: 'Done', hint: 'Its turn finished', family: 'settled', glyph: 'done', motion: 'still' },
  stopped: { label: 'Stopped', hint: 'Its turn was stopped', family: 'quiet', glyph: 'settled', motion: 'still' },
  idle: { label: 'Idle', hint: 'It has not run', family: 'quiet', glyph: 'idle', motion: 'still' },
};

const GLYPH_MARK: Record<Glyph, Mark> = { running: 'working', needs: 'question', limited: 'limited', failed: 'failed', done: 'done', settled: 'stopped', queued: 'queued', idle: 'idle' };

/** The mark a bare glyph draws, with its phase while it is at work. */
export const markOf = (glyph: Glyph, phase?: Phase | null): Mark => (phase && (glyph === 'running' || glyph === 'queued') ? phase : GLYPH_MARK[glyph]);

/** What holds a thread up (a Needs you blocker), to its mark. `from`: the threads under it that asked. */
export function blockerMark(b: { kind: keyof typeof BLOCKER_GLYPH; from?: readonly string[]; scheduled?: boolean }): Mark {
  switch (b.kind) {
    case 'question':
      return b.from?.length ? 'crew_question' : 'question';
    case 'child_failed':
      return 'crew_failed';
    case 'setup':
      return 'setup_failed';
    case 'limited':
      return b.scheduled ? 'resuming' : 'limited';
    default:
      return 'held';
  }
}

/** What a row knows about a thread beyond the thread itself. */
export interface MarkContext {
  /** The running turn's phase, where the rows are at hand (turnPhase). */
  turn?: TurnPhase | null;
  /** The thread's Needs you item: what holds it up comes first. */
  need?: { blockers: readonly Parameters<typeof blockerMark>[0][] } | null;
  /** The pull request on its branch, where the list loaded it (GET /channels/:id/thread-prs). */
  pr?: { state?: string; isDraft: boolean } | null;
}

/**
 * The mark a thread shows. What holds it up for Ben first, even while it runs (a question waits whatever else
 * happens); then its phase while it is at work; then how it ended, where a finished thread with an open pull request
 * reads Ready for review.
 */
export function threadMark(t: Parameters<typeof threadGlyph>[0] & { setup?: string | null }, ctx: MarkContext = {}): Mark {
  const b = ctx.need?.blockers[0];
  if (b) return blockerMark(b);
  const phase = threadPhase(t, ctx.turn);
  if (phase) return phase;
  if (t.setup === 'failed') return 'setup_failed';
  const glyph = threadGlyph(t);
  if (glyph === 'done' && ctx.pr?.state === 'OPEN' && !ctx.pr.isDraft) return 'review';
  return markOf(glyph);
}

/** How a turn ended, a Needs you result's status (done, failed or stopped), to its glyph. A stopped turn reads Stopped. */
export const resultGlyph = (status: string): Glyph => (status === 'failed' ? 'failed' : status === 'stopped' ? 'settled' : 'done');

/** What a row says on its right in place of the time. */
export interface RowStatus {
  glyph: Glyph;
  label: string;
}

/**
 * The status an Inbox card shows (the sidebar's Inbox, the phone's Activity tab and the iOS app's), read the way Home
 * reads the same thread: what holds it up first, as Home's Needs you card; then its own turn running, queued or
 * waiting on what it delegated, as Home's dot (threadGlyph); then the result Ben has not read. Null: nothing to say,
 * so the card shows the time. Sub-agents still working after a turn ended done make it Running, through
 * `delegating`; background shells and monitors, and anything a stopped turn left running, do not.
 */
export function inboxStatus(
  t: Parameters<typeof threadGlyph>[0],
  need?: { blockers: readonly { kind: keyof typeof BLOCKER_GLYPH }[]; result: { status: string } | null } | null,
): RowStatus | null {
  const b = need?.blockers[0];
  const own = threadGlyph(t);
  const glyph = b ? BLOCKER_GLYPH[b.kind] : own === 'running' || own === 'queued' ? own : need?.result ? resultGlyph(need.result.status) : null;
  return glyph ? { glyph, label: STATUS[glyph].label } : null;
}
