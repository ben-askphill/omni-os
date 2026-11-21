import type { ReactNode } from 'react';
import type { FaceShows } from '@omni/shared/agent-avatar.ts';
import { clock, toDate } from '@omni/shared/format.ts';
import { useTechnical } from '../display.ts';
import { AgentAvatar, type AgentLook } from './AgentAvatar.tsx';
import { HarnessLogo, harnessLabel } from './brand.tsx';

/** The run a reply came from: its harness and, when known, its model's label. */
export interface ReplyRun {
  harness: string;
  model?: string | null;
}

/** How far a reply's rows sit in from the author line's avatar: the 24px gutter and its 12px gap. */
export const REPLY_INDENT = 'pl-9';

/**
 * Who wrote a reply (ADR 0019, How it looks): the agent's avatar at 24px in the gutter, its name and the time beside
 * it. The harness and model show between them only with Show technical details on. The reply's rows sit under the
 * name, `REPLY_INDENT` in. The desktop transcript and the phone's turns draw it on the first reply of a run. `face`
 * stands in for the avatar (the Conductor's saved channel look). `shows`: set only on the head of the reply being
 * written, whose eyes show what the agent does; a past reply's head stays idle and still (ADR 0021, D11).
 */
export function AuthorLine({ agent, at, run, face, phone, shows }: { agent: AgentLook; at?: string | null; run?: ReplyRun | null; face?: ReactNode; phone?: boolean; shows?: FaceShows }) {
  const technical = useTechnical();
  return (
    <div data-author={agent.id} className={`flex min-h-6 min-w-0 items-center gap-x-3 leading-none ${phone ? 'text-[13.5px]' : 'text-[13px]'}`}>
      <span className="flex w-6 shrink-0 justify-center">{face ?? <AgentAvatar agent={agent} size={24} shows={shows} placement={shows ? 'focus' : 'still'} />}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="shrink-0 font-semibold text-fg">{agent.name}</span>
        {technical && run && (
          <span className="inline-flex min-w-0 items-center gap-1 text-[11.5px] text-fg-3" title={`${harnessLabel(run.harness)}${run.model ? ` · ${run.model}` : ''}`}>
            <HarnessLogo harness={run.harness} size={11} />
            <span className="truncate">
              {harnessLabel(run.harness)}
              {run.model ? ` · ${run.model}` : ''}
            </span>
          </span>
        )}
        {at && <span className="shrink-0 font-num text-[11px] text-fg-3">{clock(toDate(at))}</span>}
      </span>
    </div>
  );
}
