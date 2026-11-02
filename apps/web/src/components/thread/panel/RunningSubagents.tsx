import { toDate } from '@omni/shared/format.ts';
import type { BackgroundTask } from '../../../api.ts';
import { duration } from '../../../format.ts';
import { useNow } from '../../../store.tsx';
import { subagentKind, subagentTip } from '../../../subagents.ts';
import { Loader } from '../../brand.tsx';

/**
 * One running sub-agent: what it does, its kind and how long it has run. A click scrolls the transcript to the call
 * that started it, loading that page of history when it is far back.
 */
export function SubagentRow({ t, onJump }: { t: BackgroundTask; onJump: (eventId: number) => void }) {
  const now = useNow(1000);
  const kind = subagentKind(t);
  return (
    <button
      type="button"
      disabled={!t.event_id}
      onClick={() => t.event_id && onJump(t.event_id)}
      title={subagentTip(t)}
      className="hov flex h-9 w-full min-w-0 items-center gap-2.5 rounded-full px-3 text-left text-[12.5px] [--hov:var(--surface)] disabled:cursor-default"
    >
      <Loader size={11} className="shrink-0 text-live-text" />
      <span className="min-w-0 flex-1 truncate">{t.description}</span>
      {kind && <span className="max-w-[40%] shrink-0 truncate font-mono text-[11px] text-fg-4">{kind}</span>}
      <span className="shrink-0 font-num text-[11px] text-fg-3 tabular-nums">{duration(Math.max(0, now - toDate(t.started_at).getTime()))}</span>
    </button>
  );
}
