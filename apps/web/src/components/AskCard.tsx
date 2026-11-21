// A sent Ask in the transcript, from before group threads retired Ask (ADR 0019): shown with the live state of the
// thread it started and, after "Just show it", the answer on its card. New messages to another agent seat it instead
// (thread/Members.tsx).
import type { AskP } from '@omni/shared/ask.ts';
import { askCaption } from '@omni/shared/ask.ts';
import type { ReportP } from '@omni/shared/transcript-fold.ts';
import type { Thread } from '../api.ts';
import { withLive } from '../transcript/delegation.ts';
import { AgentAvatar, useAgent } from './AgentAvatar.tsx';
import { RemoteMark } from './ConnectAgent.tsx';
import { DelegationCard } from './Delegation.tsx';
import { Icon } from './ui.tsx';

/**
 * A sent Ask in the transcript: Ben's question with what went along, then the thread it started on a delegation card
 * with its live state, and its answer there once it showed without a turn ("Just show it").
 */
export function AskItem({ p, byId, reports, answer }: { p: AskP; byId: Map<string, Thread>; reports?: Map<string, string>; answer?: ReportP }) {
  const branch = withLive({ id: p.thread_id, title: p.title, role: p.role, channel: p.channel, harness: p.harness, task_id: null, status: 'queued' }, byId);
  const agent = useAgent(p.role);
  return (
    <div data-ask className="flex flex-col gap-3">
      <div className="flex flex-col items-end">
        <div className="mb-1 text-right text-[11.5px] text-fg-3">{askCaption(p)}</div>
        <div className="max-w-[92%] rounded-[22px] rounded-tr-lg bg-bubble px-4 py-2.5 text-[14.5px] leading-[1.55] break-words whitespace-pre-wrap sm:max-w-[80%]">{p.question}</div>
      </div>
      <DelegationCard
        mark={agent ? <AgentAvatar agent={agent} size={16} /> : <Icon name="message" size={15} className="text-fg" />}
        label={
          <>
            Asked {p.name}
            {p.remote && <RemoteMark host={p.harness_name} />}
          </>
        }
        branches={[branch]}
        reports={reports}
        answers={answer ? { [p.thread_id]: answer } : undefined}
      />
    </div>
  );
}
