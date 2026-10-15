import { useState } from 'react';
import { api, errorText, type Thread } from '../../api.ts';
import { newThreadBody, sameSettings } from '../../new-thread-preset.ts';
import { navigate, openNewThread } from '../../router.ts';
import { Button, ErrorNote, IconButton } from '../ui.tsx';

type Action = 'start' | 'here' | 'dismiss';

/**
 * The follow-up thread the server proposed once the turn was done (server/runner/aux.ts). Start runs it as a new
 * thread on this one's channel, harness, model and role; Do it here sends it as the next reply; Edit opens the
 * new-thread composer with it.
 */
export function NextThreadCard({ thread, onThread }: { thread: Thread; onThread: (t: Thread, reply?: boolean) => void }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = thread.next_title;
  const prompt = thread.next_prompt;
  if (!title || !prompt || thread.status !== 'done') return null;

  const path = `/threads/${encodeURIComponent(thread.id)}`;
  const dismiss = () => api.patch<Thread>(path, { next_thread: null });
  const run = async (action: Action) => {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      if (action === 'start') {
        const t = await api.post<Thread>('/threads', newThreadBody(thread, prompt));
        // Started: the card has done its job here. A failed dismiss only leaves it showing.
        void dismiss().then((d) => onThread(d), () => {});
        navigate(`/t/${t.id}`);
      } else if (action === 'here') {
        onThread(await api.post<Thread>(`${path}/messages`, { prompt }), true);
      } else {
        onThread(await dismiss());
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Suggested new thread" className="pop-in mt-6 overflow-hidden rounded-2xl border border-line bg-surface sm:max-w-[560px]">
      <div className="bg-surface-2 px-4 py-2 text-[12px] font-medium text-fg-3">New thread</div>
      <div className="flex items-start gap-2 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] leading-snug font-semibold break-words">{title}</h3>
          {/* All of it, never clamped: Start runs exactly this. */}
          <p className="mt-1 text-[13px] leading-[1.5] break-words whitespace-pre-wrap text-fg-3">
            {prompt}
          </p>
        </div>
        <IconButton icon="x" label="Dismiss" size={14} className="-mt-1 -mr-2" disabled={!!busy} onClick={() => void run('dismiss')} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5 pb-3">
        <Button size="sm" variant="ghost" icon="pencil" disabled={!!busy} onClick={() => openNewThread({ ...sameSettings(thread), prompt })}>
          Edit
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" busy={busy === 'here'} disabled={!!busy} onClick={() => void run('here')} title="Send it as the next reply in this thread">
            Do it here
          </Button>
          <Button size="sm" variant="primary" busy={busy === 'start'} disabled={!!busy} onClick={() => void run('start')} title="Start it as a new thread with this thread's settings">
            Start
          </Button>
        </div>
      </div>
      {error && <ErrorNote className="mx-3 mb-3">{error}</ErrorNote>}
    </section>
  );
}
