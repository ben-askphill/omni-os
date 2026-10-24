import { useState } from 'react';
import { api, errorText, type PendingMsg, type Thread } from '../../api.ts';
import { useBranchingFrom } from '../BasePicker.tsx';
import { Button, ErrorNote, Icon, Loader } from '../ui.tsx';

/**
 * A worktree thread whose worktree is not ready (apps/server/runner/setup.ts): Preparing while Omni makes and checks it,
 * then Setup failed with git's reason and Retry. Nothing runs until it is ready, and the first message and its files
 * wait below, kept across restarts. Retry uses the same thread, branch and session.
 */
export function SetupCard({ thread, onRetried }: { thread: Thread; onRetried: (t: Thread, pending: PendingMsg[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = useBranchingFrom(thread);
  if (!thread.setup) return null;
  const failed = thread.setup === 'failed';

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ thread: Thread; pending: PendingMsg[] }>(`/threads/${encodeURIComponent(thread.id)}/setup/retry`, {});
      onRetried(res.thread, res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={failed ? 'Setup failed' : 'Preparing worktree'}
      role={failed ? 'alert' : 'status'}
      className="pop-in mt-5 overflow-hidden rounded-2xl border border-line bg-surface"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${failed ? 'bg-needs/12 text-needs' : 'bg-surface-2 text-fg-3'}`}>
          {failed ? <Icon name="alert" size={15} /> : <Loader size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] leading-snug font-semibold">{failed ? 'Setup failed' : 'Preparing worktree'}</h3>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-3">
            {failed
              ? 'Nothing ran. Your message and files are kept and send once the worktree is ready.'
              : 'Making the thread its own checkout before anything runs.'}
          </p>
          {failed && thread.setup_error && (
            <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.5] break-words whitespace-pre-wrap text-fg-2">{thread.setup_error}</p>
          )}
          {thread.branch && (
            <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-4">
              <Icon name="branch" size={12} className="shrink-0" />
              <span className="truncate font-mono" title={thread.cwd}>
                {thread.branch}
              </span>
            </div>
          )}
          {from && <p className="mt-1 text-[11.5px] text-fg-4">{from}</p>}
        </div>
        {failed && (
          <Button size="sm" variant="primary" icon="refresh" busy={busy} onClick={() => void retry()} className="shrink-0">
            Retry
          </Button>
        )}
      </div>
      {error && <ErrorNote className="mx-3 mb-3">{error}</ErrorNote>}
    </section>
  );
}
