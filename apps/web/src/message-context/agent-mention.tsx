// How the Web UI shows an agent_mention (packages/shared/message-context-agent.ts). A composer makes one when an agent
// is picked from the `@` menu: the box shows it as a pill with the agent's avatar in its own color
// (components/composer/MessageEditor.tsx), the text keeps `@<name>`, and the message goes to that agent (ADR 0019).
import { agentDisc } from '@omni/shared/agent-avatar.ts';
import type { AgentMention } from '@omni/shared/message-context-agent.ts';
import { AgentAvatar, useAgent, type AgentLook } from '../components/AgentAvatar.tsx';
import type { ContextView } from './views.ts';

/**
 * An agent's own color, for its pill: its avatar's background, else its initials disc's color. An uploaded image's
 * main color is not read yet, so an agent with an image takes its disc's color.
 */
export const agentColor = (a: Pick<AgentLook, 'id' | 'avatar'>) => a.avatar?.bg ?? agentDisc(a.id, '', 24).bg;

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
