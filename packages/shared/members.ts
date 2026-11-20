// A group thread's agents (ADR 0019): who is seated, who gets a message, and the busiest-state rule its status mark
// follows. The server sends `members` on a thread while an agent besides the lead is seated (apps/server/member-view.ts).
// Pure; the Web UI and the iOS app read it.
import type { Glyph, Mark } from './status.ts';

/** One agent's session in a thread, as the member list and the mark read it. */
export type MemberState = 'needs' | 'failed' | 'working' | 'done' | 'stopped' | 'idle';

/** A thread's agent as the server sends it on the thread (`members`, the lead first). */
export interface ThreadMember {
  agent: string;
  name: string;
  lead: boolean;
  state: MemberState;
  status: string;
  harness: string;
  model: string | null;
  effort: string;
  seated_at: string;
}

/**
 * The busiest-state order (Q34, Q61): Needs you, then Failed (with Usage limit, Setup failed and Message held), then
 * Working, then Done (with Stopped), then Idle.
 */
const STATE_RANK: Record<MemberState, number> = { needs: 4, failed: 3, working: 2, done: 1, stopped: 1, idle: 0 };

/** The busiest of these states, or idle for none. */
export const busiest = (states: readonly MemberState[]): MemberState =>
  states.reduce<MemberState>((a, b) => (STATE_RANK[b] > STATE_RANK[a] ? b : a), 'idle');

const GLYPH_RANK: Record<Glyph, number> = { needs: 4, failed: 3, limited: 3, running: 2, queued: 2, done: 1, settled: 1, idle: 0 };
const STATE_GLYPH: Record<MemberState, Glyph> = { needs: 'needs', failed: 'failed', working: 'running', done: 'done', stopped: 'settled', idle: 'idle' };

/** A mark's place in the busiest-state order: what it asks of Ben first, then what broke, then work, then how it ended. */
function markRank(m: Mark): number {
  switch (m) {
    case 'question':
    case 'crew_question':
    case 'signin':
      return 4;
    case 'failed':
    case 'crew_failed':
    case 'setup_failed':
    case 'limited':
    case 'resuming':
    case 'held':
      return 3;
    case 'queued':
    case 'starting':
    case 'working':
    case 'tool':
    case 'delegating':
    case 'checking':
      return 2;
    case 'done':
    case 'review':
    case 'stopped':
      return 1;
    default:
      return 0;
  }
}
const STATE_MARK: Record<MemberState, Mark> = { needs: 'question', failed: 'failed', working: 'working', done: 'done', stopped: 'stopped', idle: 'idle' };

/** The members besides the lead: the lead's state is the thread's own. */
const others = (members: readonly Pick<ThreadMember, 'lead' | 'state'>[] | undefined) => (members ?? []).filter((m) => !m.lead);

/** The thread's glyph once its members count: the busiest of the lead's own and each member's. Ties keep the lead's. */
export function groupGlyph(own: Glyph, members: readonly Pick<ThreadMember, 'lead' | 'state'>[] | undefined): Glyph {
  let out = own;
  for (const m of others(members)) {
    const g = STATE_GLYPH[m.state];
    if (GLYPH_RANK[g] > GLYPH_RANK[out]) out = g;
  }
  return out;
}

/** The thread's mark once its members count: the busiest of the lead's own and each member's. Ties keep the lead's. */
export function groupMark(own: Mark, members: readonly Pick<ThreadMember, 'lead' | 'state'>[] | undefined): Mark {
  let out = own;
  for (const m of others(members)) {
    const mark = STATE_MARK[m.state];
    if (markRank(mark) > markRank(out)) out = mark;
  }
  return out;
}

/** The agents a message goes to: the ones it names, else the lead (ADR 0019). */
export function recipients(lead: { agent: string; name: string }, named: readonly { agent: string; name: string }[]): { agent: string; name: string }[] {
  return named.length ? [...new Map(named.map((a) => [a.agent, a])).values()] : [lead];
}

const list = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * The composer's hint once Ben types an `@` (Q50): who gets the message, and which agents it seats. Null with no `@`,
 * when the placeholder names the lead instead (`replyTo`).
 */
export function routingHint(
  text: string,
  lead: { agent: string; name: string },
  named: readonly { agent: string; name: string }[],
  seated: readonly string[],
): string | null {
  if (!text.includes('@')) return null;
  const to = recipients(lead, named);
  const joins = to.filter((a) => a.agent !== lead.agent && !seated.includes(a.agent));
  const goes = named.length ? `Goes to ${list(to.map((a) => a.name))} only.` : `Goes to ${lead.name}. Pick an agent from the @ menu to send it to them instead.`;
  if (!joins.length) return goes;
  const who = list(joins.map((a) => a.name));
  return `${goes} ${who} ${joins.length === 1 ? 'joins' : 'join'} this thread and ${joins.length === 1 ? 'stays' : 'stay'} until you remove ${joins.length === 1 ? 'it' : 'them'}.`;
}

/** The composer's placeholder: the lead the message goes to with no `@` (Q50). */
export const replyTo = (leadName: string | null | undefined) => (leadName ? `Reply to ${leadName}` : 'Reply');

/**
 * The run a member's reply came from, for its author line: its own seat's harness and model. Null for the lead, an
 * agent with no seat or a thread with none, whose replies carry the thread's run.
 */
export function seatRun(
  members: readonly Pick<ThreadMember, 'agent' | 'lead' | 'harness' | 'model'>[] | undefined,
  agent: string | null | undefined,
): { harness: string; model: string | null } | null {
  const seat = agent ? members?.find((m) => m.agent === agent && !m.lead) : undefined;
  return seat ? { harness: seat.harness, model: seat.model } : null;
}
