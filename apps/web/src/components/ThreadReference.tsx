// Attach another thread to a reply as a reference (the thread_reference kind of message context): a search over thread
// titles and channels, scoped to this channel unless Ben switches it to All channels. A pick adds a chip to the draft;
// nothing is sent to, started in or changed on the picked thread. The `@` menu for files is untouched.
import { useEffect, useId, useRef, useState } from 'react';
import { api, errorText, type Thread } from '../api.ts';
import { relTime } from '../format.ts';
import { attachReference, isAttached, searchPath, type ReferenceCandidate, type ReferenceScope } from '../message-context/thread-picker.ts';
import { useDraftContext } from '../message-context/draft.ts';
import { Icon, IconButton, StatusDot } from './ui.tsx';
import { useDismissable } from './ui/use-dismissable.ts';

const SCOPES: { value: ReferenceScope; label: string }[] = [
  { value: 'channel', label: 'This channel' },
  { value: 'all', label: 'All channels' },
];

/** The thread's search answers for `query`, after a short pause, never showing an older search's answer. */
function useCandidates(threadId: string, query: string, scope: ReferenceScope) {
  const [got, setGot] = useState<{ key: string; rows: ReferenceCandidate[] | null; error: string | null }>({ key: '', rows: null, error: null });
  const key = `${threadId}\0${scope}\0${query.trim()}`;
  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      api
        .get<ReferenceCandidate[]>(searchPath(threadId, query, scope))
        .then((rows) => !stale && setGot({ key, rows, error: null }))
        .catch((e) => !stale && setGot({ key, rows: null, error: errorText(e) }));
    }, got.key ? 120 : 0);
    return () => {
      stale = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { rows: got.rows, error: got.error, settled: got.key === key };
}

/**
 * The picker's body, in the desktop popover and the phone sheet. `onPicked` runs after a thread is attached.
 * `touch` makes the rows the phone's size.
 */
export function ThreadReferencePanel({ thread, onPicked, touch }: { thread: Thread; onPicked: () => void; touch?: boolean }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ReferenceScope>('channel');
  const [problem, setProblem] = useState<string | null>(null);
  const { rows, error, settled } = useCandidates(thread.id, query, scope);
  const attached = useDraftContext(thread.id);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Not on a phone: its keyboard would cover the list the sheet has just opened.
    if (!touch) input.current?.focus();
  }, [touch]);

  const pick = (c: ReferenceCandidate) => {
    const why = attachReference(thread.id, thread.channel_id, c);
    if (why) return setProblem(why);
    onPicked();
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search threads by title or channel</span>
          <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-4" />
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setProblem(null);
            }}
            placeholder="Search threads by title or channel"
            aria-controls={listId}
            className={`w-full rounded-full bg-surface-2 pr-3 pl-8 text-fg outline-none placeholder:text-fg-4 ${touch ? 'h-11 text-[16px]' : 'h-9 text-[13px]'}`}
          />
        </label>
      </div>
      <div role="group" aria-label="Search in" className="flex gap-1 px-3 pt-2">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={scope === s.value}
            onClick={() => {
              setScope(s.value);
              setProblem(null);
            }}
            className={`hov press inline-flex items-center rounded-full px-3 text-[12.5px] font-medium ${touch ? 'h-9' : 'h-7'} ${scope === s.value ? 'bg-surface-2 text-fg' : 'text-fg-3 hover:text-fg'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {scope === 'all' && <p className="m-0 px-4 pt-2 text-[11.5px] leading-snug text-fg-3">Picking a thread from another channel attaches it on purpose. Nothing else of that channel is shared.</p>}
      <div id={listId} role="list" aria-label="Threads" className="scroll-thin mt-2 max-h-[min(20rem,45vh)] overflow-y-auto px-1.5 pb-1.5">
        {error && <p className="m-0 px-3 py-3 text-[12.5px] text-fg-3">Could not search: {error}</p>}
        {!error && rows?.length === 0 && settled && <p className="m-0 px-3 py-3 text-[12.5px] text-fg-3">{query.trim() ? 'No thread matches.' : 'No other threads in this channel yet.'}</p>}
        {rows?.map((c) => {
          const on = attached.length > 0 && isAttached(thread.id, c.id);
          return (
            <button
              key={c.id}
              type="button"
              role="listitem"
              disabled={on}
              onClick={() => pick(c)}
              className={`hov press flex w-full items-center gap-2.5 rounded-2xl px-3 text-left disabled:opacity-50 ${touch ? 'min-h-14 py-2' : 'min-h-11 py-1.5'}`}
            >
              <StatusDot status={c.status} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-fg">{c.title}</span>
                <span className="truncate text-[11.5px] text-fg-4">
                  {c.channel_name} · {c.short_id} · {relTime(c.updated_at)}
                </span>
              </span>
              {!c.same_channel && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-px text-[11px] text-fg-3">other channel</span>}
              {c.archived && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-px text-[11px] text-fg-3">archived</span>}
              {on && <Icon name="check" size={14} className="shrink-0 text-fg-3" />}
            </button>
          );
        })}
      </div>
      {problem && (
        <p role="alert" className="m-0 px-4 pb-2 text-[12px] text-fg-3">
          {problem}
        </p>
      )}
      <p className="m-0 border-t border-line px-4 py-2.5 text-[11.5px] leading-snug text-fg-3">
        Attaches a reference, not the thread's messages. The agent reads it only when it needs to, and the thread itself is not touched.
      </p>
    </div>
  );
}

/** The thread header's button for it: opens the picker under the header, its right edge on the button's. */
export function ThreadReferenceButton({ thread, disabled }: { thread: Thread; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismissable(open, () => setOpen(false), { root: wrap });
  return (
    <div ref={wrap} className="relative">
      <IconButton icon="message" label="Reference another thread" size={15} disabled={disabled} active={open} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} />
      {open && (
        <div
          role="dialog"
          aria-label="Reference another thread"
          className="fade-in absolute top-full right-0 z-30 mt-2 w-[min(23rem,calc(100vw-2rem))] rounded-[22px] bg-elev shadow-[var(--shadow-menu)]"
        >
          <ThreadReferencePanel thread={thread} onPicked={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
