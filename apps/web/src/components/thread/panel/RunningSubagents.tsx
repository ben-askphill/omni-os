import { toDate } from '@omni/shared/format.ts';
import type { BackgroundTask } from '../../../api.ts';
import { duration } from '../../../format.ts';
import { useNow } from '../../../store.tsx';
import { subagentKind, subagentProgress, subagentTip } from '../../../subagents.ts';
import { StatusDot } from '../../ui/status.tsx';
import { useTooltip } from '../../ui/tooltip.tsx';
import { ROW } from './inset.ts';

/**
 * One running sub-agent: what it does, how far it got, its kind and how long it has run. A click scrolls the transcript
 * to the call that started it, loading that page of history when it is far back. The whole line, which the row may cut
 * short, shows as a tooltip on hover and keyboard focus.
 */
export function SubagentRow({ t, onJump }: { t: BackgroundTask; onJump: (eventId: number) => void }) {
  const now = useNow(1000);
  const kind = subagentKind(t);
  const progress = subagentProgress(t);
  const { triggerProps, tip } = useTooltip(subagentTip(t));
  return (
    <>
      <button
        {...triggerProps}
        type="button"
        disabled={!t.event_id}
        onClick={() => t.event_id && onJump(t.event_id)}
        className={`hov flex w-full min-w-0 items-center gap-[var(--sp-5)] ${ROW} text-left text-[12.5px] [--hov:var(--surface)] disabled:cursor-default`}
      >
        <span className="grid size-5 shrink-0 place-items-center">
          <StatusDot status="running" size={7} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          {t.description}
          {progress && <span className="ml-[var(--sp-3)] text-[11.5px] text-fg-3">{progress}</span>}
        </span>
        {kind && <span className="max-w-[40%] shrink-0 truncate font-mono text-[11px] text-fg-3">{kind}</span>}
        <span className="shrink-0 font-num text-[11px] text-fg-3 tabular-nums">{duration(Math.max(0, now - toDate(t.started_at).getTime()))}</span>
      </button>
      {tip}
    </>
  );
}
