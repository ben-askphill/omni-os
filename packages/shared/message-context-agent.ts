// The agent_mention kind of message context: an agent Ben picked from the composer's `@` menu (ADR 0019). The text
// keeps `@<name>`; the record holds the agent's id, so the message goes to that agent and seats it in the thread when
// it is not a member yet, and the pill keeps the agent when its name changes. The server stamps the agent's current
// name when the message is sent (apps/server/message-context/agent-mention.ts) and refuses an agent it does not know.
// Only Ben's message carries one: an `@name` an agent writes in a reply is plain text, so agents never seat or wake
// each other.
import { ID_MAX, cutLabel, type MessageContext, type MessageContextKind, type Parsed } from './message-context.ts';
import { cleanLine } from './message-context-thread.ts';
import { plain } from './message-context-terminal.ts';

export interface AgentMention {
  /** The agent's id (its crew file's). */
  agent: string;
  /** Its name when the message was sent. One plain line. */
  name: string;
}

export const AGENT_NAME_MAX = 100;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const agentMention: MessageContextKind<AgentMention> = {
  kind: 'agent_mention',
  v: 1,
  parse(body, v): Parsed<AgentMention> {
    if (v !== 1) return { ok: false, error: `agent_mention has no version ${v}` };
    if (!isObj(body)) return { ok: false, error: 'not an object' };
    const agent = plain(body.agent, 'agent', ID_MAX);
    if (!agent.ok) return agent;
    const name = plain(body.name, 'name', AGENT_NAME_MAX);
    if (!name.ok) return name;
    return { ok: true, value: { agent: agent.value, name: name.value } };
  },
  label: (b) => cutLabel(`@${b.name}`),
};

/** The record body for an agent as Ben picked it. */
export const agentMentionBody = (a: { id: string; name: string }): AgentMention => ({ agent: a.id, name: cleanLine(a.name, AGENT_NAME_MAX, a.id) });

const asAgent = (r: unknown): AgentMention | null =>
  isObj(r) && r.kind === agentMention.kind && isObj(r.body) && typeof r.body.agent === 'string' && typeof r.body.name === 'string'
    ? (r.body as unknown as AgentMention)
    : null;

/** The agents `records` mention (read leniently), each once, in the order the message names them. */
export function mentionedAgents(records: unknown): AgentMention[] {
  if (!Array.isArray(records)) return [];
  const seen = new Set<string>();
  const out: AgentMention[] = [];
  for (const r of records) {
    const m = asAgent(r);
    if (m && !seen.has(m.agent)) (seen.add(m.agent), out.push(m));
  }
  return out;
}

/** Whether `records` already mention the agent `id`, so a second pick of it adds no second pill. */
export const mentionsAgent = (records: readonly MessageContext[], id: string) => records.some((r) => asAgent(r)?.agent === id);
