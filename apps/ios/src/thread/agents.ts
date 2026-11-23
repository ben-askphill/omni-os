// A thread's agents as the app's composer and member sheet read them (ADR 0019), as phone web's thread-agents.ts and
// Members.tsx do: its lead, the members seated now, the agents a mention would seat, and who a message goes to. The
// server sends `members` on a thread while an agent besides the lead is seated; without it the lead is the thread's own.
import type { CrewRole, Thread, ThreadMember } from '@omni/client-core';
import type { Glyph } from '@omni/shared/status.ts';
import { agentMention, agentMentionBody, mentionedAgents, mentionsAgent } from '@omni/shared/message-context-agent.ts';
import { newContext, type MessageContext } from '@omni/shared/message-context.ts';
import { agentRows, fileQuery, pickFile, type FileMention, type FileQuery, type MentionAgent } from '@omni/shared/mention-menu.ts';
import { replyTo, routingHint } from '@omni/shared/members.ts';
import { isRemoteAgentHarness, remoteLeadPlaceholder } from '@omni/shared/remote-agent.ts';

import { crewRoleName, isConductor } from '@omni/shared/crew-role.ts';
import { harnessLabel } from './format';

export interface ThreadAgents {
  /** The agent a message with no mention goes to. */
  lead: MentionAgent;
  /** Seated now, the lead first. */
  members: MentionAgent[];
  /** Every other agent this machine lists, which a mention seats. The Conductor is never one (Q10). */
  others: MentionAgent[];
}

export function threadAgents(thread: Pick<Thread, 'role' | 'members'>, agents: readonly Pick<CrewRole, 'id' | 'name' | 'hidden'>[]): ThreadAgents {
  const lead = { id: thread.role ?? '', name: thread.role ? crewRoleName(thread.role, agents) : 'the agent' };
  const members = thread.members?.length ? thread.members.map((m) => ({ id: m.agent, name: m.name })) : thread.role ? [lead] : [];
  const seated = new Set(members.map((m) => m.id));
  const others = agents.filter((r) => !r.hidden && !isConductor(r.id) && !seated.has(r.id)).map((r) => ({ id: r.id, name: r.name }));
  return { lead, members, others };
}

/** One member in the member sheet. */
export interface MemberRowView {
  agent: string;
  name: string;
  lead: boolean;
  /** Its state in words, as the Web UI's member list says it. */
  state: string;
  glyph: Glyph;
  /** Its state as the server sends it, which its avatar's eyes show (crew-eyes.ts). */
  member: ThreadMember['state'];
  /** Every member but the lead, which is fixed for the thread's life (Q5). */
  removable: boolean;
  /** A member's own run, which the composer's model pill does not change (Q51). Null for the lead and a remote agent. */
  run: string | null;
}

const STATE_LABEL: Record<ThreadMember['state'], string> = { needs: 'Waiting on you', failed: 'Failed', working: 'Working', done: 'Idle', stopped: 'Stopped', idle: 'Not run yet' };
const STATE_GLYPH: Record<ThreadMember['state'], Glyph> = { needs: 'needs', failed: 'failed', working: 'running', done: 'done', stopped: 'settled', idle: 'idle' };

export function memberRows(thread: Pick<Thread, 'members'>): MemberRowView[] {
  return (thread.members ?? []).map((m) => ({
    agent: m.agent,
    name: m.name,
    lead: m.lead,
    state: STATE_LABEL[m.state],
    glyph: STATE_GLYPH[m.state],
    member: m.state,
    removable: !m.lead,
    run: m.lead || isRemoteAgentHarness(m.harness) ? null : [harnessLabel(m.harness), m.model].filter(Boolean).join(' · '),
  }));
}

/** What the composer says and how it sends, from what is typed and the agent mentions picked. */
export interface Routing {
  /** Null keeps the composer's own wording (steer or queue while a turn runs, or a thread with no lead). */
  placeholder: string | null;
  /** Who gets the message once an `@` is typed (Q50), and which agents it seats. */
  hint: string | null;
  /** The message names agents and not the lead: it leaves the lead's turn alone, so it never steers or queues behind it. */
  toOthers: boolean;
  /** Its lead agent is gone: the thread takes no new messages. */
  readOnly: boolean;
}

export function composerRouting(thread: Pick<Thread, 'role' | 'status' | 'harness' | 'read_only'>, agents: ThreadAgents, text: string, context: readonly unknown[]): Routing {
  const named = mentionedAgents(context).map((a) => ({ agent: a.agent, name: a.name }));
  const lead = { agent: agents.lead.id, name: agents.lead.name };
  const busy = thread.status === 'running' || thread.status === 'queued';
  const placeholder = thread.read_only ?? (!busy && thread.role ? (isRemoteAgentHarness(thread.harness) ? remoteLeadPlaceholder(lead.name) : replyTo(lead.name)) : null);
  return {
    placeholder,
    hint: routingHint(text, lead, named, agents.members.map((m) => m.id)),
    toOthers: named.length > 0 && !named.some((a) => a.agent === lead.agent),
    readOnly: !!thread.read_only,
  };
}

/**
 * The `@` menu while an `@` starts the word at the caret: the agents, members first, then the ones a mention would seat
 * (ADR 0019). The app lists agents only; machines and files are phone web's for now. Null when no `@` is being typed.
 */
export function agentMenu(text: string, caret: number, agents: ThreadAgents): { at: FileQuery; rows: FileMention[] } | null {
  const at = fileQuery(text, caret);
  if (!at) return null;
  const rows = agentRows(agents.members, agents.others, at.query);
  return rows.length ? { at, rows } : null;
}

/**
 * Picks an agent from the menu: `@<name>` in place of what was typed, and an agent_mention record so the message goes to
 * that agent. Null `record` when the message already mentions it: one pill per agent.
 */
export function pickAgent(
  text: string,
  at: FileQuery,
  row: Pick<FileMention, 'insert' | 'name'>,
  context: readonly MessageContext[],
  id?: () => string,
): { text: string; caret: number; record: MessageContext | null } {
  const put = pickFile(text, at, row.name);
  const record = mentionsAgent(context, row.insert) ? null : newContext(agentMention, agentMentionBody({ id: row.insert, name: row.name }), '', id ? { id } : undefined);
  return { ...put, record };
}
