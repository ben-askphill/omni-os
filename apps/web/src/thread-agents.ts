// A thread's agents as the Web UI's composers and member list read them (ADR 0019): its lead, the members seated now
// (the lead first) and the agents a mention would seat. The server sends `members` on a thread while an agent besides
// the lead is seated; without it the lead is the thread's own agent.
import { useMemo } from 'react';
import type { MentionAgent } from '@omni/shared/mention-menu.ts';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import type { Thread } from './api.ts';
import { useCrewRoles } from './store.tsx';

export interface ThreadAgents {
  /** The agent a message with no mention goes to. */
  lead: MentionAgent;
  /** Seated now, the lead first. */
  members: MentionAgent[];
  /** Every other agent this machine lists, which a mention seats. The Conductor is never one (Q10). */
  others: MentionAgent[];
}

export function useThreadAgents(thread: Pick<Thread, 'role' | 'members'>): ThreadAgents {
  const crew = useCrewRoles();
  return useMemo(() => {
    const nameOf = (id: string) => crew.find((r) => r.id === id)?.name ?? crewRoleName(id) ?? id;
    const lead = { id: thread.role ?? '', name: thread.role ? nameOf(thread.role) : 'the agent' };
    const members = thread.members?.length ? thread.members.map((m) => ({ id: m.agent, name: m.name })) : thread.role ? [lead] : [];
    const seated = new Set(members.map((m) => m.id));
    const others = crew.filter((r) => !r.hidden && r.id !== 'conductor' && !seated.has(r.id)).map((r) => ({ id: r.id, name: r.name }));
    return { lead, members, others };
  }, [crew, thread.role, thread.members]);
}
