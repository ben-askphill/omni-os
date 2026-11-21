// How the Web UI shows an agent_mention (packages/shared/message-context-agent.ts). A composer makes one when an agent
// is picked from the `@` menu: the box shows it as a pill with the agent's avatar in its own color
// (components/composer/MessageEditor.tsx), the text keeps `@<name>`, and the message goes to that agent (ADR 0019).
// A sent message draws the mention as the same pill in its text (MentionText.tsx). One its text does not name (an API
// or Conductor send, or an Ask) shows on the line over the bubble instead (SentTo), as the reply's author line does.
import type { CSSProperties } from 'react';
import { agentColor } from '@omni/shared/agent-avatar.ts';
import type { AgentMention } from '@omni/shared/message-context-agent.ts';
import { AgentAvatar, useAgent, type AgentLook } from '../components/AgentAvatar.tsx';
import { useCrewRoles } from '../store.tsx';
import type { ContextView } from './views.ts';

/** An agent pill's color (index.css .mention-pill-agent tints it): the agent's one color (D4). */
export function agentPillStyle(a: Pick<AgentLook, 'id' | 'avatar'>): CSSProperties {
  return { '--agent': agentColor(a) } as CSSProperties;
}

function AgentMentionDetail({ body: b }: { body: AgentMention }) {
  const agent = useAgent(b.agent) ?? { id: b.agent, name: b.name };
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <AgentAvatar agent={agent} size={20} />
        <span className="truncate text-[13px] font-medium text-fg">{b.name}</span>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-fg-3">The message went to {b.name}. An agent not in the thread yet joins it and stays until you remove it.</p>
    </div>
  );
}

export const agentMentionView: ContextView<AgentMention> = { icon: 'user', Detail: AgentMentionDetail };

/** An agent the message went to, by its name now, or by the name it was sent with when this machine no longer lists it. */
function SentToAgent({ mention: m }: { mention: AgentMention }) {
  const crew = useCrewRoles();
  const agent = crew.find((r) => r.id === m.agent) ?? { id: m.agent, name: m.name };
  return (
    <span data-sent-to={m.agent} className="inline-flex min-w-0 items-center gap-1 font-medium text-fg-2">
      <AgentAvatar agent={agent} size={16} />
      <span className="truncate">{agent.name}</span>
    </span>
  );
}

/**
 * Who a sent or queued message went to, where its text does not name them (@omni/shared/message-context-machine.ts
 * `sentContext`): "To", then each agent's avatar and name. It sits on the line over the bubble, beside the time.
 */
export function SentTo({ agents }: { agents: readonly AgentMention[] }) {
  if (!agents.length) return null;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span>To</span>
      {agents.map((m) => (
        <SentToAgent key={m.agent} mention={m} />
      ))}
    </span>
  );
}
