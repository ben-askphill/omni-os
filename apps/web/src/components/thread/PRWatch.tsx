// A thread's PR watch (apps/server/pr-watch/): the server polls the branch's open PR and wakes the thread when a
// check fails or a review comes in. The composer's PR menu and the phone's PR screen both read it through usePRWatch.
import { useEffect, useState } from 'react';
import { WATCH_ACTION, WATCH_HINT, watchLine, type PRWakeItem, type PRWatchView } from '@omni/shared/pr-watch.ts';
import { api, errorText, type PRSummary } from '../../api.ts';
import { Icon } from '../ui.tsx';

/**
 * The watch, read again each time `useThreadPR` answers (a turn ending, every minute), so it keeps the PR's cadence.
 * Undefined until the first answer, null for a thread that never had a watch. A refused start leaves its reason in `error`.
 */
export function usePRWatch(threadId: string | null | undefined, prs: { pr: PRSummary | null } | undefined) {
  const [watch, setWatch] = useState<PRWatchView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = threadId ? `/threads/${encodeURIComponent(threadId)}/pr-watch` : null;
  const hasPR = !!prs?.pr;
  useEffect(() => {
    if (!path || !hasPR) return;
    let live = true;
    api.get<PRWatchView | null>(path).then(
      (w) => live && setWatch(w),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [path, hasPR, prs]);

  const send = async (method: 'put' | 'del') => {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      setWatch(method === 'put' ? await api.put<PRWatchView>(path, {}) : await api.del<PRWatchView | null>(path));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { watch, watching: watch?.state === 'watching', busy, error, start: () => send('put'), stop: () => send('del') };
}

export type PRWatchState = ReturnType<typeof usePRWatch>;

/** The toggle's two lines: what pressing it does, and the watch's status line, or what a watch would do. */
export function watchCopy(w: PRWatchView | null | undefined) {
  return { action: w?.state === 'watching' ? 'Stop watching' : WATCH_ACTION, line: w ? watchLine(w) : WATCH_HINT };
}

/**
 * The PR menu's watch row: start or stop over the status line, for an open PR or a running watch. A watch that ended
 * with its PR keeps its line, without the toggle.
 */
export function PRWatchRow({ w, open }: { w: PRWatchState; open: boolean }) {
  if (!open && !w.watching) return w.watch ? <div className="mt-1 px-2 pt-1.5 text-[11.5px] text-fg-4 shadow-[inset_0_1px_0_var(--line)]">{watchLine(w.watch)}</div> : null;
  const { action, line } = watchCopy(w.watch);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={w.busy}
      onClick={() => void (w.watching ? w.stop() : w.start())}
      className="pik-row mt-1 shadow-[inset_0_1px_0_var(--line)] hover:bg-[var(--wash)] disabled:opacity-60"
    >
      <Icon name="bell" size={14} className={w.watching ? 'text-live-text' : 'text-fg-3'} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-fg-2">{action}</span>
        {w.error ? <span className="text-[11.5px] break-words text-needs">{w.error}</span> : <span className="truncate text-[11.5px] text-fg-4">{line}</span>}
      </span>
    </button>
  );
}

/** Beside the PR number while the watch runs. */
export function PRWatchMark({ w }: { w: PRWatchState }) {
  if (!w.watch || !w.watching) return null;
  return (
    <span className="grid text-live-text" title={watchLine(w.watch)}>
      <Icon name="bell" size={12} />
    </span>
  );
}

/**
 * What a PR watch woke the thread for, under its line in the transcript: who commented or which check failed, a link to
 * it on GitHub and a bounded excerpt. The server keeps the first few (`items`) and counts the rest (`more`).
 */
export function PRWakeList({ items, more = 0 }: { items: PRWakeItem[]; more?: number }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-2 border-t border-line pt-2 text-left text-[12.5px] leading-snug whitespace-normal">
      {items.map((it, i) => (
        <li key={i} className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="max-w-[60%] shrink-0 truncate font-medium text-fg-2">{it.label}</span>
            {it.kind && <span className="min-w-0 truncate text-fg-4">{it.kind}</span>}
            {it.url && (
              <a href={it.url} target="_blank" rel="noreferrer" aria-label={`Open ${it.label} on GitHub`} className="ml-auto grid shrink-0 text-fg-4 hover:text-fg">
                <Icon name="external" size={12} />
              </a>
            )}
          </span>
          {it.excerpt && <span className="line-clamp-3 break-words text-fg-3">{it.excerpt}</span>}
        </li>
      ))}
      {more > 0 && <li className="text-fg-4">and {more} more</li>}
    </ul>
  );
}
