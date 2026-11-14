// A thread's `/goal`: Claude Code keeps working until a condition holds, and Omni shows that goal as one line at the end
// of the timeline. The server reads the goal from the CLI's stream (apps/server/stream.ts) and keeps it on the thread
// row; every client draws the line from here. Pure.

/** `active` while Claude works toward it or waits for the next turn; `complete` once a turn ended with it met. */
export type GoalStatus = 'active' | 'complete';

/** The goal as a thread row carries it. Null objective: no goal. */
export interface GoalFields {
  goal_objective?: string | null;
  goal_status?: string | null;
  /** How many times Claude's goal check said the condition did not hold yet. */
  goal_checks?: number | null;
}

export interface Goal {
  objective: string;
  status: GoalStatus;
  checks: number;
}

export function goalOf(t: GoalFields): Goal | null {
  const objective = t.goal_objective?.trim();
  if (!objective) return null;
  return { objective, status: t.goal_status === 'complete' ? 'complete' : 'active', checks: Math.max(0, t.goal_checks ?? 0) };
}

/** What the goal line sends to clear an active goal. */
export const GOAL_CLEAR = '/goal clear';

export type GoalCommand = { type: 'show' } | { type: 'clear' } | { type: 'set'; objective: string };

/** A `/goal` message: no argument shows it, `clear` drops it, anything else is the new condition. */
export function parseGoalCommand(text: string): GoalCommand | null {
  const m = /^\/goal(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (!m) return null;
  const arg = (m[1] ?? '').trim();
  if (!arg) return { type: 'show' };
  if (arg.toLowerCase() === 'clear') return { type: 'clear' };
  return { type: 'set', objective: arg };
}

export interface GoalView {
  /** "Pursuing goal", "Goal set" or "Goal complete", with the check count once there is one. */
  title: string;
  objective: string;
  /** Clear is offered while the goal is active. A complete goal goes away with the next message. */
  canClear: boolean;
}

/** The goal line. `running`: a turn is working on the thread now. */
export function goalView(goal: Goal, running: boolean): GoalView {
  const title = goal.status === 'complete' ? 'Goal complete' : running ? 'Pursuing goal' : 'Goal set';
  const checks = goal.checks > 0 ? ` · ${goal.checks} ${goal.checks === 1 ? 'check' : 'checks'}` : '';
  return { title: title + checks, objective: goal.objective, canClear: goal.status === 'active' };
}

/** A running thread's status label: Goal while it works toward an active goal. */
export const runningLabel = (t: GoalFields, fallback: string) => (goalOf(t)?.status === 'active' ? 'Goal' : fallback);

/** What Claude Code's stream says about the goal. */
export type GoalSignal =
  | { event: 'set'; objective: string }
  | { event: 'cleared' }
  /** `/goal` with no argument, while one is set: the condition and how many turns it has been checked. */
  | { event: 'active'; objective: string; checks: number }
  /** The goal check ran and the condition does not hold yet. */
  | { event: 'check'; objective: string };

const SET = 'Goal set: ';
const ACTIVE = /^Goal active: ([\s\S]+?) \((?:not yet evaluated|(\d+) turns?)\)/u;

/**
 * A local `/goal` reply, which the CLI sends as a '<synthetic>' assistant message (Claude Code 2.1.316). `ack` marks
 * the replies the goal line replaces, so the transcript does not repeat them; `/goal` alone still answers in text.
 */
export function goalReply(text: string): { signal: GoalSignal; ack: boolean } | null {
  const t = text.trim();
  if (t.startsWith(SET)) {
    const objective = t.slice(SET.length).trim();
    return objective ? { signal: { event: 'set', objective }, ack: true } : null;
  }
  if (t.startsWith('Goal cleared: ') || t === 'No goal set') return { signal: { event: 'cleared' }, ack: true };
  if (t.startsWith('No goal set')) return { signal: { event: 'cleared' }, ack: false };
  const m = ACTIVE.exec(t);
  return m?.[1] ? { signal: { event: 'active', objective: m[1], checks: Number(m[2] ?? 0) }, ack: false } : null;
}

/** The goal hook's "not yet" verdict, a synthetic user message the CLI adds before it keeps working. */
export function goalCheck(text: string): GoalSignal | null {
  const m = /^Stop hook feedback:\n\[([\s\S]+?)\]: /u.exec(text);
  return m?.[1] ? { event: 'check', objective: m[1].trim() } : null;
}

/** The goal after a signal. Undefined when the signal changes nothing. */
export function nextGoal(current: Goal | null, s: GoalSignal): Goal | null | undefined {
  switch (s.event) {
    case 'set':
      return { objective: s.objective, status: 'active', checks: 0 };
    case 'cleared':
      return current ? null : undefined;
    case 'active':
      return { objective: s.objective, status: 'active', checks: current?.objective === s.objective ? Math.max(current.checks, s.checks) : s.checks };
    case 'check':
      return current && current.objective === s.objective ? { ...current, status: 'active', checks: current.checks + 1 } : undefined;
  }
}
