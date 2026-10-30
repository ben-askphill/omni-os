import { useState } from 'react';
import { api, errorText, type PendingMsg, type Thread } from '../../api.ts';
import { Button, ErrorNote, Icon } from '../ui.tsx';

type Action = 'retry' | 'fresh';

/**
 * A thread this machine did not resume because its latest session could not be brought here (apps/server/runner/spawn.ts):
 * resuming the copy here could miss turns another machine ran. Ben tries the download again, or starts with fresh
 * context, a new session that reads the thread so far. Either sends the messages waiting below.
 */
export function StaleSessionCard({
  thread,
  mobile,
  onChanged,
}: {
  thread: Thread;
  mobile?: boolean;
  onChanged: (t: Thread, pending: PendingMsg[]) => void;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!thread.resume_blocked) return null;

  const act = async (a: Action) => {
    setBusy(a);
    setError(null);
    try {
      const res = await api.post<{ thread: Thread; pending: PendingMsg[] }>(`/threads/${encodeURIComponent(thread.id)}/session/${a}`, {});
      onChanged(res.thread, res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label="Session not up to date"
      role="alert"
      className={`pop-in overflow-hidden bg-surface ${mobile ? 'rounded-[20px]' : 'mt-5 rounded-2xl border border-line'}`}
    >
      <div className={`flex flex-wrap items-start gap-3 ${mobile ? 'p-3.5' : 'px-4 py-3'}`}>
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-needs/12 text-needs">
          <Icon name="alert" size={15} />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <h3 className={`${mobile ? 'text-[15px]' : 'text-[14px]'} leading-snug font-semibold`}>Session not up to date</h3>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-3">{thread.resume_blocked}</p>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-fg-3">
            Try again, or start with fresh context: a new session that reads this thread so far. Your messages wait below.
          </p>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" icon="refresh" busy={busy === 'retry'} disabled={!!busy} onClick={() => void act('retry')}>
            Try again
          </Button>
          <Button size="sm" variant="secondary" icon="plus" busy={busy === 'fresh'} disabled={!!busy} onClick={() => void act('fresh')}>
            Start with fresh context
          </Button>
        </div>
      </div>
      {error && <ErrorNote className="mx-3 mb-3">{error}</ErrorNote>}
    </section>
  );
}
