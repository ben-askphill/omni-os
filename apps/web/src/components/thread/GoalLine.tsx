import { useState } from 'react';
import { api, errorText, type Thread } from '../../api.ts';
import { GOAL_CLEAR, goalOf, goalView } from '@omni/shared/goal.ts';
import { ErrorNote, Icon } from '../ui.tsx';

/**
 * The thread's `/goal` at the end of the timeline (packages/shared/goal.ts): what Claude works toward, whether it is
 * pursuing it now, set and waiting, or met, and how often its check found it unmet. Clear sends `/goal clear`.
 */
export function GoalLine({ thread, running, mobile, onSent }: { thread: Thread; running: boolean; mobile?: boolean; onSent: (t: Thread) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const goal = goalOf(thread);
  if (!goal) return null;
  const view = goalView(goal, running);

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      onSent(await api.post<Thread>(`/threads/${encodeURIComponent(thread.id)}/messages`, { prompt: GOAL_CLEAR }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-goal-line={goal.status} className={mobile ? 'px-1' : undefined}>
      <div className={`flex min-w-0 items-baseline gap-2 text-fg-3 ${mobile ? 'text-[13.5px]' : 'text-[12.5px]'}`} role="status">
        <Icon name={goal.status === 'complete' ? 'check' : 'target'} size={mobile ? 15 : 14} className={`shrink-0 self-center ${running && goal.status === 'active' ? 'text-live' : ''}`} />
        <span className="min-w-0 flex-1 truncate" title={`${view.title}: ${view.objective}`}>
          <span className="text-fg-2">{view.title}</span> <span className="ms-0.5">{view.objective}</span>
        </span>
        {view.canClear && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clear()}
            className={`press shrink-0 font-medium text-fg-2 hover:text-fg disabled:opacity-50 ${mobile ? 'relative after:absolute after:-inset-x-2 after:-inset-y-3' : ''}`}
          >
            {busy ? 'Clearing…' : 'Clear'}
          </button>
        )}
      </div>
      {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
    </div>
  );
}
