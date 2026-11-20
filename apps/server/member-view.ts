// A group thread's agents as the clients get them (ADR 0019): `members` on the thread, only while an agent besides the
// lead is seated, and `read_only` when its lead agent is gone. Reads the member list (db/repos/members.ts) and the
// hidden thread each member runs in; runner/members.ts writes them.
import type { MemberState } from '@omni/shared/members.ts';
import { setShownThread } from './bus.ts';
import { getCrew } from './crew.ts';
import { events, members, threads, type Thread, type ThreadStatus } from './db.ts';

/** An agent's name as the transcript shows it. */
export const agentName = (id: string | null | undefined) => (id ? (getCrew(id)?.name ?? id) : 'The agent');

/** An agent in a thread as the clients get it. */
export interface MemberView {
  agent: string;
  name: string;
  lead: boolean;
  /** Its session's state, for the member list and the busiest-state mark (packages/shared/members.ts). */
  state: MemberState;
  /** The status of the session it runs in. */
  status: ThreadStatus;
  harness: string;
  model: string | null;
  effort: string;
  seated_at: string;
}

/** A pending question or approval card the agent asked, which it waits on. */
function waitsOnBen(threadId: string, agent: string): boolean {
  const rows = events.questions(threadId).filter((r) => r.agent === agent || r.kind === 'question_answer');
  const answered = new Set(rows.filter((r) => r.kind === 'question_answer').map((r) => (JSON.parse(r.payload) as { id?: string }).id));
  return rows.some((r) => r.kind === 'question' && r.agent === agent && !answered.has((JSON.parse(r.payload) as { id?: string }).id));
}

/** One session's state: a turn running or queued is working; a stopped, failed or limited turn says so; else done or idle. */
export function memberState(s: Thread, threadId: string, agent: string): MemberState {
  if ((s.status === 'running' || s.status === 'queued') && waitsOnBen(threadId, agent)) return 'needs';
  if (s.status === 'running' || s.status === 'queued') return 'working';
  if (s.limit_state || s.setup === 'failed') return 'failed';
  if (s.status === 'failed') return 'failed';
  if (s.status === 'stopped') return 'stopped';
  return s.has_run ? 'done' : 'idle';
}

/** The thread's agents seated now, the lead first: absent when only the lead is. */
export function memberViews(t: Pick<Thread, 'id' | 'source'>): MemberView[] | undefined {
  if (t.source === 'member') return undefined;
  const rows = members.seated(t.id);
  if (!rows.some((m) => !m.lead)) return undefined;
  return rows.flatMap((m) => {
    const s = threads.get(m.session_thread);
    if (!s) return [];
    return [{
      agent: m.agent, name: agentName(m.agent || null), lead: !!m.lead, state: memberState(s, t.id, m.agent), status: s.status,
      harness: s.harness, model: s.model, effort: s.effort, seated_at: m.seated_at,
    }];
  });
}

/**
 * Why the thread takes no new messages, or null when it does: its lead agent was deleted or is hidden on this machine
 * (Q59). Ben starts a new thread to carry on.
 */
export function readOnlyReason(t: Pick<Thread, 'role' | 'source'>): string | null {
  if (!t.role || t.source === 'member') return null;
  const role = getCrew(t.role);
  if (!role) return `This thread's lead, ${t.role}, was deleted, so it takes no new messages. Start a new thread to carry on.`;
  if (role.hidden) return `This thread's lead, ${role.name}, is hidden on this machine, so it takes no new messages. Show it in Settings > Agents, or start a new thread.`;
  return null;
}

/** The fields a thread gains as the clients get it. */
export function memberFields(t: Pick<Thread, 'id' | 'role' | 'source'>): { members?: MemberView[]; read_only?: string } {
  const list = memberViews(t);
  const readOnly = readOnlyReason(t);
  return { ...(list && { members: list }), ...(readOnly && { read_only: readOnly }) };
}

// A member thread's update shows as its group thread's.
setShownThread((t) => (t.parent_id ? (threads.get(t.parent_id) ?? null) : null));
