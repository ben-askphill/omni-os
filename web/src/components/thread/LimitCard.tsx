import { useState } from 'react';
import { api, errorText, type PendingMsg, type Thread } from '../../api.ts';
import { limitView, type LimitAction } from '../../limits.ts';
import { useNow } from '../../store.tsx';
import { harnessLabel } from '../brand.tsx';
import { Button, ErrorNote, Icon } from '../ui.tsx';

const ACTION: Record<LimitAction, { label: string; icon: 'clock' | 'play' | 'x'; path: string }> = {
  schedule: { label: 'Resume at reset', icon: 'clock', path: 'schedule' },
  cancel: { label: 'Cancel', icon: 'x', path: 'cancel' },
  resume: { label: 'Resume now', icon: 'play', path: 'resume' },
};

/**
 * A turn the harness stopped at the plan's usage limit (server/runner/limits.ts). With the reset time it reported,
 * Ben can have Omni continue the thread then, once, or cancel that; without one, or any time, he resumes it now.
 */
export function LimitCard({ thread, onChanged }: { thread: Thread; onChanged: (t: Thread, pending: PendingMsg[]) => void }) {
  const now = useNow(60_000);
  const [busy, setBusy] = useState<LimitAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = limitView(thread, harnessLabel(thread.harness), now);
  if (!view) return null;
  const scheduled = thread.limit_state === 'scheduled';

  const act = async (a: LimitAction) => {
    setBusy(a);
    setError(null);
    try {
      const res = await api.post<{ thread: Thread; pending: PendingMsg[] }>(`/threads/${encodeURIComponent(thread.id)}/limit/${ACTION[a].path}`, {});
      onChanged(res.thread, res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label={view.title} role="status" className="pop-in mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${scheduled ? 'bg-surface-2 text-fg-2' : 'bg-needs/12 text-needs'}`}>
          <Icon name={scheduled ? 'clock' : 'gauge'} size={15} />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="text-[14px] leading-snug font-semibold">{view.title}</h3>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-3">{view.body}</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {view.actions.map((a, i) => (
            <Button
              key={a}
              size="sm"
              variant={i === 0 ? 'primary' : 'secondary'}
              icon={ACTION[a].icon}
              busy={busy === a}
              disabled={!!busy}
              onClick={() => void act(a)}
            >
              {ACTION[a].label}
            </Button>
          ))}
        </div>
      </div>
      {error && <ErrorNote className="mx-3 mb-3">{error}</ErrorNote>}
    </section>
  );
}
