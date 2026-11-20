// The agent_mention kind as harness text (project.ts) and at the message route: an agent Ben @mentioned, which the
// message goes to and seats in the thread (apps/server/members.ts). The route stamps the agent's current name and
// refuses one this machine does not know, or the Conductor, which is never seated (ADR 0019).
import { cutLabel, type MessageContext } from '@omni/shared/message-context.ts';
import { readContexts } from '@omni/shared/message-context-kinds.ts';
import { AGENT_NAME_MAX, agentMention, agentMentionBody, type AgentMention } from '@omni/shared/message-context-agent.ts';
import { cleanLine } from '@omni/shared/message-context-thread.ts';
import { getCrew } from '../crew.ts';
import { userName } from '../profile.ts';
import { defang } from './defang.ts';
import type { Projector } from './project.ts';

type Stamped = { ok: true; value: MessageContext[] } | { ok: false; error: string };

/** Why an agent cannot be seated in a thread, or null when it can. Any agent but the Conductor (ADR 0019, Q10). */
export function seatRefusal(id: string): string | null {
  if (id === 'conductor') return 'The Conductor is never seated in a thread.';
  return getCrew(id) ? null : `No agent "${id}" here. Remove the mention, then @mention the agent again.`;
}

/** The records with each agent mention stamped with that agent's current name. An agent this machine has not got is refused. */
export function stampAgentMentions(records: readonly MessageContext[]): Stamped {
  if (!records.some((r) => r.kind === agentMention.kind)) return { ok: true, value: [...records] };
  const out: MessageContext[] = [];
  for (const r of readContexts(records)) {
    if (r.as !== 'known' || r.kind !== 'agent_mention') {
      out.push(r.record);
      continue;
    }
    const refused = seatRefusal(r.body.agent);
    if (refused) return { ok: false, error: `${r.record.label}: ${refused}` };
    const body = agentMentionBody({ id: r.body.agent, name: getCrew(r.body.agent)!.name });
    out.push({ ...r.record, label: cutLabel(agentMention.label(body)), body });
  }
  return { ok: true, value: out };
}

export const projectAgentMention: Projector<AgentMention> = (b) => {
  const name = defang(cleanLine(b.name, AGENT_NAME_MAX, b.agent));
  return { title: `Agent mention: ${userName()} wrote @${name} for the agent ${name} (agent id ${defang(b.agent)}). Omni sends this message to every agent it names` };
};
