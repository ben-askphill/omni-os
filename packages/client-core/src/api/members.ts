// A group thread's agents (ADR 0019) and a remote-led thread's commit (ADR 0020): seat and remove members, take a
// collision flag down, and commit what the local members changed. The thread comes back with its `members`.
import type { Collision } from '@omni/shared/collisions.ts';
import { apiPath, type HttpClient } from '../http.ts';
import type { Thread } from './threads.ts';

export type { MemberState, ThreadMember } from '@omni/shared/members.ts';
export type { Collision } from '@omni/shared/collisions.ts';
export type { RemoteServer } from '@omni/shared/remote-agent.ts';

export function membersApi(http: HttpClient) {
  return {
    /** Add an agent: seats it with a joined line and no turn. A 4xx names why it cannot sit (the Conductor, a lead). */
    seatAgent: (threadId: string, agent: string) => http.request<Thread>('POST', apiPath`/threads/${threadId}/members`, { body: { agent } }),
    /** Removes a member: its running turn finishes, messages queued for it are dropped, its replies stay. */
    removeMember: (threadId: string, agent: string) => http.request<Thread>('DELETE', apiPath`/threads/${threadId}/members/${agent}`),
    /** Takes one collision flag down, by its row id on this machine. Resolves with the flags still up. */
    dismissCollision: async (threadId: string, id: number) =>
      (await http.request<{ collisions: Collision[] }>('POST', apiPath`/threads/${threadId}/collisions/${id}/dismiss`)).collisions,
    /** Commits what no commit has taken yet in a thread a remote agent leads, where the user commits. A 409 with nothing to commit. */
    commitThread: (threadId: string, message: string) => http.request<{ sha: string; files: number }>('POST', apiPath`/threads/${threadId}/commit`, { body: { message } }),
    /** Opens the pull request of a remote-led thread from what is committed: Omni opens it, not the agent. */
    openThreadPR: (threadId: string) => http.request<{ url: string }>('POST', apiPath`/threads/${threadId}/open-pr`, { body: {} }),
  };
}
