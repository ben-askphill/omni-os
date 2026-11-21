// What a crew character's eyes show (ADR 0021, Eyes from thread state): a thread's status mark or a group member's
// state, to an eye state. The eyes take the status mark's rule of who has the ball (`MarkFamily`, status.ts): circles
// while the agent has it, squares while something else holds it, diamonds when Ben does, arcs once done. The agent
// face reads it (agent-avatar.ts). Pure.
import type { EyeState } from './crew-shapes.ts';
import type { MemberState, ThreadMember } from './members.ts';
import { MARK, type Mark, type MarkFamily } from './status.ts';

/** Each family's eyes. A mark that broke waits on Ben to look into it, so it takes his diamonds (D6). */
const FAMILY_EYES: Record<MarkFamily, EyeState> = { agent: 'working', system: 'waiting', you: 'needs', broken: 'needs', settled: 'done', quiet: 'idle' };

/**
 * A status mark's eyes. `open`: the mark is the open thread's, whose rows tell a running tool call (working) from the
 * rest of its turn (thinking). Anywhere else a running thread works (D7). Delegating and queued wait on other threads
 * or a free slot, whatever their family.
 */
export function eyesForMark(mark: Mark, open = false): EyeState {
  if (mark === 'delegating' || mark === 'queued') return 'waiting';
  if (open && (mark === 'starting' || mark === 'working')) return 'thinking';
  return FAMILY_EYES[MARK[mark].family];
}

/**
 * A group member's eyes (members.ts, apps/server/member-view.ts). The server sends no turn phase for members, so a
 * working one works in the member list too (D7); a failed one waits on Ben, as a failed thread does (D6).
 */
const MEMBER_EYES: Record<MemberState, EyeState> = { needs: 'needs', failed: 'needs', working: 'working', done: 'done', stopped: 'idle', idle: 'idle' };

export const eyesForMember = (state: MemberState): EyeState => MEMBER_EYES[state];

/** What the avatar shows: a thread's status mark, a group member's state, or eyes picked outright. Nothing shows idle eyes. */
export type EyeSource = { mark: Mark } | { member: MemberState } | { eyes: EyeState };

/** The eyes for what the avatar shows, `open` as for eyesForMark. */
export function eyesFor(shows: EyeSource | undefined, open = false): EyeState {
  if (!shows) return 'idle';
  if ('mark' in shows) return eyesForMark(shows.mark, open);
  return 'member' in shows ? eyesForMember(shows.member) : shows.eyes;
}

/**
 * What an agent's avatar shows on the open thread (ADR 0021): the thread's status mark, whose open-thread eyes tell
 * thinking from a tool call (D7), or in a group thread the agent's own member state, so each agent shows what it does.
 * Nothing (idle eyes) for an agent not seated in the group. The header's lead and the head of the reply being written
 * show it on every client.
 */
export function agentShows(members: readonly Pick<ThreadMember, 'agent' | 'state'>[] | undefined, agent: string | null | undefined, mark: Mark): EyeSource | undefined {
  if (!members?.length) return { mark };
  const seat = members.find((m) => m.agent === agent);
  return seat && { member: seat.state };
}
