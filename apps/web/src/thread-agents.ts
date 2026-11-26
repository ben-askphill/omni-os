// A thread's agents as the Web UI's composers and member list read them (ADR 0019): its lead, the members seated now
// (the lead first) and the agents a mention would seat. The server sends `members` on a thread while an agent besides
// the lead is seated; without it the lead is the thread's own agent. A new-thread composer reads the same for the
// thread it will start: the agent it starts as leads, and no one is seated yet.
import { useMemo } from 'react';
import type { MentionAgent } from '@omni/shared/mention-menu.ts';
import { crewRoleName, isConductor } from '@omni/shared/crew-role.ts';
import type { CrewRole, Thread } from './api.ts';
import { useCrewRoles } from './store.tsx';

export interface ThreadAgents {
  /** The agent a message with no mention goes to. */
  lead: MentionAgent;
  /** Seated now, the lead first. */
  members: MentionAgent[];
  /** Every other agent this machine lists, which a mention seats. The Conductor is never one (Q10). */
  others: MentionAgent[];
}

/** The agents of a thread with lead `role` and these members (none: just the lead). */
function threadAgents(crew: readonly Pick<CrewRole, 'id' | 'name' | 'hidden'>[], thread: Pick<Thread, 'role' | 'members'>): ThreadAgents {
  const lead = { id: thread.role ?? '', name: thread.role ? crewRoleName(thread.role, crew) : 'the agent' };
  const members = thread.members?.length ? thread.members.map((m) => ({ id: m.agent, name: m.name })) : thread.role ? [lead] : [];
  const seated = new Set(members.map((m) => m.id));
  const others = crew.filter((r) => !r.hidden && !isConductor(r.id) && !seated.has(r.id)).map((r) => ({ id: r.id, name: r.name }));
  return { lead, members, others };
}

export function useThreadAgents(thread: Pick<Thread, 'role' | 'members'>): ThreadAgents {
  const crew = useCrewRoles();
  return useMemo(() => threadAgents(crew, thread), [crew, thread.role, thread.members]);
}

/**
 * The agents of the thread a new-thread composer will start as `role` (empty: the channel's default agent). Nothing is
 * seated yet, so the `@` menu lists every agent but the lead and the Conductor as one the first message seats.
 */
export function newThreadAgents(crew: readonly Pick<CrewRole, 'id' | 'name' | 'hidden'>[], role: string): ThreadAgents {
  const { lead, others } = threadAgents(crew, { role: role || null });
  return { lead, members: [], others };
}
